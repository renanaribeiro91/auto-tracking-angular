import ts from 'typescript';
import type { ComponentInfo, ProjectIndex, ServiceInfo } from './ports/project-index.js';
import { START_TAG, TemplateAnalysis } from './template-analysis.js';

export interface ProductionUsage {
  readonly components: ReadonlySet<string>;
  readonly surfaces: ReadonlySet<string>;
  readonly methods: ReadonlyMap<string, ReadonlySet<string>>;
  readonly diagnostics: readonly { readonly code: 'TRACKING_DYNAMIC_USAGE_UNPROVEN'; readonly arquivo: string; readonly linha: number; readonly mensagem: string }[];
}

const LIFECYCLE = new Set(['constructor', 'ngOnInit', 'ngOnChanges', 'ngDoCheck', 'ngAfterContentInit',
  'ngAfterContentChecked', 'ngAfterViewInit', 'ngAfterViewChecked', 'ngOnDestroy']);
type Owner = ComponentInfo | ServiceInfo;
const isComponent = (owner: Owner): owner is ComponentInfo => 'def' in owner;
const ownDependencies = (owner: Owner) => isComponent(owner) ? owner.serviceDependencies : owner.dependencies;

/** Apenas expressões Angular executáveis; texto, id e nomes em atributos estáticos não chamam métodos. */
function templateReferences(template: string): ReadonlySet<string> {
  const expressions: string[] = [];
  const analysis = new TemplateAnalysis();
  for (const tag of template.matchAll(START_TAG)) {
    for (const [name, value] of analysis.parseAttrs(tag[2] ?? '')) if (/^[([*]/.test(name)) expressions.push(value);
  }
  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) expressions.push(match[1]!);
  for (const match of template.matchAll(/@(if|for|switch|case)\s*\(/g)) {
    const start = match.index! + match[0].length;
    let depth = 1; let quote = ''; let end = start;
    for (; end < template.length && depth; end++) {
      const character = template[end]!;
      if (quote) { if (character === '\\') end++; else if (character === quote) quote = ''; }
      else if ('\'"`'.includes(character)) quote = character;
      else if (character === '(') depth++;
      else if (character === ')') depth--;
    }
    if (!depth) expressions.push(template.slice(start, end - 1));
  }
  for (const match of template.matchAll(/@let\s+[\w$]+\s*=\s*([^;]+);/g)) expressions.push(match[1]!);
  const names = new Set<string>();
  for (const expression of expressions) {
    const source = ts.createSourceFile('binding.ts', expression, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        if (!(ts.isPropertyAccessExpression(parent) && parent.name === node && parent.expression.kind !== ts.SyntaxKind.ThisKeyword)) names.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return names;
}

/** Escopo de uso em produção, calculado uma vez no CLI; não entra no bundle do app. */
export function resolveProductionUsage(project: ProjectIndex, rootSelector: string): ProductionUsage {
  const byKey = new Map<string, Owner>([...project.components.map((component) => [component.key, component] as const),
    ...project.services]);
  const selectors = new Map<string, ComponentInfo[]>();
  for (const component of project.components) for (const selector of component.def.selectors) {
    const group = selectors.get(selector) ?? []; group.push(component); selectors.set(selector, group);
  }
  const components = new Set<string>();
  const surfaces = new Set<string>();
  const instances = new Set<string>();
  const visited = new Set<string>();
  const methods = new Map<string, Set<string>>();
  const queue: { owner: Owner; declaration: Owner; method: string }[] = [];
  const diagnostics: ProductionUsage['diagnostics'][number][] = [];
  const parsed = new Map<string, ts.SourceFile>();
  const chains = new Map<string, readonly Owner[]>();
  const chain = (owner: Owner): readonly Owner[] => {
    const cached = chains.get(owner.key); if (cached) return cached;
    const result: Owner[] = []; const seen = new Set<string>();
    for (let current: Owner | undefined = owner; current && !seen.has(current.key); current = current.baseClass ? byKey.get(current.baseClass) : undefined) {
      seen.add(current.key); result.push(current);
    }
    chains.set(owner.key, result); return result;
  };
  const dependency = (owner: Owner, receiver: string): Owner | undefined => {
    for (const current of chain(owner)) {
      const key = ownDependencies(current).get(receiver);
      if (key) return byKey.get(key);
    }
    return undefined;
  };
  const surfaceByKey = new Map(project.surfaces?.map((surface) => [surface.componentKey, surface]) ?? []);
  const methodSurfaces = new Map<string, string[]>();
  for (const surface of project.surfaces ?? []) {
    if (!surface.ownerKey || !surface.method) continue;
    const key = `${surface.ownerKey}\0${surface.method}`;
    const group = methodSurfaces.get(key) ?? []; group.push(surface.componentKey); methodSurfaces.set(key, group);
  }
  const trackingOwners = new Set((project.surfaces ?? []).flatMap((surface) => surface.ownerKey ? [surface.ownerKey] : []));
  for (const service of project.services.values()) if (service.openedComponents.size) trackingOwners.add(service.key);
  const reverse = new Map<string, Set<string>>();
  for (const owner of byKey.values()) {
    for (const key of [...ownDependencies(owner).values(), ...(owner.baseClass ? [owner.baseClass] : [])]) {
      const users = reverse.get(key) ?? new Set<string>(); users.add(owner.key); reverse.set(key, users);
    }
  }
  const trackingQueue = [...trackingOwners];
  for (let index = 0; index < trackingQueue.length; index++) for (const key of reverse.get(trackingQueue[index]!) ?? []) {
    if (!trackingOwners.has(key)) { trackingOwners.add(key); trackingQueue.push(key); }
  }
  const parse = (owner: Owner, method: string): ts.SourceFile => {
    const key = `${owner.key}\0${method}`;
    let source = parsed.get(key);
    if (!source) {
      source = ts.createSourceFile(owner.tsFile, owner.methods.get(method) ?? '', ts.ScriptTarget.Latest, true);
      parsed.set(key, source);
    }
    return source;
  };
  const canonical = (name: string, owner: Owner): string => {
    const separator = name.indexOf('.');
    const alias = separator < 0 ? name : name.slice(0, separator);
    const target = project.actionImports?.get(owner.tsFile)?.get(alias);
    return target ? `${target}${separator < 0 ? '' : target.endsWith('#') ? name.slice(separator + 1) : name.slice(separator)}` : name;
  };
  const effects = new Map<string, { owner: ServiceInfo; method: string }[]>();
  const registeredEffects = project.eagerServices === undefined ? null : new Set([...project.eagerServices].flatMap((key) => {
    const owner = byKey.get(key); return owner ? chain(owner).map((current) => current.key) : [];
  }));
  for (const owner of project.services.values()) for (const [method, body] of owner.methods) {
    if (!/\bcreateEffect\s*\(/.test(body)) continue;
    if (registeredEffects && !registeredEffects.has(owner.key)) continue;
    const source = parse(owner, method);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ofType') {
        for (const argument of node.arguments) {
          const name = canonical(argument.getText(source).replace(/\s+/g, ''), owner);
          const handlers = effects.get(name) ?? []; handlers.push({ owner, method }); effects.set(name, handlers);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const enqueue = (owner: Owner, method: string): void => {
    const declaration = chain(owner).find((candidate) => candidate.methods.has(method));
    if (!declaration) return;
    const key = `${owner.key}\0${method}`;
    if (visited.has(key)) return;
    visited.add(key); queue.push({ owner, declaration, method });
    for (const current of [owner, declaration]) {
      const used = methods.get(current.key) ?? new Set<string>(); used.add(method); methods.set(current.key, used);
    }
  };
  const instantiate = (owner: Owner): void => {
    if (instances.has(owner.key)) return;
    instances.add(owner.key);
    enqueue(owner, 'constructor');
    for (const current of chain(owner)) {
      for (const method of current.initializers ?? []) {
        const body = current.methods.get(method) ?? '';
        // Registrar o listener não executa seus callbacks: efeitos de actions exigem um dispatch alcançável.
        if (!/\bcreateEffect\s*\(/.test(body) || !/\bofType\s*\(/.test(body)) enqueue(owner, method);
      }
      for (const key of ownDependencies(current).values()) {
        const injected = byKey.get(key); if (injected) instantiate(injected);
      }
    }
  };
  const activate = (key: string): void => {
    const owner = byKey.get(key);
    if (!owner || !isComponent(owner) || components.has(key)) return;
    components.add(key); instantiate(owner);
    const surface = surfaceByKey.get(key);
    if (surface) surfaces.add(key);
    for (const name of LIFECYCLE) enqueue(owner, name);
    const template = owner.def.template.replace(/<!--[\s\S]*?-->/g, '');
    const names = templateReferences(template);
    for (const name of names) enqueue(owner, name);
    for (const listener of owner.def.hostListeners) {
      const used = new Set(listener.expr.match(/[A-Za-z_$][\w$]*/g) ?? []);
      for (const name of used) enqueue(owner, name);
    }
    for (const match of template.matchAll(/<([a-z][\w-]*-[\w-]*)/gi)) {
      for (const child of selectors.get(match[1]!.toLowerCase()) ?? []) activate(child.key);
    }
    // Índices antigos sem metadados por método mantêm a prova anterior de referência.
    if (!owner.methodComponents) for (const child of owner.referencedComponents) activate(child);
  };
  for (const key of project.routedComponents) activate(key);
  for (const root of selectors.get(rootSelector) ?? []) activate(root.key);
  for (const key of project.eagerServices ?? []) {
    const owner = byKey.get(key); if (owner) instantiate(owner);
  }
  const action = (name: string, owner: Owner): void => {
    for (const handler of effects.get(canonical(name, owner)) ?? []) {
      instantiate(handler.owner); enqueue(handler.owner, handler.method);
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const { owner, declaration, method } = queue[index]!;
    for (const key of methodSurfaces.get(`${declaration.key}\0${method}`) ?? []) {
      surfaces.add(key); activate(key);
    }
    if (isComponent(declaration)) {
      for (const key of declaration.methodComponents?.get(method) ?? []) activate(key);
      if (!declaration.methodComponents) for (const key of project.opens.get(declaration.key) ?? []) {
        const surface = surfaceByKey.get(key);
        if (!surface || !surface.method || surface.method === method) activate(key);
      }
    } else for (const key of declaration.openedComponents.get(method) ?? []) activate(key);
    const source = parse(declaration, method);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const receiver = node.expression;
        const receiverName = receiver.kind === ts.SyntaxKind.ThisKeyword ? null
          : ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword ? receiver.name.text : undefined;
        const target = receiverName === null ? owner : receiverName !== undefined ? dependency(owner, receiverName) : undefined;
        if (target) {
          instantiate(target);
          if (ts.isPropertyAccessExpression(node)) enqueue(target, node.name.text);
          else if (node.argumentExpression) {
            const argument = node.argumentExpression;
            if (ts.isStringLiteralLike(argument)) enqueue(target, argument.text);
            else {
              const property = ts.isPropertyAccessExpression(argument) ? argument.name.text : ts.isIdentifier(argument) ? argument.text : '';
              const candidates = [...(project.dynamicMethodValues?.get(property) ?? [])].filter((name) => chain(target).some((candidate) => candidate.methods.has(name)));
              for (const name of candidates) enqueue(target, name);
              // Leitura de uma coleção não é despacho de método.
              const tracksSurface = trackingOwners.has(target.key);
              if (!candidates.length && tracksSurface && ts.isCallExpression(node.parent) && node.parent.expression === node) diagnostics.push({
                code: 'TRACKING_DYNAMIC_USAGE_UNPROVEN', arquivo: owner.tsFile, linha: 1,
                mensagem: `despacho dinâmico '${node.getText(source)}' sem conjunto estático de métodos; declare valores literais do contrato`,
              });
            }
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'dispatch') {
          const dispatched = node.arguments[0];
          if (dispatched && ts.isCallExpression(dispatched)) action(dispatched.expression.getText(source).replace(/\s+/g, ''), declaration);
        }
        // Actions publicadas por callbacks de effects alimentam o mesmo índice, sem associar nomes homônimos.
        if (!isComponent(declaration) && /\bcreateEffect\s*\(/.test(declaration.methods.get(method) ?? '')) {
          const parent = node.parent;
          if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === node)
            || (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'of')) {
            action(expression.getText(source).replace(/\s+/g, ''), declaration);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { components, surfaces, methods, diagnostics };
}

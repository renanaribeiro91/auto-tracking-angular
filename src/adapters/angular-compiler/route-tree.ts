import ts from 'typescript';
import { UNPROVEN_ROUTE_VALUE, type RouteChain, type RouteValue } from '../../application/apply/ports/project-index.js';

export type { RouteChain, RouteValue };

export interface RouteTree {
  /** Chave do componente roteado → caminhos em que ele é a tela, do módulo raiz à folha. */
  readonly chains: ReadonlyMap<string, readonly RouteChain[]>;
  /** Router liga `data` aos inputs do componente (`withComponentInputBinding()` ou `bindToComponentInputs: true`). */
  readonly inputBinding: boolean;
  /** `loadChildren` relativo cujo destino não foi provado: os filhos ficam sem o prefixo do pai. */
  readonly unresolved: readonly {
    readonly file: string; readonly line: number; readonly specifier: string; readonly empty: boolean;
    /** Componentes declarados no módulo carregado: a tela que a rota provavelmente queria mostrar. */
    readonly declared?: readonly string[];
  }[];
}

/** Herança de `data` do Angular: `emptyOnly` (padrão até a v21) ou `always` (padrão a partir da v22); `null` quando não se sabe. */
export type InheritanceStrategy = 'always' | 'emptyOnly' | null;

export interface RouteTreeSources {
  /** Versão maior do `@angular/router` instalado; decide o padrão da herança quando o código não o configura. */
  readonly routerMajor?: number | null;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  /** Componentes da rota (`component`/`loadComponent`) já resolvidos para chaves do índice. */
  readonly componentsOf: (file: string, route: ts.ObjectLiteralExpression) => readonly string[];
  readonly resolveModuleFile: (fromFile: string, specifier: string) => string | null;
}

interface RouteNode {
  readonly route: ts.ObjectLiteralExpression;
  readonly file: string;
  readonly parent: RouteNode | null;
  readonly array: ts.ArrayLiteralExpression;
}

const ROUTE_KEYS = new Set(['component', 'loadComponent', 'children', 'loadChildren', 'redirectTo']);
const ROOT_REGISTRATIONS = new Set(['forRoot', 'provideRouter']);
const CHILD_REGISTRATIONS = new Set(['forChild', 'provideRoutes']);

/**
 * Árvore de rotas Angular provada só pelo código (sem executá-lo): arrays de `Routes`, `children` (literal ou constante),
 * `loadChildren` seguido até o `RouterModule.forChild`/array do módulo carregado e registros `forRoot`/`provideRouter`.
 * Arrays `forChild` sem carregamento lazy ficam na raiz só quando o módulo é importado de forma eager no app, como no Angular.
 */
export class RouteTreeBuilder {
  build(sources: RouteTreeSources): RouteTree {
    const nodes: RouteNode[] = [];
    const arrays = new Map<ts.ArrayLiteralExpression, string>();
    const parentsOf = new Map<ts.ArrayLiteralExpression, RouteNode[]>();
    const containersOf = new Map<ts.ArrayLiteralExpression, ts.ArrayLiteralExpression[]>();
    const rootArrays = new Set<ts.ArrayLiteralExpression>();
    const childArrays = new Set<ts.ArrayLiteralExpression>();
    const registeredByFile = new Map<string, ts.ArrayLiteralExpression[]>();
    const lazyRoutes: RouteNode[] = [];
    const aliasLoaded: { node: RouteNode; specifier: string; name: string }[] = [];
    const unresolved: { file: string; line: number; specifier: string; empty: boolean; declared?: string[] }[] = [];
    const link = <K, V>(map: Map<K, V[]>, key: K, value: V): void => { map.set(key, [...(map.get(key) ?? []), value]); };

    const collect = (file: string, array: ts.ArrayLiteralExpression, parent: RouteNode | null): void => {
      if (arrays.has(array)) return;
      arrays.set(array, file);
      for (const element of array.elements) {
        if (!this.isRoute(element)) continue;
        const node: RouteNode = { route: element, file, parent, array };
        nodes.push(node);
        const children = this.property(element, 'children');
        if (children && ts.isArrayLiteralExpression(children)) collect(file, children, node);
        if (this.property(element, 'loadChildren')) lazyRoutes.push(node);
      }
    };
    this.walk(sources, (file, node) => {
      if (ts.isArrayLiteralExpression(node) && node.elements.some((element) => this.isRoute(element))
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === 'children' && this.isRoute(node.parent.parent))) {
        collect(file, node, null);
      }
    });

    // Array que espalha rotas (`[...a, ...b]`) monta os espalhados onde ele for montado.
    this.walk(sources, (file, node) => {
      if (!ts.isArrayLiteralExpression(node)) return;
      for (const element of node.elements) {
        const spread = ts.isSpreadElement(element) ? this.resolveArray(file, element.expression, sources) : null;
        if (!spread || spread === node || !arrays.has(spread)) continue;
        if (!arrays.has(node)) arrays.set(node, file);
        link(containersOf, spread, node);
      }
    });
    this.walk(sources, (file, node) => {
      if (!ts.isCallExpression(node) || !node.arguments[0]) return;
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
        : ts.isIdentifier(node.expression) ? node.expression.text : '';
      if (!ROOT_REGISTRATIONS.has(callee) && !CHILD_REGISTRATIONS.has(callee)) return;
      const registered = this.resolveArray(file, node.arguments[0], sources);
      if (!registered || !arrays.has(registered)) return;
      (ROOT_REGISTRATIONS.has(callee) ? rootArrays : childArrays).add(registered);
      link(registeredByFile, file, registered);
    });

    for (const node of nodes) {
      const children = this.property(node.route, 'children');
      if (children && !ts.isArrayLiteralExpression(children)) {
        const target = this.resolveArray(node.file, children, sources);
        if (target && arrays.has(target)) link(parentsOf, target, node);
      }
    }
    for (const node of lazyRoutes) {
      const loader = this.property(node.route, 'loadChildren')!;
      const specifier = this.dynamicImport(loader);
      if (!specifier) continue;
      const target = sources.resolveModuleFile(node.file, specifier);
      if (!target) {
        if (specifier.startsWith('.')) unresolved.push({ file: node.file, line: this.lineOf(node.route), specifier, empty: false });
        // Alias de path (`@app/...`) não é resolvido aqui; o módulo carregado pode estar no projeto e não pode virar raiz.
        else if (this.loadedExport(loader)) aliasLoaded.push({ node, specifier, name: this.loadedExport(loader)! });
        continue;
      }
      const loaded = this.loadedArrays(target, this.loadedExport(loader), sources, registeredByFile)
        .filter((array) => arrays.has(array));
      // Com `component` próprio a rota mostra a tela; o lazy só carrega o módulo dela, sem rotas é o esperado.
      const ownScreen = !!this.property(node.route, 'component') || !!this.property(node.route, 'loadComponent');
      if (!loaded.length && !ownScreen) {
        unresolved.push({ file: node.file, line: this.lineOf(node.route), specifier, empty: true, declared: this.declaredComponents(target, sources) });
      }
      for (const array of loaded) link(parentsOf, array, node);
    }

    // `forChild` sem carregamento lazy só é raiz quando o módulo dele entra no app por import eager; o que só sai num
    // barrel (`export *`) é montado por um host fora do projeto, num caminho que este código não prova.
    const importers = new Map<string, Set<string>>();
    for (const [file, source] of sources.sourceFiles) {
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
        const target = sources.resolveModuleFile(file, statement.moduleSpecifier.text);
        if (target && target !== file) importers.set(target, new Set([...(importers.get(target) ?? []), file]));
      }
    }
    const bootstrapFiles = new Set<string>();
    this.walk(sources, (file, node) => {
      if (ts.isCallExpression(node) && ['bootstrapApplication', 'bootstrapModule'].includes(
        ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '')) bootstrapFiles.add(file);
    });
    // Classe carregada por `loadChildren` com alias: os arrays do módulo dela têm pai desconhecido, nunca a raiz.
    const declares = (file: string, name: string): boolean => !!sources.sourceFiles.get(file)?.statements
      .some((statement) => ts.isClassDeclaration(statement) && statement.name?.text === name);
    const loadedByAlias = (file: string): boolean => [file, ...(importers.get(file) ?? [])]
      .some((candidate) => aliasLoaded.some((lazy) => declares(candidate, lazy.name)));
    for (const lazy of aliasLoaded) {
      if ([...sources.sourceFiles.keys()].some((file) => declares(file, lazy.name))) {
        unresolved.push({ file: lazy.node.file, line: this.lineOf(lazy.node.route), specifier: lazy.specifier, empty: false });
      }
    }
    const eager = (file: string): boolean => !loadedByAlias(file) && [...(importers.get(file) ?? [])]
      .some((module) => bootstrapFiles.has(module) || [...(importers.get(module) ?? [])].some((user) => user !== file));
    const prefixMemo = new Map<ts.ArrayLiteralExpression, RouteChain[]>();
    const prefixes = (array: ts.ArrayLiteralExpression): RouteChain[] => {
      const known = prefixMemo.get(array);
      if (known) return known;
      prefixMemo.set(array, []);
      const result = [
        ...(parentsOf.get(array) ?? []).flatMap((node) => chainsOf(node)),
        ...(containersOf.get(array) ?? []).flatMap((container) => prefixes(container)),
      ];
      if (rootArrays.has(array) || (!result.length && childArrays.has(array) && eager(arrays.get(array)!))) result.push({ pattern: '', segments: [] });
      const unique = this.unique(result);
      prefixMemo.set(array, unique);
      return unique;
    };
    const strategy = this.inheritanceStrategy(sources);
    const chainMemo = new Map<RouteNode, RouteChain[]>();
    // Herança do Angular (`paramsInheritanceStrategy: 'emptyOnly'`): filho de caminho vazio ou de pai sem componente recebe o `data` do pai.
    const componentless = new WeakSet<RouteChain>();
    const chainsOf = (node: RouteNode): RouteChain[] => {
      const known = chainMemo.get(node);
      if (known) return known;
      chainMemo.set(node, []);
      const pathNode = this.property(node.route, 'path');
      const path = pathNode ? this.resolveString(node.file, pathNode, sources) : null;
      const base = node.parent ? chainsOf(node.parent) : prefixes(node.array);
      const parts = (path ?? '').split('/').filter(Boolean);
      const dataNode = this.property(node.route, 'data');
      const own = dataNode ? this.routeValue(node.file, dataNode, sources) : undefined;
      // Resolver e resource entram no mesmo `data` e vencem o estático: o valor só existe em runtime.
      const resolvedKeys = (['resolve', 'resources'] as const).map((name) => this.property(node.route, name)).filter((item): item is ts.Expression => !!item)
        .map((item) => this.unwrap(item));
      const resolvedUnproven = resolvedKeys.some((item) => !ts.isObjectLiteralExpression(item)
        || item.properties.some((property) => !ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)));
      const resolved = Object.fromEntries(resolvedKeys.flatMap((item) => ts.isObjectLiteralExpression(item) ? item.properties : [])
        .filter(ts.isPropertyAssignment).map((property): [string, RouteValue] => [ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(), UNPROVEN_ROUTE_VALUE]));
      // `data` que não é objeto provado deixa a rota inteira sem prova.
      const staticData = own === undefined ? {} : typeof own === 'object' && own !== null && !Array.isArray(own) ? own as Record<string, RouteValue> : null;
      const ownData = staticData && !resolvedUnproven ? { ...staticData, ...resolved } : null;
      const result = path === null || parts.includes('**') ? [] : base.map((chain) => {
        const inheritedBy = (strategy: 'always' | 'emptyOnly') => strategy === 'always' || !parts.length || componentless.has(chain) ? chain.data : {};
        const merge = (inherited: RouteChain['data']): Record<string, RouteValue> | null => ownData && inherited !== null ? { ...inherited, ...ownData } : null;
        // Sem saber a estratégia, só é prova o que as duas dão igual.
        const data = strategy ? merge(inheritedBy(strategy)) : this.sameValue(merge(inheritedBy('always')), merge(inheritedBy('emptyOnly')));
        const next: RouteChain = {
          pattern: [chain.pattern, ...parts].filter(Boolean).join('/'),
          segments: [...chain.segments, ...parts.filter((part) => !part.startsWith(':'))],
          ...(data === null || Object.keys(data).length ? { data } : {}),
        };
        if (!this.property(node.route, 'component') && !this.property(node.route, 'loadComponent')) componentless.add(next);
        return next;
      });
      chainMemo.set(node, result);
      return result;
    };

    const chains = new Map<string, RouteChain[]>();
    for (const node of nodes) {
      const own = chainsOf(node).filter((chain) => chain.segments.length);
      if (!own.length) continue;
      for (const key of sources.componentsOf(node.file, node.route)) chains.set(key, this.unique([...(chains.get(key) ?? []), ...own]));
    }
    let inputBinding = false;
    this.walk(sources, (_file, node) => {
      if ((ts.isCallExpression(node) && node.expression.getText() === 'withComponentInputBinding')
        || (ts.isPropertyAssignment(node) && node.name.getText() === 'bindToComponentInputs' && node.initializer.kind === ts.SyntaxKind.TrueKeyword)) inputBinding = true;
    });
    return { chains, unresolved, inputBinding };
  }

  private walk(sources: RouteTreeSources, inspect: (file: string, node: ts.Node) => void): void {
    for (const [file, source] of sources.sourceFiles) {
      const visit = (node: ts.Node): void => {
        inspect(file, node);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }

  private isRoute(node: ts.Node): node is ts.ObjectLiteralExpression {
    if (!ts.isObjectLiteralExpression(node)) return false;
    const names = node.properties.filter(ts.isPropertyAssignment).map((property) => property.name.getText());
    return names.includes('path') && names.some((name) => ROUTE_KEYS.has(name));
  }

  private property(route: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    return route.properties.find((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === name)?.initializer;
  }

  /** Array literal, constante do arquivo ou constante importada (inclusive por barrel) de outro arquivo do projeto. */
  private resolveArray(file: string, expression: ts.Expression, sources: RouteTreeSources, depth = 0): ts.ArrayLiteralExpression | null {
    const current = this.unwrap(expression);
    if (ts.isArrayLiteralExpression(current)) return current;
    if (!ts.isIdentifier(current) || depth > 6) return null;
    const symbol = this.symbol(file, current.text, sources);
    return symbol && !ts.isEnumDeclaration(symbol.node) ? this.resolveArray(symbol.file, symbol.node, sources, depth + 1) : null;
  }

  /** Estratégia configurada no código (`forRoot(_, { paramsInheritanceStrategy })`, `withRouterConfig`) ou o padrão da versão instalada. */
  private inheritanceStrategy(sources: RouteTreeSources): InheritanceStrategy {
    const configured = new Set<string>();
    this.walk(sources, (_file, node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'paramsInheritanceStrategy') {
        const value = this.unwrap(node.initializer);
        configured.add(ts.isStringLiteralLike(value) ? value.text : '?');
      }
    });
    if (configured.size === 1 && (configured.has('always') || configured.has('emptyOnly'))) return [...configured][0] as 'always' | 'emptyOnly';
    if (configured.size) return null;
    const major = sources.routerMajor;
    return major === null || major === undefined ? null : major >= 22 ? 'always' : 'emptyOnly';
  }

  private sameValue<T>(a: T | null, b: T | null): T | null {
    const plain = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'symbol' ? '§nao-provado' : item);
    return plain(a) === plain(b) ? a : null;
  }

  /**
   * Literal do `data` como valor: string (inclusive template sem interpolação e constante/enum via `resolveString`),
   * número, booleano, `null`, array e objeto, seguindo constantes locais, importadas e de barrel. O resto é não provado.
   */
  private routeValue(file: string, expression: ts.Expression, sources: RouteTreeSources, depth = 0): RouteValue {
    const current = this.unwrap(expression);
    if (depth > 8) return UNPROVEN_ROUTE_VALUE;
    if (ts.isNumericLiteral(current)) return Number(current.text);
    if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (current.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(current)) {
      return current.elements.some(ts.isSpreadElement) ? UNPROVEN_ROUTE_VALUE : current.elements.map((element) => this.routeValue(file, element, sources, depth + 1));
    }
    if (ts.isObjectLiteralExpression(current)) {
      const value: Record<string, RouteValue> = {};
      for (const property of current.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return UNPROVEN_ROUTE_VALUE;
        value[ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText()] = this.routeValue(file, property.initializer, sources, depth + 1);
      }
      return value;
    }
    if (ts.isIdentifier(current)) {
      const symbol = this.symbol(file, current.text, sources);
      if (symbol && !ts.isEnumDeclaration(symbol.node)) return this.routeValue(symbol.file, symbol.node, sources, depth + 1);
    }
    return this.resolveString(file, current, sources) ?? UNPROVEN_ROUTE_VALUE;
  }

  /** Texto do `path`: literal, template, constante, membro de enum ou de objeto constante (local, importado ou de barrel). */
  private resolveString(file: string, expression: ts.Expression, sources: RouteTreeSources, depth = 0): string | null {
    const current = this.unwrap(expression);
    if (ts.isStringLiteralLike(current)) return current.text;
    if (depth > 6) return null;
    if (ts.isTemplateExpression(current)) {
      let text = current.head.text;
      for (const span of current.templateSpans) {
        const part = this.resolveString(file, span.expression, sources, depth + 1);
        if (part === null) return null;
        text += part + span.literal.text;
      }
      return text;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.resolveString(file, current.left, sources, depth + 1);
      const right = left === null ? null : this.resolveString(file, current.right, sources, depth + 1);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isIdentifier(current)) {
      const symbol = this.symbol(file, current.text, sources);
      return symbol && !ts.isEnumDeclaration(symbol.node) ? this.resolveString(symbol.file, symbol.node, sources, depth + 1) : null;
    }
    const access = ts.isPropertyAccessExpression(current) ? { owner: current.expression, member: current.name.text }
      : ts.isElementAccessExpression(current) && ts.isStringLiteralLike(current.argumentExpression)
        ? { owner: current.expression, member: current.argumentExpression.text } : null;
    if (!access) return null;
    const owner = this.unwrap(access.owner);
    const symbol = ts.isIdentifier(owner) ? this.symbol(file, owner.text, sources) : null;
    if (!symbol) return null;
    if (ts.isEnumDeclaration(symbol.node)) {
      const member = symbol.node.members.find((item) => item.name.getText().replace(/^['"]|['"]$/g, '') === access.member);
      return member?.initializer ? this.resolveString(symbol.file, member.initializer, sources, depth + 1) : null;
    }
    const object = this.unwrap(symbol.node);
    if (!ts.isObjectLiteralExpression(object)) return null;
    const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item)
      && item.name.getText().replace(/^['"]|['"]$/g, '') === access.member);
    return property ? this.resolveString(symbol.file, property.initializer, sources, depth + 1) : null;
  }

  private unwrap(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isTypeAssertionExpression(current)) current = current.expression;
    return current;
  }

  /** Declaração de topo de um nome visto no arquivo: local, import nomeado, `export { x } from` ou `export *` de barrel. */
  private symbol(file: string, name: string, sources: RouteTreeSources, seen = new Set<string>()):
    { file: string; node: ts.Expression | ts.EnumDeclaration } | null {
    const visitKey = `${file}#${name}`;
    const source = sources.sourceFiles.get(file);
    if (!source || seen.has(visitKey)) return null;
    seen.add(visitKey);
    for (const statement of source.statements) {
      if (ts.isEnumDeclaration(statement) && statement.name.text === name) return { file, node: statement };
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
      if (declaration?.initializer) return { file, node: declaration.initializer };
    }
    const follow = (specifier: ts.Expression | undefined, imported: string) => {
      const target = specifier && ts.isStringLiteral(specifier) ? sources.resolveModuleFile(file, specifier.text) : null;
      return target ? this.symbol(target, imported, sources, seen) : null;
    };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const bindings = statement.importClause?.namedBindings;
        const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((element) => element.name.text === name) : undefined;
        if (imported) return follow(statement.moduleSpecifier, (imported.propertyName ?? imported.name).text);
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        const clause = statement.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          const exported = clause.elements.find((element) => element.name.text === name);
          if (exported) return follow(statement.moduleSpecifier, (exported.propertyName ?? exported.name).text);
        } else if (!clause) {
          const found = follow(statement.moduleSpecifier, name);
          if (found) return found;
        }
      }
    }
    return null;
  }

  /** Rotas do arquivo carregado: a exportação lida no `then`, `export default` ou o `forChild` do módulo e dos arquivos que ele importa. */
  private loadedArrays(target: string, exported: string | null, sources: RouteTreeSources,
    registeredByFile: ReadonlyMap<string, readonly ts.ArrayLiteralExpression[]>): ts.ArrayLiteralExpression[] {
    const source = sources.sourceFiles.get(target);
    if (!source) return [];
    if (exported && exported !== 'default') {
      const declared = this.symbol(target, exported, sources);
      const array = declared && !ts.isEnumDeclaration(declared.node) ? this.resolveArray(declared.file, declared.node, sources) : null;
      if (array) return [array];
    }
    if (!exported || exported === 'default') {
      const assignment = source.statements.find(ts.isExportAssignment);
      const array = assignment ? this.resolveArray(target, assignment.expression, sources) : null;
      if (array) return [array];
    }
    const imported = source.statements.filter(ts.isImportDeclaration)
      .flatMap((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? [sources.resolveModuleFile(target, statement.moduleSpecifier.text)] : [])
      .filter((file): file is string => !!file);
    return [target, ...imported].flatMap((file) => [...(registeredByFile.get(file) ?? [])]);
  }

  /** `declarations` (NgModule) ou `imports` de componentes standalone do arquivo carregado. */
  private declaredComponents(file: string, sources: RouteTreeSources): string[] {
    const names: string[] = [];
    const source = sources.sourceFiles.get(file);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'declarations' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const element of node.initializer.elements) if (ts.isIdentifier(element)) names.push(element.text);
      }
      ts.forEachChild(node, visit);
    };
    if (source) visit(source);
    return names;
  }

  private dynamicImport(node: ts.Node): string | null {
    let specifier: string | null = null;
    const visit = (current: ts.Node): void => {
      if (!specifier && ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword
        && current.arguments[0] && ts.isStringLiteralLike(current.arguments[0])) specifier = current.arguments[0].text;
      ts.forEachChild(current, visit);
    };
    visit(node);
    return specifier;
  }

  /** `then((m) => m.Rotas)`: o nome lido do módulo carregado; sem `then`, a exportação default. */
  private loadedExport(node: ts.Node): string | null {
    let name: string | null = null;
    const visit = (current: ts.Node): void => {
      if (ts.isPropertyAccessExpression(current) && current.name.text !== 'then' && ts.isIdentifier(current.expression)) name = current.name.text;
      ts.forEachChild(current, visit);
    };
    visit(node);
    return name;
  }

  private lineOf(node: ts.Node): number {
    return node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  private unique(chains: readonly RouteChain[]): RouteChain[] {
    const seen = new Map<string, RouteChain>();
    for (const chain of chains) if (!seen.has(chain.pattern)) seen.set(chain.pattern, chain);
    return [...seen.values()].sort((a, b) => a.pattern.localeCompare(b.pattern));
  }
}

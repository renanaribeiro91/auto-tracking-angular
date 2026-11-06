import type { ComponentInfo, ProjectIndex } from './ports/project-index.js';
import type { ScreenIdentity } from './screen-identity-resolver.js';
import ts from 'typescript';

type ParentGraph = ReadonlyMap<string, ReadonlySet<string>>;
type MethodScreens = ReadonlyMap<string, ReadonlySet<string>>;

/** Descobre as telas dos componentes compartilhados usando relações estáticas do projeto. */
export class ComponentScreenResolver {
  resolve(project: ProjectIndex, identity: (component: ComponentInfo) => ScreenIdentity,
    usedMethods?: ReadonlyMap<string, ReadonlySet<string>>): (component: ComponentInfo) => string[] {
    if (usedMethods) {
      const methodsOf = (key: string, methods: ReadonlyMap<string, string>) =>
        new Map([...methods].filter(([method]) => usedMethods.get(key)?.has(method)));
      project = { ...project, opens: new Map(),
        components: project.components.map((component) => {
          const methods = methodsOf(component.key, component.methods);
          const referencedComponents = new Set([...(component.methodComponents ?? [])]
            .filter(([method]) => usedMethods.get(component.key)?.has(method)).flatMap(([, keys]) => [...keys]));
          return { ...component, methods, referencedComponents, classText: [...methods.values()].join('\n') };
        }),
        services: new Map([...project.services].map(([key, service]) => [key, { ...service,
          methods: methodsOf(key, service.methods),
          openedComponents: new Map([...service.openedComponents].filter(([method]) => usedMethods.get(key)?.has(method))),
        }])),
      };
    }
    const bySelector = this.groupBySelector(project.components);
    const serviceOpens = this.resolveServiceOpens(project.services);
    const parents = this.buildParentGraph(project, bySelector, serviceOpens, this.effectTransitions(project));
    return this.screenLookup(project, parents, identity);
  }

  private groupBySelector(components: readonly ComponentInfo[]): ReadonlyMap<string, readonly ComponentInfo[]> {
    const groups = new Map<string, ComponentInfo[]>();
    for (const component of components) {
      for (const selector of component.def.selectors) {
        const group = groups.get(selector) ?? [];
        group.push(component);
        groups.set(selector, group);
      }
    }
    return groups;
  }

  private resolveServiceOpens(services: ProjectIndex['services']): ReadonlyMap<string, MethodScreens> {
    const result = new Map<string, Map<string, Set<string>>>();
    for (const [key, service] of services) {
      result.set(key, new Map([...service.openedComponents].map(([method, components]) => [method, new Set(components)])));
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, service] of services) {
        for (const [method, body] of service.methods) {
          const opened = result.get(key)!.get(method) ?? new Set<string>();
          result.get(key)!.set(method, opened);
          for (const [calledMethod, screens] of result.get(key)!) {
            if (calledMethod !== method && this.callsReceiverMethod(body, 'this', calledMethod)) {
              changed = this.merge(opened, screens) || changed;
            }
          }
          for (const [receiver, dependencyKey] of service.dependencies) {
            const dependency = services.get(dependencyKey);
            if (!dependency) continue;
            for (const dependencyMethod of dependency.methods.keys()) {
              if (!this.callsReceiverMethod(body, receiver, dependencyMethod)) continue;
              changed = this.merge(opened, result.get(dependencyKey)?.get(dependencyMethod) ?? new Set()) || changed;
            }
          }
        }
      }
    }
    return result;
  }

  private buildParentGraph(
    project: ProjectIndex,
    bySelector: ReadonlyMap<string, readonly ComponentInfo[]>,
    serviceOpens: ReadonlyMap<string, MethodScreens>,
    transitions: ReadonlyMap<string, ReadonlySet<string>>,
  ): ParentGraph {
    const parents = new Map<string, Set<string>>();
    const byKey = new Map(project.components.map((component) => [component.key, component]));
    for (const component of project.components) {
      for (const match of component.def.template.matchAll(/<([a-z][\w-]*-[\w-]*)/gi)) {
        for (const child of bySelector.get(match[1]!.toLowerCase()) ?? []) this.link(child.key, component.key, parents);
      }
      for (const childKey of component.referencedComponents) this.link(childKey, component.key, parents);
      for (const childKey of project.opens.get(component.key) ?? []) this.link(childKey, component.key, parents);
      this.linkServiceParents(component, project.services, serviceOpens, byKey, parents, transitions, project.actionImports);
    }
    return parents;
  }

  private linkServiceParents(
    component: ComponentInfo,
    services: ProjectIndex['services'],
    serviceOpens: ReadonlyMap<string, MethodScreens>,
    components: ReadonlyMap<string, ComponentInfo>,
    parents: Map<string, Set<string>>,
    transitions: ReadonlyMap<string, ReadonlySet<string>>,
    imports: ProjectIndex['actionImports'],
  ): void {
    const reachable = this.reachableActions(component.classText, transitions, imports?.get(component.tsFile));
    for (const [receiver, serviceKey] of component.serviceDependencies) {
      const service = services.get(serviceKey);
      if (!service) continue;
      for (const [method, body] of service.methods) {
        const directCall = [...component.methods.values()].some((source) => this.callsReceiverMethod(source, receiver, method));
        const effectCall = [...this.qualifiedActionsOf(body)].some((action) =>
          reachable.has(this.canonicalAction(action, imports?.get(service.tsFile))));
        if (!directCall && !effectCall) continue;
        for (const childKey of serviceOpens.get(serviceKey)?.get(method) ?? []) {
          if (components.has(childKey)) this.link(childKey, component.key, parents);
        }
      }
    }

    // Effects NgRx podem estar fora da injeção da tela; o vínculo usa a action despachada.
    for (const [serviceKey, service] of services) {
      for (const [method, body] of service.methods) {
        if (![...this.qualifiedActionsOf(body)].some((action) =>
          reachable.has(this.canonicalAction(action, imports?.get(service.tsFile))))) continue;
        for (const childKey of serviceOpens.get(serviceKey)?.get(method) ?? []) {
          if (components.has(childKey)) this.link(childKey, component.key, parents);
        }
      }
    }
  }

  private screenLookup(
    project: ProjectIndex,
    parents: ParentGraph,
    identity: (component: ComponentInfo) => ScreenIdentity,
  ): (component: ComponentInfo) => string[] {
    const screens = new Map<string, Set<string>>(project.components.map((component) => [component.key, new Set<string>()]));
    const byKey = new Map(project.components.map((component) => [component.key, component]));
    for (const key of project.routedComponents) {
      const component = byKey.get(key);
      if (!component) continue;
      const own = identity(component);
      screens.get(key)!.add(`${own.funcionalidade}:${own.tela}`);
    }

    // Propagação monotônica até ponto fixo: ciclos não memoizam resultados parciais.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [child, ancestors] of parents) {
        if (project.routedComponents.has(child)) continue;
        const childScreens = screens.get(child);
        if (!childScreens) continue;
        for (const ancestor of ancestors) changed = this.merge(childScreens, screens.get(ancestor) ?? new Set()) || changed;
      }
    }
    return (component) => [...(screens.get(component.key) ?? [])].sort();
  }

  private callsReceiverMethod(body: string, receiver: string, method: string): boolean {
    const escapedReceiver = this.escapeRegExp(receiver);
    const escapedMethod = this.escapeRegExp(method);
    const target = receiver === 'this' ? `this\\s*\\.\\s*${escapedMethod}` : `this\\s*\\.\\s*${escapedReceiver}\\s*\\.\\s*${escapedMethod}`;
    return new RegExp(`\\b${target}\\s*\\(`).test(body);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private qualifiedActionsOf(body: string): Set<string> {
    const actions = new Set<string>();
    for (const match of body.matchAll(/\bofType\s*\(([^)]*)\)/g)) {
      for (const action of match[1]!.split(',')) {
        const name = action.trim().replace(/\s*\.\s*/g, '.');
        if (/^[\w$]+(?:\.[\w$]+)*$/.test(name)) actions.add(name);
      }
    }
    return actions;
  }

  /** Propaga somente actions retornadas por effects com dispatch habilitado. */
  private canonicalAction(action: string, imports?: ReadonlyMap<string, string>): string {
    const separator = action.indexOf('.');
    const alias = separator < 0 ? action : action.slice(0, separator);
    const target = imports?.get(alias);
    return target ? `${target}${separator < 0 ? '' : target.endsWith('#') ? action.slice(separator + 1) : action.slice(separator)}` : action;
  }

  private effectTransitions(project: ProjectIndex): ReadonlyMap<string, ReadonlySet<string>> {
    const transitions = new Map<string, Set<string>>();
    for (const service of project.services.values()) {
      const imports = project.actionImports?.get(service.tsFile);
      for (const body of service.methods.values()) {
        const inputs = new Set([...this.qualifiedActionsOf(body)].map((action) => this.canonicalAction(action, imports)));
        if (!inputs.size || !/\bcreateEffect\s*\(/.test(body) || /\bdispatch\s*:\s*false\b/.test(body)) continue;
        const parsed = ts.createSourceFile('effect.ts', `const effect = ${body};`, ts.ScriptTarget.Latest, true);
        const outputs = new Set<string>();
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const action = node.expression.getText(parsed).replace(/\s*\.\s*/g, '.');
            const parent = node.parent;
            const returnsAction = ts.isReturnStatement(parent)
              || (ts.isArrowFunction(parent) && parent.body === node)
              || (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'of');
            if (returnsAction) outputs.add(this.canonicalAction(action, imports));
          }
          ts.forEachChild(node, visit);
        };
        visit(parsed);
        for (const input of inputs) {
          const next = transitions.get(input) ?? new Set<string>();
          for (const output of outputs) next.add(output);
          transitions.set(input, next);
        }
      }
    }
    return transitions;
  }

  private reachableActions(classText: string, transitions: ReadonlyMap<string, ReadonlySet<string>>, imports?: ReadonlyMap<string, string>): Set<string> {
    const seen = new Set<string>();
    const queue = [...classText.matchAll(/\.dispatch\s*\(\s*([\w$]+(?:\s*\.\s*[\w$]+)*)\s*\(/g)]
      .map((match) => this.canonicalAction(match[1]!.replace(/\s*\.\s*/g, '.'), imports));
    for (let index = 0; index < queue.length; index++) {
      const action = queue[index]!;
      if (seen.has(action)) continue;
      seen.add(action);
      for (const next of transitions.get(action) ?? []) if (!seen.has(next)) queue.push(next);
    }
    return seen;
  }

  private link(child: string, parent: string, parents: Map<string, Set<string>>): void {
    const ancestors = parents.get(child) ?? new Set<string>();
    ancestors.add(parent);
    parents.set(child, ancestors);
  }

  private merge(target: Set<string>, values: ReadonlySet<string>): boolean {
    let changed = false;
    for (const value of values) {
      if (target.has(value)) continue;
      target.add(value);
      changed = true;
    }
    return changed;
  }
}

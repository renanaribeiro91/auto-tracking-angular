import type { ComponentInfo, ProjectIndex } from './ports/project-index.js';
import type { ScreenIdentity } from './screen-identity-resolver.js';

type ParentGraph = ReadonlyMap<string, ReadonlySet<string>>;
type MethodScreens = ReadonlyMap<string, ReadonlySet<string>>;

/** Descobre as telas dos componentes compartilhados usando relações estáticas do projeto. */
export class ComponentScreenResolver {
  resolve(project: ProjectIndex, identity: (component: ComponentInfo) => ScreenIdentity): (component: ComponentInfo) => string[] {
    const bySelector = this.groupBySelector(project.components);
    const serviceOpens = this.resolveServiceOpens(project.services);
    const parents = this.buildParentGraph(project, bySelector, serviceOpens);
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
  ): ParentGraph {
    const parents = new Map<string, Set<string>>();
    const byKey = new Map(project.components.map((component) => [component.key, component]));
    for (const component of project.components) {
      for (const match of component.def.template.matchAll(/<([a-z][\w-]*-[\w-]*)/gi)) {
        for (const child of bySelector.get(match[1]!.toLowerCase()) ?? []) this.link(child.key, component.key, parents);
      }
      for (const childKey of component.referencedComponents) this.link(childKey, component.key, parents);
      for (const childKey of project.opens.get(component.key) ?? []) this.link(childKey, component.key, parents);
      this.linkServiceParents(component, project.services, serviceOpens, byKey, parents);
    }
    return parents;
  }

  private linkServiceParents(
    component: ComponentInfo,
    services: ProjectIndex['services'],
    serviceOpens: ReadonlyMap<string, MethodScreens>,
    components: ReadonlyMap<string, ComponentInfo>,
    parents: Map<string, Set<string>>,
  ): void {
    const dispatchedActions = this.dispatchedActions(component);
    for (const [receiver, serviceKey] of component.serviceDependencies) {
      const service = services.get(serviceKey);
      if (!service) continue;
      for (const [method, body] of service.methods) {
        const directCall = [...component.methods.values()].some((source) => this.callsReceiverMethod(source, receiver, method));
        const effectCall = [...this.actionsOf(body)].some((action) => dispatchedActions.has(action));
        if (!directCall && !effectCall) continue;
        for (const childKey of serviceOpens.get(serviceKey)?.get(method) ?? []) {
          if (components.has(childKey)) this.link(childKey, component.key, parents);
        }
      }
    }

    // Effects NgRx podem estar fora da injeção da tela; o vínculo usa a action despachada.
    for (const [serviceKey, service] of services) {
      for (const [method, body] of service.methods) {
        if (![...this.actionsOf(body)].some((action) => dispatchedActions.has(action))) continue;
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

  private actionsOf(body: string): Set<string> {
    const actions = new Set<string>();
    for (const match of body.matchAll(/ofType\(([^)]*)\)/g)) {
      for (const action of match[1]!.split(',')) {
        const name = action.trim().split('.').pop();
        if (name) actions.add(name);
      }
    }
    return actions;
  }

  private dispatchedActions(component: ComponentInfo): Set<string> {
    const actions = new Set<string>();
    if (!/\.dispatch\s*\(/.test(component.classText)) return actions;
    for (const match of component.classText.matchAll(/\.dispatch\s*\(\s*(?:[\w$]+\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\(/g)) {
      actions.add(match[1]!);
    }
    return actions;
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

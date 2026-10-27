import { ComponentScreenResolver } from '../../src/application/apply/component-screen-resolver.js';
import type { ComponentInfo, ProjectIndex, ServiceInfo } from '../../src/application/apply/ports/project-index.js';

function component(key: string, selector: string, template = '', over: Partial<ComponentInfo> = {}): ComponentInfo {
  return {
    key,
    className: key.split('#').pop()!,
    tsFile: key,
    templateFile: null,
    inlineTemplate: false,
    inline: null,
    def: { selectors: [selector], source: 'projeto', outputs: new Map(), inputs: new Set(), template, methods: new Map(), hostListeners: [] },
    classText: '',
    serviceDependencies: new Map(),
    methods: new Map(),
    referencedComponents: new Set(),
    ...over,
  };
}

function project(components: ComponentInfo[], routed: string[], opens = new Map<string, ReadonlySet<string>>(), services = new Map<string, ServiceInfo>()): ProjectIndex {
  return { components, routedComponents: new Set(routed), ambiguousRoutes: [], opens, services, providerCalls: 0 };
}

const identity = (value: ComponentInfo) => ({ funcionalidade: value.className, tela: 'principal' });

describe('ComponentScreenResolver', () => {
  it('propaga telas até o ponto fixo mesmo quando as relações contêm ciclos', () => {
    const route = component('/app/route.ts#RoutePage', 'app-route', '<shared-a></shared-a>');
    const first = component('/app/a.ts#SharedA', 'shared-a', '<shared-b></shared-b>');
    const second = component('/app/b.ts#SharedB', 'shared-b', '<shared-a></shared-a>');
    const resolve = new ComponentScreenResolver().resolve(project([route, first, second], [route.key]), identity);

    expect(resolve(first)).toEqual(['RoutePage:principal']);
    expect(resolve(second)).toEqual(['RoutePage:principal']);
  });

  it('mantém a identidade de componentes homônimos por arquivo', () => {
    const routed = component('/feature-a/resumo.ts#ResumoPage', 'app-a');
    const unrouted = component('/feature-b/resumo.ts#ResumoPage', 'app-b');
    const resolve = new ComponentScreenResolver().resolve(project([routed, unrouted], [routed.key]), identity);

    expect(resolve(routed)).toEqual(['ResumoPage:principal']);
    expect(resolve(unrouted)).toEqual([]);
  });

  it('não associa um serviço quando só outro receptor chama método de mesmo nome', () => {
    const route = component('/app/route.ts#RoutePage', 'app-route', '', {
      classText: 'class RoutePage { constructor(private modalService: ModalService) {} open() { this.router.navigate(); } }',
      serviceDependencies: new Map([['modalService', 'modal-service']]),
      methods: new Map([['open', 'this.router.navigate();']]),
    });
    const modal = component('/shared/modal.ts#ModalComponent', 'app-modal');
    const service: ServiceInfo = {
      key: 'modal-service',
      className: 'ModalService',
      tsFile: '/shared/modal-service.ts',
      text: 'class ModalService {}',
      dependencies: new Map(),
      methods: new Map([['navigate', 'this.controller.open();']]),
      openedComponents: new Map([['navigate', new Set([modal.key])]]),
    };
    const resolve = new ComponentScreenResolver().resolve(project([route, modal], [route.key], new Map(), new Map([[service.key, service]])), identity);

    expect(resolve(modal)).toEqual([]);
  });
});

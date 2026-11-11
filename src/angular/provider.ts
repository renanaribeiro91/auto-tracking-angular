// T08 — provideAutoTracking: DI Angular, Injector capturado, listener único por owner, screen_view por rota
import {
  DestroyRef,
  NgZone,
  Injector,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  reflectComponentType,
  ɵɵdefineInjectable,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, type ActivatedRouteSnapshot } from '@angular/router';
import type { TrackingOptions, TrackingEvent } from '../config.js';
import { validateEvent } from '../domain/contract/schema.js';
import { AppIdentityResolver } from '../adapters/runtime/identity-resolver.js';
import { AutoTrackingSurfaces, DomEventTracker, type DomTrackerDeps, type TrackingScreen } from '../adapters/runtime/dom-tracker.js';
import { OWNER_REGISTRY_SYMBOL, TRACKING_DISPATCHER_TOKEN_NAME, TRACKING_OPTIONS_TOKEN_NAME } from './provider.constants.js';

export const TRACKING_OPTIONS = new InjectionToken<TrackingOptions>(TRACKING_OPTIONS_TOKEN_NAME);

function routedSelector(router: Router): string | null {
  let snapshot = router.routerState?.snapshot.root;
  let selector: string | null = null;
  while (snapshot) {
    const component = snapshot.component as Type<unknown> | null;
    if (component) selector = reflectComponentType(component)?.selector ?? selector;
    if (!snapshot.firstChild) break;
    snapshot = snapshot.firstChild;
  }
  return selector;
}

/** Caminho de rota ativo pelos padrões do código (`reembolso/opcao-reembolso`), incluindo o prefixo do host. */
function routedPattern(router: Router): string | null {
  const paths: string[] = [];
  for (let snapshot: ActivatedRouteSnapshot | null | undefined = router.routerState?.snapshot.root; snapshot; snapshot = snapshot.firstChild) {
    const path = snapshot.routeConfig?.path;
    if (path) paths.push(path);
  }
  return paths.length ? paths.join('/') : null;
}

export class TrackingDispatcher {
  private nativeEnvironment: string | null = null;
  private identityInFlight: Promise<Awaited<ReturnType<AppIdentityResolver['resolve']>>> | null = null;
  private readonly identityResolver = new AppIdentityResolver();

  constructor(private readonly options: TrackingOptions, private readonly injector: Injector) {}

  /** Nativo é estável e fica em cache; tema Web pode mudar e é relido a cada evento */
  async resolveEnvironment(): Promise<string | null> {
    if (this.nativeEnvironment) return this.nativeEnvironment;
    const getWebTheme = this.options.getWebTheme;
    // Eventos simultâneos na inicialização não podem disparar várias
    // consultas nativas App.getInfo(). Na Web, o tema continua dinâmico.
    const pending = this.identityInFlight ??= this.identityResolver.resolve(
      this.options.preset, getWebTheme ? () => getWebTheme(this.injector) : undefined);
    let result: Awaited<typeof pending>;
    try {
      result = await pending;
    } finally {
      if (this.identityInFlight === pending) this.identityInFlight = null;
    }
    if (result.kind === 'native') this.nativeEnvironment = result.result.environment;
    if (result.kind === 'unknown') {
      console.warn(`[auto-tracking] ambiente não resolvido: ${result.reason}`);
      return null;
    }
    return result.kind === 'native' ? result.result.environment : result.environment;
  }

  async send(event: TrackingEvent): Promise<void> {
    await this.options.send(event, this.injector);
  }

  /** Eventos disparados por código exigem origem e regra explícitas no preset do consumidor. */
  async track(name: string, origin: TrackingScreen, params: Readonly<Record<string, string>> = {}): Promise<void> {
    if (!origin?.funcionalidade || !origin.tela || !this.options.preset.schema[name]) {
      throw new Error('[auto-tracking] evento programático sem tela de origem ou schema');
    }
    const screen = { ...origin };
    const attributes = { ...params };
    const environment = await this.resolveEnvironment();
    if (!environment) {
      console.warn(`[auto-tracking] ${name} não enviado: ambiente não resolvido`);
      return;
    }
    const event: TrackingEvent = { name, params: DomEventTracker.fitSchema(name, {
      ...attributes, ...DomEventTracker.baseParams(screen, environment, this.options.product),
    }, this.options.preset.schema) };
    const validation = validateEvent(event, this.options.preset.schema);
    if (validation.kind !== 'valid') {
      throw new Error(`[auto-tracking] ${name} rejeitado pelo schema: ${validation.kind} ${validation.params.join(',')}`);
    }
    await this.send(event);
  }
}

export const TRACKING_DISPATCHER = new InjectionToken<TrackingDispatcher>(TRACKING_DISPATCHER_TOKEN_NAME);

interface OwnerLease {
  activate(): void;
  deactivate(): void;
}
interface OwnerGroup {
  current: OwnerLease | null;
  readonly standby: OwnerLease[];
}

/** Sessões por Document e owner: uma escuta ativa e transferência segura no teardown. */
class AutoTrackingLifecycle {
  private lastUrl: string | null = null;
  private disposed = false;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly options: TrackingOptions) {}

  start(): void {
    try {
      this.startInInjectionContext();
    } catch (error) {
      // Um adaptador de analytics mal configurado não pode abortar o
      // bootstrap/navegação do projeto consumidor.
      console.warn(`[auto-tracking] provider indisponível: ${String(error)}`);
    }
  }

  private startInInjectionContext(): void {
    // Todas as dependências são capturadas no contexto de injeção. A biblioteca
    // nunca exige que o consumidor forneça um módulo ou uma classe específicos.
    const document = inject(DOCUMENT);
    const dispatcher = inject(TRACKING_DISPATCHER);
    const surfaces = inject(AutoTrackingSurfaces);
    const router = inject(Router, { optional: true });
    const zone = inject(NgZone, { optional: true });
    const destroyRef = inject(DestroyRef);
    if (!document?.defaultView || !document.documentElement) return; // SSR

    const registry = AutoTrackingLifecycle.ownerRegistry(document);
    const owner = this.options.owner;
    let group = registry.get(owner);
    if (!group) {
      group = { current: null, standby: [] };
      registry.set(owner, group);
    }
    const currentGroup = group;
    let teardown: (() => void) | null = null;

    const lease: OwnerLease = {
      activate: () => {
        if (this.disposed) return;
        let stopDom: (() => void) | undefined;
        let subscription: { unsubscribe(): void } | undefined;
        let deactivateSurfaces: (() => void) | undefined;
        try {
          const tracker = new DomEventTracker(document, this.dependencies(dispatcher, surfaces));
          // Eventos e MutationObserver não devem disparar detecção de mudanças
          // do Angular em cada clique/mutação de outro componente/owner.
          const register = (): void => {
            stopDom = tracker.install();
            subscription = router?.events.subscribe((event: unknown) => {
              if (!(event instanceof NavigationEnd)) return;
              // O Router pode emitir dentro da Zone mesmo quando a inscrição
              // ocorreu fora dela. Timers de tracking continuam externos.
              const handle = (): void => this.onRouterEvent(event, router, tracker);
              if (zone) zone.runOutsideAngular(handle);
              else handle();
            });
          };
          if (zone) zone.runOutsideAngular(register);
          else register();
          if (surfaces) deactivateSurfaces = AutoTrackingSurfaces.activate(document, surfaces);
          teardown = () => {
            deactivateSurfaces?.();
            subscription?.unsubscribe();
            stopDom?.();
          };
        } catch (error) {
          deactivateSurfaces?.();
          subscription?.unsubscribe();
          stopDom?.();
          console.warn(`[auto-tracking] inicialização isolada: ${String(error)}`);
        }
      },
      deactivate: () => {
        for (const timer of this.pendingTimers) clearTimeout(timer);
        this.pendingTimers.clear();
        teardown?.();
        teardown = null;
        this.lastUrl = null;
      },
    };

    if (currentGroup.current) currentGroup.standby.push(lease);
    else {
      currentGroup.current = lease;
      lease.activate();
    }

    destroyRef.onDestroy(() => {
      this.disposed = true;
      if (currentGroup.current === lease) {
        lease.deactivate();
        const next = currentGroup.standby.shift() ?? null;
        currentGroup.current = next;
        next?.activate();
      } else {
        const index = currentGroup.standby.indexOf(lease);
        if (index >= 0) currentGroup.standby.splice(index, 1);
      }
      if (!currentGroup.current && currentGroup.standby.length === 0) registry.delete(owner);
    });
  }

  private dependencies(dispatcher: TrackingDispatcher, surfaces: AutoTrackingSurfaces): DomTrackerDeps {
    return {
      root: this.options.root,
      owner: this.options.owner,
      product: this.options.product,
      schema: this.options.preset.schema,
      mode: this.options.mode ?? 'classic',
      surfaces,
      resolveEnvironment: () => dispatcher.resolveEnvironment(),
      send: (event) => dispatcher.send(event),
      warn: (message) => console.warn(message),
    };
  }

  private onRouterEvent(event: unknown, router: Router, tracker: DomEventTracker): void {
    if (this.disposed || !(event instanceof NavigationEnd) || event.urlAfterRedirects === this.lastUrl) return;
    // Rotas anteriores não podem emitir telas atrasadas após navegação rápida.
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.lastUrl = event.urlAfterRedirects;
    try {
      const selector = routedSelector(router);
      if (selector) this.scheduleScreenView(tracker, selector, routedPattern(router));
    } catch (error) {
      console.warn(`[auto-tracking] navegação não instrumentada: ${String(error)}`);
    }
  }

  private scheduleScreenView(tracker: DomEventTracker, selector: string, activePattern: string | null): void {
    // Cancelar tarefas após o teardown evita acessar o DOM de uma rota/MFE destruído.
    const schedule = (delay: number, retry: boolean): void => {
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.disposed) return;
        try {
          if (!tracker.emitScreenView(selector, activePattern) && retry) schedule(300, false);
        } catch (error) {
          console.warn(`[auto-tracking] screen_view ignorado com segurança: ${String(error)}`);
        }
      }, delay);
      this.pendingTimers.add(timer);
    };
    schedule(0, true);
  }

  private static ownerRegistry(document: Document): Map<string, OwnerGroup> {
    // WeakMap evita vazamento entre documentos de SSR, iframes e testes;
    // Symbol permite coordenação entre bundles que carreguem cópias da lib.
    const global = globalThis as typeof globalThis & {
      [key: symbol]: WeakMap<Document, Map<string, OwnerGroup>> | undefined;
    };
    const documents = (global[OWNER_REGISTRY_SYMBOL] ??= new WeakMap());
    let registry = documents.get(document);
    if (!registry) {
      registry = new Map<string, OwnerGroup>();
      documents.set(document, registry);
    }
    return registry;
  }
}

// Injector sem provideAutoTracking (service `providedIn: 'root'` de MFE no host) recebe uma instância
// sem owner: attach resolve o owner pela ref gravada pelo CLI, e nunca injeta null.
(AutoTrackingSurfaces as unknown as { ɵprov: unknown }).ɵprov = ɵɵdefineInjectable({
  token: AutoTrackingSurfaces, providedIn: 'root', factory: () => new AutoTrackingSurfaces(''),
});

/**
 * Registra o auto-tracking no bootstrap (NgModule, standalone ou módulo lazy de MFE).
 * O Injector é capturado na criação do provider; getWebTheme/send recebem esse Injector em toda chamada.
 */
export function provideAutoTracking(options: TrackingOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: TRACKING_OPTIONS, useValue: options },
    { provide: AutoTrackingSurfaces, useFactory: () => {
      const document = inject(DOCUMENT);
      const router = inject(Router, { optional: true });
      return new AutoTrackingSurfaces(options.owner, () => {
        const selector = router ? routedSelector(router) : null;
        return selector ? DomEventTracker.screenForHost(document, selector, options.mode ?? 'classic', options.owner, routedPattern(router!)) : null;
      });
    } },
    { provide: TRACKING_DISPATCHER, useFactory: () => new TrackingDispatcher(options, inject(Injector)) },
    provideEnvironmentInitializer(() => new AutoTrackingLifecycle(options).start()),
  ]);
}

// T08 — provideAutoTracking: DI Angular, Injector capturado, listener único por owner, screen_view por rota
import {
  DestroyRef,
  ENVIRONMENT_INITIALIZER,
  Injector,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  reflectComponentType,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import type { TrackingOptions, TrackingEvent } from '../config.js';
import { AppIdentityResolver } from '../adapters/runtime/identity-resolver.js';
import { DomEventTracker, type DomTrackerDeps } from '../adapters/runtime/dom-tracker.js';
import { OWNER_REGISTRY_SYMBOL, TRACKING_DISPATCHER_TOKEN_NAME, TRACKING_OPTIONS_TOKEN_NAME } from './provider.constants.js';

export const TRACKING_OPTIONS = new InjectionToken<TrackingOptions>(TRACKING_OPTIONS_TOKEN_NAME);

export class TrackingDispatcher {
  private nativeEnvironment: string | null = null;
  private readonly identityResolver = new AppIdentityResolver();

  constructor(private readonly options: TrackingOptions, private readonly injector: Injector) {}

  /** Nativo é estável e fica em cache; tema Web pode mudar e é relido a cada evento */
  async resolveEnvironment(): Promise<string | null> {
    if (this.nativeEnvironment) return this.nativeEnvironment;
    const getWebTheme = this.options.getWebTheme;
    const result = await this.identityResolver.resolve(this.options.preset, getWebTheme ? () => getWebTheme(this.injector) : undefined);
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
}

export const TRACKING_DISPATCHER = new InjectionToken<TrackingDispatcher>(TRACKING_DISPATCHER_TOKEN_NAME);

/** Owners ativos na página; compartilhado entre bundles (Host e MFE) via Symbol global. */
class AutoTrackingLifecycle {
  private lastUrl: string | null = null;

  constructor(private readonly options: TrackingOptions) {}

  start(): void {
    const registry = AutoTrackingLifecycle.ownerRegistry();
    // Owners ativos na página são únicos mesmo quando Host e MFE inicializam o provider.
    if (registry.has(this.options.owner)) return;

    const document = inject(DOCUMENT);
    const dispatcher = inject(TRACKING_DISPATCHER);
    const router = inject(Router, { optional: true });
    const destroyRef = inject(DestroyRef);
    registry.add(this.options.owner);

    const tracker = new DomEventTracker(document, this.dependencies(dispatcher));
    const stopDom = tracker.install();
    const subscription = router?.events.subscribe((event: unknown) => this.onRouterEvent(event, router, tracker));

    destroyRef.onDestroy(() => {
      stopDom();
      subscription?.unsubscribe();
      registry.delete(this.options.owner);
    });
  }

  private dependencies(dispatcher: TrackingDispatcher): DomTrackerDeps {
    return {
      owner: this.options.owner,
      product: this.options.product,
      schema: this.options.preset.schema,
      resolveEnvironment: () => dispatcher.resolveEnvironment(),
      send: (event) => dispatcher.send(event),
      warn: (message) => console.warn(message),
    };
  }

  private onRouterEvent(event: unknown, router: Router, tracker: DomEventTracker): void {
    if (!(event instanceof NavigationEnd) || event.urlAfterRedirects === this.lastUrl) return;
    this.lastUrl = event.urlAfterRedirects;
    const selector = this.routedSelector(router);
    if (selector) this.scheduleScreenView(tracker, selector);
  }

  private scheduleScreenView(tracker: DomEventTracker, selector: string): void {
    // O template do componente roteado renderiza após o ciclo de detecção da navegação.
    setTimeout(() => {
      if (!tracker.emitScreenView(selector)) setTimeout(() => tracker.emitScreenView(selector), 300);
    });
  }

  private routedSelector(router: Router): string | null {
    let snapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) snapshot = snapshot.firstChild;
    const component = snapshot.component as Type<unknown> | null;
    return component ? reflectComponentType(component)?.selector ?? null : null;
  }

  private static ownerRegistry(): Set<string> {
    const global = globalThis as typeof globalThis & { [key: symbol]: Set<string> | undefined };
    return (global[OWNER_REGISTRY_SYMBOL] ??= new Set<string>());
  }
}

/**
 * Registra o auto-tracking no bootstrap (NgModule, standalone ou módulo lazy de MFE).
 * O Injector é capturado na criação do provider; getWebTheme/send recebem esse Injector em toda chamada.
 */
export function provideAutoTracking(options: TrackingOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: TRACKING_OPTIONS, useValue: options },
    { provide: TRACKING_DISPATCHER, useFactory: () => new TrackingDispatcher(options, inject(Injector)) },
    { provide: ENVIRONMENT_INITIALIZER, multi: true, useValue: () => new AutoTrackingLifecycle(options).start() },
  ]);
}

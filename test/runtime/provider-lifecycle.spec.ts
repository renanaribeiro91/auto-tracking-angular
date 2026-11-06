/** @jest-environment jsdom */
import type { TrackingEvent, TrackingOptions } from '../../src/config.js';
import { examplePreset } from '../fixtures/preset/index.js';

// O teste executa o lifecycle real com um container DI controlado, sem app consumidor.
const tokens = {
  INITIALIZER: Symbol('environment-initializer'),
  DOCUMENT: Symbol('DOCUMENT'),
};
let dependencyContext = new Map<unknown, unknown>();
jest.mock('@angular/core', () => ({
  provideEnvironmentInitializer: (initializer: () => void) => ({ provide: tokens.INITIALIZER, useValue: initializer }),
  Injector: class Injector {},
  DestroyRef: class DestroyRef {},
  NgZone: class NgZone {},
  InjectionToken: class InjectionToken { constructor(readonly description: string) {} },
  inject: (token: unknown) => dependencyContext.get(token),
  makeEnvironmentProviders: (providers: unknown[]) => providers,
  reflectComponentType: (component: { selector?: string }) => component.selector ? { selector: component.selector } : null,
}));
jest.mock('@angular/common', () => ({ DOCUMENT: tokens.DOCUMENT }));
jest.mock('@angular/router', () => ({
  Router: class Router {},
  NavigationEnd: class NavigationEnd {},
}));

import { DestroyRef, Injector, NgZone } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { provideAutoTracking, TRACKING_DISPATCHER, TrackingDispatcher } from '../../src/angular/provider.js';
import { AutoTrackingSurfaces } from '../../src/adapters/runtime/dom-tracker.js';

const zoneRuns = jest.fn();
type Provider = { provide: unknown; useFactory?: () => unknown; useValue?: () => void };
function activate(owner: string, sent: TrackingEvent[]): () => void {
  const cleanup: Array<() => void> = [];
  const options: TrackingOptions = {
    owner, root: 'app-root', product: 'saude', preset: examplePreset,
    mode: 'classic', getWebTheme: () => 'saude',
    send: (event) => { sent.push(event); },
  };
  const providers = provideAutoTracking(options) as unknown as Provider[];
  const dispatcherFactory = providers.find((entry) => entry.provide === TRACKING_DISPATCHER)?.useFactory!;
  dependencyContext = new Map<unknown, unknown>([[Injector, {}]]);
  const dispatcher = dispatcherFactory();
  dependencyContext = new Map<unknown, unknown>([
    [DOCUMENT, document],
    [TRACKING_DISPATCHER, dispatcher],
    [Router, null],
    [NgZone, { runOutsideAngular: (callback: () => void) => { zoneRuns(); return callback(); } }],
    [DestroyRef, { onDestroy: (fn: () => void) => cleanup.push(fn) }],
  ]);
  providers.find((entry) => entry.provide === tokens.INITIALIZER)?.useValue?.();
  return () => cleanup.forEach((fn) => fn());
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('provider Angular/Ionic independente de aplicação específica', () => {
  it('captura a página roteada mesmo com rota filha sem componente e ignora outro owner', () => {
    document.body.innerHTML = '<app-page><div data-at-owner="foreign" data-at-screen="foreign" data-at-funcionalidade="outra" data-at-tela="outra"></div><div data-at-owner="app" data-at-screen="tipo" data-at-funcionalidade="reembolso" data-at-tela="tipo"></div></app-page>';
    const providers = provideAutoTracking({ owner: 'app', root: 'app-root', product: 'saude', preset: examplePreset,
      mode: 'classic', getWebTheme: () => 'saude', send: () => {} }) as unknown as Provider[];
    dependencyContext = new Map<unknown, unknown>([[DOCUMENT, document], [Router, {
      routerState: { snapshot: { root: { component: { selector: 'app-page' }, firstChild: { component: null } } } },
    }]]);
    const surfaces = providers.find((entry) => entry.provide === AutoTrackingSurfaces)!.useFactory!() as AutoTrackingSurfaces;
    expect(surfaces.capture()).toEqual({ funcionalidade: 'reembolso', tela: 'tipo' });
    const stale = document.querySelector('app-page')!.cloneNode(true) as Element;
    stale.setAttribute('aria-hidden', 'true');
    stale.querySelector('[data-at-owner="app"]')!.setAttribute('data-at-tela', 'antiga');
    document.body.prepend(stale);
    expect(surfaces.capture()).toEqual({ funcionalidade: 'reembolso', tela: 'tipo' });
    document.querySelector('app-page:not([aria-hidden]) [data-at-owner="app"]')!.remove();
    expect(surfaces.capture()).toBeNull();
  });

  it('evento de abertura programática usa a tela capturada e valida o schema', async () => {
    const sent: TrackingEvent[] = [];
    const options: TrackingOptions = {
      owner: 'app', root: 'app-root', product: 'saude', getWebTheme: () => 'saude',
      preset: { ...examplePreset, schema: { ...examplePreset.schema, modal_open: {
        requiredParams: ['ambiente', 'produto', 'funcionalidade', 'tela', 'modal'],
        allowedParams: ['ambiente', 'produto', 'funcionalidade', 'tela', 'modal'],
      } } },
      send: (event) => { sent.push(event); },
    };
    const dispatcher = new TrackingDispatcher(options, {} as Injector);
    const origin = { funcionalidade: 'reembolso', tela: 'detalhes-documentacao' };
    const event = dispatcher.track('modal_open', origin, { modal: 'indisponibilidade' });
    origin.tela = 'outra-tela';
    await event;
    expect(sent).toEqual([{ name: 'modal_open', params: {
      ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso',
      tela: 'app-x:saude:detalhes-documentacao', modal: 'indisponibilidade',
    } }]);
    await expect(dispatcher.track('modal_open', origin, { modal: 'indisponibilidade', nome: 'Maria' }))
      .rejects.toThrow('rejeitado pelo schema');
    await expect(dispatcher.track('evento-desconhecido', origin)).rejects.toThrow('sem tela de origem ou schema');
    expect(sent).toHaveLength(1);
  });

  it('agrupa consultas de identidade concorrentes e permite reler tema Web depois', async () => {
    let lookups = 0;
    const options: TrackingOptions = {
      owner: 'app', root: 'app-root', product: 'saude', preset: examplePreset,
      getWebTheme: async () => {
        lookups++;
        await new Promise((resolve) => setTimeout(resolve, 2));
        return 'saude';
      },
      send: () => {},
    };
    const dispatcher = new TrackingDispatcher(options, {} as Injector);
    const simultaneous = await Promise.all(Array.from({ length: 40 }, () => dispatcher.resolveEnvironment()));
    expect(simultaneous).toEqual(Array(40).fill('app-x'));
    expect(lookups).toBe(1);
    expect(await dispatcher.resolveEnvironment()).toBe('app-x');
    expect(lookups).toBe(2);
  });

  beforeEach(() => {
    zoneRuns.mockClear();
    document.body.innerHTML = '<app-root><button id="go" data-at-id="go" data-at-owner="app" data-at-funcionalidade="saude" data-at-tela="inicio" data-at-elemento="botao" data-at-rotulo="ir">Ir</button></app-root>';
  });

  it('handover: dois injectors do mesmo owner não duplicam; ao destruir o primeiro, o segundo assume', async () => {
    const first: TrackingEvent[] = [];
    const second: TrackingEvent[] = [];
    const stopFirst = activate('app', first);
    const stopSecond = activate('app', second);
    const click = async () => {
      document.getElementById('go')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await flush();
    };
    try {
      await click();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
      expect(zoneRuns).toHaveBeenCalledTimes(1);
      stopFirst();
      await click();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(zoneRuns).toHaveBeenCalledTimes(2);
      stopSecond();
      await click();
      expect(second).toHaveLength(1);
    } finally {
      stopFirst();
      stopSecond();
    }
  });
});

/** @jest-environment jsdom */
// Diretivas fictícias no host: o runtime acha o @Output pelo metadado da própria diretiva, sem conhecer o nome dela.
const directivesOf = new Map<Element, object[]>();
jest.mock('@angular/core', () => ({
  provideEnvironmentInitializer: () => ({}),
  Injector: class Injector {},
  DestroyRef: class DestroyRef {},
  NgZone: class NgZone {},
  InjectionToken: class InjectionToken { constructor(readonly description: string) {} },
  inject: () => undefined,
  makeEnvironmentProviders: (providers: unknown[]) => providers,
  ɵɵdefineInjectable: (definition: unknown) => definition,
  reflectComponentType: () => null,
  ɵgetDirectives: (element: Element) => directivesOf.get(element) ?? [],
}));
jest.mock('@angular/common', () => ({ DOCUMENT: Symbol('DOCUMENT') }));
jest.mock('@angular/router', () => ({ Router: class Router {}, NavigationEnd: class NavigationEnd {} }));

import { subscribeDirectiveOutput } from '../../src/angular/provider.js';

class Emitter { private listeners: (() => void)[] = []; subscribe(listener: () => void) { this.listeners.push(listener); return { unsubscribe: () => { this.listeners = this.listeners.filter((item) => item !== listener); } }; } emit() { for (const listener of this.listeners) listener(); } }
/** `output()` do Angular: subscribe devolve um objeto com unsubscribe; `ɵdir.outputs` mapeia propriedade → nome público. */
class QualquerGesto { static ɵdir = { outputs: { _esq: 'esquerda' } }; _esq = new Emitter(); }
class OutraDiretiva { static ɵdir = { outputs: { foi: 'foi' } }; foi = new Emitter(); }

describe('inscrição no @Output real da diretiva do host', () => {
  it('acha o output pelo nome público, entrega cada emissão e cancela', () => {
    const host = document.createElement('div');
    const gesture = new QualquerGesto();
    directivesOf.set(host, [new OutraDiretiva(), gesture]);
    let calls = 0;
    const cancel = subscribeDirectiveOutput(host, 'esquerda', () => calls++)!;
    gesture._esq.emit();
    expect(calls).toBe(1);
    cancel();
    gesture._esq.emit();
    expect(calls).toBe(1);
  });

  it.each([
    ['host sem diretiva', () => document.createElement('div')],
    ['diretiva sem esse output', () => { const host = document.createElement('div'); directivesOf.set(host, [new OutraDiretiva()]); return host; }],
  ])('%s: null, nada é inscrito', (_case, host) => {
    expect(subscribeDirectiveOutput(host(), 'esquerda', () => {})).toBeNull();
  });
});

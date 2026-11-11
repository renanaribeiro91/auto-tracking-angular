/** @jest-environment jsdom */
import { installDomTracker, type DomTrackerDeps } from '../../src/adapters/runtime/dom-tracker.js';
import { DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token-encoder.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { decodeScreenRoutes, encodeScreenRoutes, screenForRoute } from '../../src/domain/contract/screen-binding.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const routes = [
  { pattern: 'extratos/opcao-extrato', funcionalidade: 'extratos', tela: 'opcao-extrato' },
  { pattern: 'reembolso/opcao-reembolso', funcionalidade: 'reembolso', tela: 'opcao-reembolso' },
];

describe('página roteada em mais de um caminho: tela pela rota ativa, nunca pelo nome do componente', () => {
  const sent: TrackingEvent[] = [];
  const warnings: string[] = [];
  let stop: () => void;
  const deps = (): DomTrackerDeps => ({ owner: 'mfe', product: 'saude', schema: examplePreset.schema, mode: 'ref',
    resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (message) => { warnings.push(message); } });

  beforeEach(() => {
    sent.length = 0; warnings.length = 0;
    const marker = encodeTrackingToken({ owner: 'mfe', funcionalidade: 'extratos', tela: 'opcao-extrato', screenId: 'escolha-tela', routes });
    const voltar = encodeTrackingToken({ owner: 'mfe', funcionalidade: 'extratos', tela: 'opcao-extrato',
      click: { id: 'escolha-voltar', event: 'click', elemento: 'botao', rotulo: 'voltar' } });
    document.body.innerHTML = `<app-root><lib-escolha><div data-at-ref="${marker}"></div><button id="voltar" data-at-ref="${voltar}">Voltar</button></lib-escolha></app-root>`;
    stop = installDomTracker(document, deps());
  });
  afterEach(() => stop());

  it('o token guarda as rotas e falha fechado para lista malformada', () => {
    expect(decodeTrackingToken(encodeTrackingToken({ owner: 'mfe', funcionalidade: 'a', tela: 'b', screenId: 's', routes }))?.routes).toEqual(routes);
    expect(() => encodeTrackingToken({ owner: 'mfe', funcionalidade: 'a', tela: 'b', screenId: 's', routes: [routes[0]!] })).toThrow('contrato de tracking inválido');
  });

  it('casa o padrão pelo fim do caminho ativo, inclusive sob o prefixo do host, e só em fronteira de nível', () => {
    expect(screenForRoute(routes, 'saude/reembolso/opcao-reembolso')?.funcionalidade).toBe('reembolso');
    expect(screenForRoute(routes, 'extratos/opcao-extrato')?.funcionalidade).toBe('extratos');
    expect(screenForRoute(routes, 'saude/xreembolso/opcao-reembolso')).toBeNull();
    expect(screenForRoute(routes, null)).toBeNull();
    // O padrão mais específico vence quando dois casam com o fim do caminho.
    const nested = [{ pattern: 'opcao', funcionalidade: 'geral', tela: 'opcao' }, { pattern: 'reembolso/opcao', funcionalidade: 'reembolso', tela: 'opcao' }];
    expect(screenForRoute(nested, 'saude/reembolso/opcao')?.funcionalidade).toBe('reembolso');
    expect(screenForRoute([...nested].reverse(), 'saude/reembolso/opcao')?.funcionalidade).toBe('reembolso');
  });

  it('modo classic: data-at-routes ida e volta e a tela escolhida pela rota ativa', async () => {
    expect(decodeScreenRoutes(encodeScreenRoutes(routes))).toEqual(routes);
    stop();
    const classic: DomTrackerDeps = { ...deps(), mode: 'classic' };
    document.body.innerHTML = `<app-root><lib-escolha><div data-at-screen="escolha-tela" data-at-owner="mfe" data-at-funcionalidade="extratos"
      data-at-tela="opcao-extrato" data-at-routes="${encodeScreenRoutes(routes)}"></div></lib-escolha></app-root>`;
    const tracker = new DomEventTracker(document, classic);
    stop = tracker.install();
    tracker.emitScreenView('lib-escolha', 'saude/reembolso/opcao-reembolso');
    await flush();
    expect(sent.map((event) => event.params['tela'])).toEqual(['app-x:saude:reembolso:opcao-reembolso']);
  });

  it('screen_view e cliques saem com a tela da rota ativa', async () => {
    const tracker = new DomEventTracker(document, deps());
    tracker.install();
    expect(tracker.emitScreenView('lib-escolha', 'saude/reembolso/opcao-reembolso')).toBe(true);
    document.getElementById('voltar')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    const params = sent.map((event) => [event.name, event.params['funcionalidade'], event.params['subfuncionalidade'], event.params['tela']]);
    expect(params).toEqual(expect.arrayContaining([
      ['screen_view', 'reembolso', 'opcao-reembolso', 'app-x:saude:reembolso:opcao-reembolso'],
      ['click', 'reembolso', 'opcao-reembolso', 'app-x:saude:reembolso:opcao-reembolso'],
    ]));
    expect(sent.some((event) => event.params['funcionalidade'] === 'extratos')).toBe(false);
  });

  it('rota ativa fora dos caminhos provados não envia tela errada', async () => {
    const tracker = new DomEventTracker(document, deps());
    tracker.install();
    expect(tracker.emitScreenView('lib-escolha', 'saude/outra/rota')).toBe(true);
    await flush();
    expect(sent.filter((event) => event.name === 'screen_view')).toHaveLength(0);
    expect(warnings.some((message) => message.includes('screen_view ignorado'))).toBe(true);
  });
});

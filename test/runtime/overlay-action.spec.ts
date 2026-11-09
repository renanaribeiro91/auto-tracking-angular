/** @jest-environment jsdom */
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';
import { overlayComponentName } from '../../src/domain/contract/slug.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('overlay criado por código sem marcação', () => {
  const start = (owner: string, screen: { funcionalidade: string; tela: string } | null, sent: TrackingEvent[]) =>
    installDomTracker(document, { owner, mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces(owner, () => screen),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });

  it('ação de action-sheet/alert usa a tela visível do owner dono da página e o rótulo exibido', async () => {
    document.body.innerHTML = `<ion-action-sheet><div class="action-sheet-group"><button class="action-sheet-button action-sheet-camera"><span>Câmera</span></button>
      <p>Escolha</p></div></ion-action-sheet><ion-alert><h2 class="alert-title">Atenção</h2><button class="alert-button">Ok, entendi</button></ion-alert>`;
    const fed: TrackingEvent[] = []; const host: TrackingEvent[] = [];
    const stops = [start('fed', { funcionalidade: 'reembolso', tela: 'anexo' }, fed), start('host', null, host)];
    try {
      document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('.alert-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(fed.map((event) => [event.params['tela'], event.params['elemento'], event.params['rotulo']])).toEqual([
        ['app-x:saude:reembolso:anexo', 'menu-de-opcoes', 'camera-menu-de-opcoes'], ['app-x:saude:reembolso:anexo', 'alerta', 'ok-entendi-atencao']]);
      expect(host).toEqual([]);
    } finally { stops.forEach((stop) => stop()); }
  });

  it('botão Ionic com shadow DOM usa o texto projetado no host e o título do modal como contexto', async () => {
    document.body.innerHTML = `<ion-modal><h2 role="text" aria-label="Desculpe!">Desculpe!</h2><i role="button" aria-label="Botão fechar da modal"></i>
      <p>Estamos com problemas técnicos.</p><bsad-button><ion-button><div><ion-label>OK</ion-label></div></ion-button></bsad-button></ion-modal>`;
    const button = document.querySelector('ion-button')!;
    button.attachShadow({ mode: 'open' }).innerHTML = '<button class="button-native"><span><slot></slot></span></button>';
    const sent: TrackingEvent[] = [];
    const stop = start('fed', { funcionalidade: 'busca', tela: 'resultado' }, sent);
    try {
      document.querySelector('ion-label')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      document.querySelector('i')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(sent.map((event) => [event.params['elemento'], event.params['rotulo']])).toEqual([
        ['modal', 'ok-desculpe'], ['modal', 'fechar-desculpe']]);
    } finally { stop(); }
  });

  it('contexto vem do aria-labelledby e, sem título público, do tipo do modal', async () => {
    document.body.innerHTML = `<span id="t">Indisponível</span><ion-modal aria-labelledby="t"><button>Entendi</button></ion-modal>
      <ion-modal><button>Fechar</button></ion-modal><ion-modal><h3>Contato 11 99999-9999</h3><button>Ligar</button></ion-modal>`;
    const sent: TrackingEvent[] = [];
    const stop = start('fed', { funcionalidade: 'r', tela: 't' }, sent);
    try {
      document.querySelectorAll('button').forEach((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flush();
      expect(sent.map((event) => event.params['rotulo'])).toEqual(['entendi-indisponivel', 'fechar-modal', 'ligar-modal']);
    } finally { stop(); }
  });

  it('não age fora de overlay nem sobre conteúdo já marcado pela lib', async () => {
    document.body.innerHTML = '<main><button>Solto</button></main><ion-modal><div data-at-id="x"><button>Marcado</button></div></ion-modal>';
    const sent: TrackingEvent[] = [];
    const stop = start('fed', { funcionalidade: 'r', tela: 't' }, sent);
    try {
      document.querySelectorAll('button').forEach((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flush();
      expect(sent).toEqual([]);
    } finally { stop(); }
  });

  it('abertura de overlay emite visualizacao com o nome público do modal na tela do owner', async () => {
    document.body.innerHTML = `<ion-modal id="titulo"><h2>Indisponibilidade temporária</h2><button>Ok</button></ion-modal>
      <ion-modal id="componente"><app-erro-generico-modal><p>Tente mais tarde</p><bsad-button>Ok</bsad-button></app-erro-generico-modal></ion-modal>
      <ion-alert id="alerta"><h2 class="alert-title">Atenção</h2></ion-alert><ion-alert id="select" class="select-alert"></ion-alert>`;
    const fed: TrackingEvent[] = []; const host: TrackingEvent[] = [];
    const stops = [start('fed', { funcionalidade: 'area-do-contratante', tela: 'minhas-faturas' }, fed), start('host', null, host)];
    try {
      for (const id of ['titulo', 'componente', 'select']) document.getElementById(id)!.dispatchEvent(new CustomEvent('ionModalDidPresent', { bubbles: true, composed: true }));
      document.getElementById('alerta')!.dispatchEvent(new CustomEvent('ionAlertDidPresent', { bubbles: true, composed: true }));
      await flush();
      expect(fed).toEqual(['indisponibilidade-temporaria', 'erro-generico'].map((rotulo) => ({ name: 'visualizacao', params: {
        ambiente: 'app-x', produto: 'saude', funcionalidade: 'area-do-contratante', subfuncionalidade: 'minhas-faturas',
        tela: 'app-x:saude:area-do-contratante:minhas-faturas', categoria: 'app-x:saude:area-do-contratante:minhas-faturas',
        elemento: 'modal', rotulo, acao: 'visualizacao' } })).concat([{ name: 'visualizacao', params: expect.objectContaining({ elemento: 'alerta', rotulo: 'atencao' }) as never }]));
      expect(host).toEqual([]);
    } finally { stops.forEach((stop) => stop()); }
  });

  it('nome do componente de overlay ignora prefixo e palavras técnicas nas pontas', () => {
    expect(['app-erro-generico-modal', 'bsmo-modal-voucher', 'bsad-modal', 'app-confirmar-envio-dialog', 'x-bottom-sheet'].map(overlayComponentName))
      .toEqual(['erro-generico', 'voucher', '', 'confirmar-envio', '']);
  });

  it('tela igual à funcionalidade não se repete', async () => {
    document.body.innerHTML = '<ion-modal><h2>Aviso</h2></ion-modal>';
    const sent: TrackingEvent[] = [];
    const stop = start('fed', { funcionalidade: 'menu', tela: 'menu' }, sent);
    try {
      document.querySelector('ion-modal')!.dispatchEvent(new CustomEvent('ionModalDidPresent', { bubbles: true }));
      await flush();
      expect(sent[0]!.params).toMatchObject({ funcionalidade: 'menu', subfuncionalidade: 'menu', tela: 'app-x:saude:menu', categoria: 'app-x:saude:menu' });
    } finally { stop(); }
  });
});


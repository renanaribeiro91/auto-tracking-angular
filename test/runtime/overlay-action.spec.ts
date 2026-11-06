/** @jest-environment jsdom */
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('overlay criado por código sem marcação', () => {
  const start = (owner: string, screen: { funcionalidade: string; tela: string } | null, sent: TrackingEvent[]) =>
    installDomTracker(document, { owner, mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces(owner, () => screen),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });

  it('ação de action-sheet/alert usa a tela visível do owner dono da página e o rótulo exibido', async () => {
    document.body.innerHTML = `<ion-action-sheet><div class="action-sheet-group"><button class="action-sheet-button action-sheet-camera"><span>Câmera</span></button>
      <p>Escolha</p></div></ion-action-sheet><ion-alert><button class="alert-button">Ok, entendi</button></ion-alert>`;
    const fed: TrackingEvent[] = []; const host: TrackingEvent[] = [];
    const stops = [start('fed', { funcionalidade: 'reembolso', tela: 'anexo' }, fed), start('host', null, host)];
    try {
      document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('.alert-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(fed.map((event) => [event.params['tela'], event.params['elemento'], event.params['rotulo']])).toEqual([
        ['app-x:saude:reembolso:anexo', 'botao', 'camera'], ['app-x:saude:reembolso:anexo', 'botao', 'ok-entendi']]);
      expect(host).toEqual([]);
    } finally { stops.forEach((stop) => stop()); }
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
});

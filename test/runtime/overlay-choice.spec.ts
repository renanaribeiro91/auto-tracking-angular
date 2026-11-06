/** @jest-environment jsdom */
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token-encoder.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('escolha aplicada por overlay próprio do componente', () => {
  let stop: () => void;
  let sent: TrackingEvent[];
  const warns: string[] = [];
  let select: HTMLElement & { value?: unknown };
  beforeEach(() => {
    document.body.innerHTML = `<main data-at-screen="reembolso-documentacao-tela" data-at-owner="app" data-at-funcionalidade="reembolso" data-at-tela="documentacao">
      <x-form-select data-at-id="reembolso-documentacao-tipo" data-at-event="ionChange" data-at-elemento="dropdown" data-at-rotulo="tipo"
        data-at-owner="app" data-at-funcionalidade="reembolso" data-at-tela="documentacao"><ion-select>
      <ion-select-option>Consulta</ion-select-option><ion-select-option>Exame</ion-select-option></ion-select></x-form-select></main>`;
    select = document.querySelector('ion-select')!;
    const options = document.querySelectorAll('ion-select-option');
    (options[0] as HTMLElement & { value?: unknown }).value = { id: 1 };
    (options[1] as HTMLElement & { value?: unknown }).value = 'exame-id';
    sent = [];
    stop = installDomTracker(document, { owner: 'app', mode: 'classic', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces('app', () => ({ funcionalidade: 'reembolso', tela: 'documentacao' })),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (w) => { warns.push(w); } });
  });
  afterEach(() => { stop(); });

  it('envia a opção exibida quando o valor muda ao fechar o overlay, sem disparar evento no app', async () => {
    const appHandler = jest.fn();
    select.addEventListener('ionChange', appHandler);
    select.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    // Alert nativo fecha antes de o sheet próprio aplicar a escolha.
    document.body.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { bubbles: true }));
    await wait(200);
    select.value = 'exame-id';
    document.body.dispatchEvent(new CustomEvent('ionModalDidDismiss', { bubbles: true }));
    await wait(200);
    expect(sent.map((event) => event.params['opcao_selecionada_1'])).toEqual([undefined, 'exame']);
    expect(appHandler).not.toHaveBeenCalled();
  });

  it('fechar sem mudar o valor não envia escolha; ionChange real não duplica', async () => {
    select.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    document.body.dispatchEvent(new CustomEvent('ionModalDidDismiss', { bubbles: true }));
    await wait(200);
    expect(sent).toHaveLength(1);
    // Nova abertura substitui a pendência anterior.
    select.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    select.value = 'exame-id';
    select.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, detail: { value: 'exame-id' } }));
    document.body.dispatchEvent(new CustomEvent('ionPopoverDidDismiss', { bubbles: true }));
    await wait(200);
    expect(sent.map((event) => event.params['opcao_selecionada_1'])).toEqual([undefined, undefined, 'exame']);
  });

  it('ref real do FED: clique de abertura vindo de output click do mesmo onChange arma a escolha', async () => {
    stop();
    const ref = encodeTrackingToken({ owner: 'app', funcionalidade: 'reembolso', tela: 'documentacao', outputs: [
      { id: 'tipo', event: 'ionChange', selector: 'ion-select.item__select', output: 'onChange', label: 'tipo', elemento: 'dropdown' },
      { id: 'tipo', event: 'click', selector: 'ion-select.item__select', output: 'onChange', label: 'tipo', elemento: 'dropdown' }] });
    document.body.innerHTML = `<x-form-select data-at-ref="${ref}"><ion-select class="item__select"><ion-select-option>Consulta</ion-select-option><ion-select-option>Exame</ion-select-option></ion-select></x-form-select>`;
    select = document.querySelector('ion-select')!;
    const options = document.querySelectorAll('ion-select-option');
    (options[0] as HTMLElement & { value?: unknown }).value = 'c';
    (options[1] as HTMLElement & { value?: unknown }).value = 'e';
    sent = [];
    stop = installDomTracker(document, { owner: 'app', mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces('app', () => ({ funcionalidade: 'reembolso', tela: 'documentacao' })),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (w) => { warns.push(w); } });
    select.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    document.body.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { bubbles: true }));
    await wait(200);
    select.value = 'e';
    document.body.dispatchEvent(new CustomEvent('ionModalDidDismiss', { bubbles: true }));
    await wait(200);
    expect(sent.map((event) => [event.params['rotulo'], event.params['opcao_selecionada_1']])).toEqual([['tipo', undefined], ['tipo', 'exame']]);
  });
});

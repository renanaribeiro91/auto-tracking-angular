/** @jest-environment jsdom */
import { AutoTrackingSurfaces, DomEventTracker, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { defineTrackingSurface, trackingSurfaceContract, type TrackingSurfaceDefinition } from '../../src/domain/contract/tracking-surface.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token-encoder.js';
import { createTrackingSurface } from '../../src/adapters/runtime/create-tracking-surface.js';
import { slug } from '../../src/domain/contract/slug.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function tagged(actions: TrackingSurfaceDefinition['actions']): TrackingSurfaceDefinition {
  return defineTrackingSurface({ id: 'modal-ajuda', actions, ref: encodeTrackingToken({
    owner: 'app', funcionalidade: 'shared', tela: 'modal', surfaceContract: trackingSurfaceContract({ id: 'modal-ajuda', actions }),
    rotulos: actions.flatMap(action => action.rotulos?.map((label) => slug(label)) ?? []), outputs: actions.map((action) => ({
      id: `modal-ajuda-${action.id}`, selector: action.selector, event: action.event ?? 'click',
      output: action.id, label: slug(action.rotulo), elemento: action.elemento,
    })),
  }) });
}

describe('superfícies TypeScript: ref, origem e gestos', () => {
  let stop: () => void;
  let root: Element;
  let sent: TrackingEvent[];
  let warns: string[];
  let origin: { funcionalidade: string; tela: string };
  let visible: boolean;
  let surfaces: AutoTrackingSurfaces;
  beforeEach(() => {
    document.body.innerHTML = '<dialog open><button id="fechar"><span>texto dinâmico</span></button><p>Título</p></dialog>';
    root = document.querySelector('dialog')!;
    origin = { funcionalidade: 'reembolso', tela: 'documentacao' };
    visible = true;
    surfaces = new AutoTrackingSurfaces('app', () => visible ? origin : null);
    sent = []; warns = [];
    stop = installDomTracker(document, { owner: 'app', mode: 'ref', surfaces, product: 'saude', schema: examplePreset.schema,
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (warning) => { warns.push(warning); } });
  });
  afterEach(() => { stop(); });

  it('usa a tela visível no gesto, preserva rótulo estático e limpa a ref ao fechar', async () => {
    const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar ajuda' }]);
    const captured = surfaces.capture();
    origin.tela = 'outra'; origin.funcionalidade = 'outro-fluxo';
    const detach = surfaces.attach(root, definition, captured);
    expect(root.getAttribute('data-at-ref')).toBe(definition.ref);
    root.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    root.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toEqual([{ name: 'click', params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'outro-fluxo',
      tela: 'app-x:saude:outro-fluxo:outra', categoria: 'app-x:saude:outro-fluxo:outra', elemento: 'botao', rotulo: 'fechar-ajuda', acao: 'clique' } }]);
    detach(); detach();
    expect(root.hasAttribute('data-at-ref')).toBe(false);
    // Fechado, o framework remove o portal: o vínculo antigo não sobrevive no DOM.
    const button = root.querySelector('button')!;
    root.remove();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toHaveLength(1); expect(warns).toEqual([]);
  });

  it.each([['tracker do host', () => new AutoTrackingSurfaces('host', () => ({ funcionalidade: 'host', tela: 'inicio' }))],
    ['instância padrão sem owner', () => new AutoTrackingSurfaces('')]])(
    'capture()+attach() manual em serviço raiz com %s usa o owner da ref e sua tela', async (_name, injected) => {
      const deactivate = AutoTrackingSurfaces.activate(document, surfaces);
      try {
        const tracking = injected();
        const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar ajuda' }]);
        const detach = tracking.attach(root, definition, tracking.capture());
        root.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        await flush();
        expect(sent).toHaveLength(1);
        expect(sent[0]!.params).toMatchObject({ funcionalidade: 'reembolso', tela: 'app-x:saude:reembolso:documentacao', rotulo: 'fechar-ajuda' });
        detach();
        expect(root.hasAttribute('data-at-ref')).toBe(false);
        expect(warns).toEqual([]);
      } finally { deactivate(); }
    });

  it('página sob overlay (aria-hidden/inert do Ionic) continua sendo a tela; página saída (.ion-page-hidden) não', () => {
    document.body.innerHTML = `<app-page aria-hidden="true" inert><div data-at-screen="r-t-tela" data-at-owner="app" data-at-funcionalidade="r" data-at-tela="t"></div></app-page>
      <app-old class="ion-page-hidden"><div data-at-screen="r-o-tela" data-at-owner="app" data-at-funcionalidade="r" data-at-tela="o"></div></app-old>`;
    expect(DomEventTracker.screenForHost(document, 'app-page', 'classic', 'app')).toEqual({ funcionalidade: 'r', tela: 't' });
    expect(DomEventTracker.screenForHost(document, 'app-old', 'classic', 'app')).toBeNull();
  });

  it('encontra a superfície ativa do MFE mesmo quando o serviço raiz injeta o tracker do host', async () => {
    const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar ajuda' }]);
    const host = new AutoTrackingSurfaces('host', () => ({ funcionalidade: 'host', tela: 'inicio' }));
    const deactivate = AutoTrackingSurfaces.activate(document, surfaces);
    try {
      const created = await createTrackingSurface(host, definition, async () => {
        origin.tela = 'outra';
        return root;
      });
      expect(created).toBe(root);
      root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.params).toMatchObject({ funcionalidade: 'reembolso', tela: 'app-x:saude:reembolso:outra' });
    } finally {
      deactivate();
    }
    expect(AutoTrackingSurfaces.forDefinition(document, definition)).toBeNull();
  });

  it('mantém abertura do select e identifica a opção sem duplicar o change', async () => {
    root.innerHTML = '<select><option value="1">Consulta</option><option value="2" selected>Exame</option></select>';
    const definition = tagged([{ id: 'tipo', selector: 'select', elemento: 'dropdown', rotulo: 'Tipo de atendimento', event: 'change' }]);
    surfaces.attach(root, definition, surfaces.capture());
    const select = root.querySelector('select')!;
    select.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[0]!.params['opcao_selecionada_1']).toBeUndefined();
    expect(sent[1]!.params).toMatchObject({ elemento: 'dropdown', rotulo: 'tipo-de-atendimento', opcao_selecionada_1: 'exame' });
    expect(warns).toEqual([]);
  });

  it('emite uma vez quando HTML, superfície e seletores sobrepostos reconhecem o mesmo clique', async () => {
    const button = root.querySelector('button')!;
    button.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'app', funcionalidade: 'shared', tela: 'modal',
      click: { id: 'html-fechar', event: 'click', elemento: 'botao', rotulo: 'Fechar HTML' } }));
    const definition = tagged([
      { id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' },
      { id: 'generico', selector: 'button', elemento: 'botao', rotulo: 'Botão' },
    ]);
    surfaces.attach(root, definition, surfaces.capture());
    button.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toMatchObject({ rotulo: 'fechar', funcionalidade: 'reembolso' });
    expect(warns).toEqual([]);
  });

  it('usa apenas a superfície interna em portais aninhados e não acumula vínculos ao reabrir', async () => {
    surfaces.register(document.body, { screen: { funcionalidade: 'externa', tela: 'externa' }, actions: [
      { id: 'externo', selector: 'button', elemento: 'botao', rotulo: 'Externo' },
    ] });
    const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }]);
    for (let cycle = 0; cycle < 3; cycle++) {
      const detach = surfaces.attach(root, definition, surfaces.capture());
      root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      detach();
    }
    await flush();
    expect(sent).toHaveLength(3);
    expect(sent.every((event) => event.params['funcionalidade'] === 'reembolso')).toBe(true);
    expect(warns).toEqual([]);
  });

  it.each([
    ['radio', '<label><input type="radio" checked>Consulta</label>', 'input', 'change', 'consulta'],
    ['checkbox', '<input type="checkbox" checked>', 'input', 'change', 'true'],
    ['ionChange', '<ion-select><ion-select-option value="2">Exame</ion-select-option></ion-select>', 'ion-select', 'ionChange', 'exame'],
    ['submit', '<form><button>Enviar</button></form>', 'form', 'submit', undefined],
  ])('rastreia %s dentro do portal', async (_kind, html, selector, event, selected) => {
    root.innerHTML = html!;
    // Propriedade pública de custom element, como fornecida por Ionic em runtime.
    const option = root.querySelector('ion-select-option');
    if (option) Object.assign(option, { value: '2' });
    const definition = tagged([{ id: 'acao', selector: selector!, elemento: 'botao', rotulo: 'Ação',
      event: event as 'change' | 'ionChange' | 'submit' }]);
    surfaces.attach(root, definition, surfaces.capture());
    root.querySelector(selector!)!.dispatchEvent(new CustomEvent(event!, { bubbles: true, detail: { value: '2' } }));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params['opcao_selecionada_1']).toBe(selected);
    expect(warns).toEqual([]);
  });

  it('vincula a origem de um portal HTML sem inventar eventos na raiz', async () => {
    root.querySelector('button')!.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'app',
      funcionalidade: 'shared', tela: 'modal', click: { id: 'interno', event: 'click', elemento: 'botao', rotulo: 'Fechar' } }));
    const host = document.createElement('section');
    host.append(root);
    document.body.append(host);
    const created = await createTrackingSurface(surfaces, tagged([]), async () => {
      origin.tela = 'outra';
      return root;
    });
    expect(created).toBe(root);
    document.body.append(root); // O design system pode mover o portal após o vínculo.
    expect(host.contains(root)).toBe(false);
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toMatchObject({ tela: 'app-x:saude:reembolso:outra', funcionalidade: 'reembolso' });
  });

  it('não reutiliza captura antiga quando o owner não tem tela visível', async () => {
    const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }]);
    surfaces.attach(root, definition, surfaces.capture());
    visible = false;
    document.documentElement.setAttribute('data-at-current-screen', 'outro-owner|inicio');
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toEqual([]);
    expect(warns).toEqual([expect.stringContaining('sem tela visível do owner')]);
  });

  it('registro manual sem resolver usa a tela explícita de apresentação', async () => {
    stop();
    const manual = new AutoTrackingSurfaces('app');
    manual.register(root, { screen: { funcionalidade: 'reembolso', tela: 'manual' }, actions: [
      { id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' },
    ] });
    stop = installDomTracker(document, { owner: 'app', mode: 'ref', surfaces: manual, product: 'saude', schema: examplePreset.schema,
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (warning) => { warns.push(warning); } });
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent[0]!.params).toMatchObject({ funcionalidade: 'reembolso', tela: 'app-x:saude:reembolso:manual' });
  });

  it('prioriza a rota ancestral do mesmo owner quando o elemento permanece dentro dela', async () => {
    const page = document.createElement('app-page');
    const marker = document.createElement('header');
    marker.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'app', funcionalidade: 'reembolso', tela: 'pagina-visivel', screenId: 'page' }));
    page.append(marker, root);
    document.body.append(page);
    surfaces.attach(root, tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }]), surfaces.capture());
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent.filter((event) => event.name === 'click')[0]!.params).toMatchObject({ funcionalidade: 'reembolso', tela: 'app-x:saude:reembolso:pagina-visivel' });
  });

  it('seleciona somente o rótulo público declarado para a ação', async () => {
    root.querySelector('button')!.textContent = 'Continuar';
    surfaces.attach(root, tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Confirmar',
      rotulos: ['Confirmar', 'Continuar'] }]), surfaces.capture());
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent[0]!.params['rotulo']).toBe('continuar');
    expect(warns).toEqual([]);
  });

  it('preserva criação sem provider e propaga o erro original do framework', async () => {
    expect(await createTrackingSurface(null, tagged([]), async () => root)).toBe(root);
    const error = new Error('framework');
    await expect(createTrackingSurface(surfaces, tagged([]), async () => { throw error; })).rejects.toBe(error);
  });

  it('rejeita declaração desatualizada sem interromper o modal', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }]);
      const changed = { ...definition, actions: [{ ...definition.actions[0]!, rotulo: 'Outro' }] };
      expect(() => surfaces.attach(root, changed, surfaces.capture())()).not.toThrow();
      expect(root.hasAttribute('data-at-ref')).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('declaração de superfície alterada'));
    } finally { warn.mockRestore(); }
  });

  it.each([
    { optionAttribute: 'data-new-option' },
    { allowedOptions: ['Consulta', 'Exame'] },
    { rotulos: ['Fechar', 'Continuar'] },
  ])('rejeita mudança nas regras de opção/rótulo sem regenerar a ref: %j', (change) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const definition = tagged([{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar',
        optionAttribute: 'data-option', allowedOptions: ['Consulta'], rotulos: ['Fechar'] }]);
      const changed = { ...definition, actions: [{ ...definition.actions[0]!, ...change }] };
      surfaces.attach(root, changed, surfaces.capture());
      expect(root.hasAttribute('data-at-ref')).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('declaração de superfície alterada'));
    } finally { warn.mockRestore(); }
  });
});

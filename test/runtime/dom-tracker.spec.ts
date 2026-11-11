/** @jest-environment jsdom */
import { OVERLAY_HOST_TAG } from '../../src/adapters/runtime/dom-tracker.constants.js';
import { AutoTrackingSurfaces, installDomTracker, emitScreenView, type DomTrackerDeps } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token-encoder.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(owner: string, sent: TrackingEvent[], env: string | null = 'app-x', warns: string[] = []): DomTrackerDeps {
  return {
    owner, product: 'saude', schema: examplePreset.schema,
    resolveEnvironment: async () => env,
    send: (e) => { sent.push(e); },
    warn: (m) => { warns.push(m); },
  };
}

const at = (owner: string, id: string, extra = '') =>
  `data-at-id="${id}" data-at-owner="${owner}" data-at-funcionalidade="componentes" data-at-tela="card" data-at-elemento="botao" data-at-rotulo="${id}" ${extra}`;

const clickPayload = (tela: string, rotulo: string, extra: Record<string, string> = {}) => ({
  name: 'click',
  params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', subfuncionalidade: tela, tela: `app-x:saude:reembolso:${tela}`, categoria: `app-x:saude:reembolso:${tela}`, elemento: 'botao', rotulo, acao: 'clique', ...extra },
});

describe('runtime: interação compartilhada exige origem comprovada', () => {
  const sent: TrackingEvent[] = [];
  const warnings: string[] = [];
  let stop: (() => void) | undefined;
  const ref = () => encodeTrackingToken({ owner: 'mob', funcionalidade: 'componente', tela: 'modal-service', requireOrigin: true,
    click: { id: 'confirmar', event: 'click', elemento: 'botao', rotulo: 'confirmar' } });
  const click = () => document.getElementById('action')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  const install = (surfaces?: AutoTrackingSurfaces) => {
    stop = installDomTracker(document, { ...deps('mob', sent, 'app-x', warnings), mode: 'ref', ...(surfaces ? { surfaces } : {}) });
  };
  beforeEach(() => {
    sent.length = 0; warnings.length = 0;
    document.documentElement.removeAttribute('data-at-current-screen');
    document.body.innerHTML = `<app-root><button id="action" data-at-ref="${ref()}">Confirmar</button></app-root>`;
  });
  afterEach(() => stop?.());

  it('bloqueia componente isolado mesmo com marcador global de outro contexto', async () => {
    document.documentElement.setAttribute('data-at-current-screen', 'outro|home');
    install(); click(); await flush();
    expect(sent).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('sem tela identificável')]);
  });

  it('usa a tela roteada ancestral do mesmo owner em vez da identidade do componente', async () => {
    const marker = document.createElement('header');
    marker.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mob', funcionalidade: 'reembolso', tela: 'documentos', screenId: 'pagina' }));
    document.querySelector('app-root')!.prepend(marker);
    install(); click(); await flush();
    expect(sent.filter((event) => event.name === 'click')).toEqual([clickPayload('documentos', 'confirmar')]);
  });

  it('não aceita tela ancestral nem captura de owner diferente', async () => {
    const marker = document.createElement('header');
    marker.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'outro', funcionalidade: 'reembolso', tela: 'documentos', screenId: 'pagina' }));
    document.querySelector('app-root')!.prepend(marker);
    install(new AutoTrackingSurfaces('outro', () => ({ funcionalidade: 'reembolso', tela: 'outra' })));
    click(); await flush();
    expect(sent).toEqual([]);
  });

  it('componente fora da página usa a origem atual fornecida pelo seu owner', async () => {
    install(new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' })));
    click(); await flush();
    expect(sent).toEqual([clickPayload('documentos', 'confirmar')]);
  });

  it('overlay exige vínculo registrado e usa a tela visível do owner no gesto', async () => {
    let current = { funcionalidade: 'reembolso', tela: 'documentos' };
    const surfaces = new AutoTrackingSurfaces('mob', () => current);
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${ref()}">Confirmar</button></ion-modal>`;
    install(surfaces); click(); await flush();
    expect(sent).toEqual([]);
    const captured = surfaces.capture()!;
    const detach = surfaces.register(document.querySelector('ion-modal')!, { screen: captured, actions: [] });
    current = { funcionalidade: 'reembolso', tela: 'outra' };
    click(); await flush();
    expect(sent).toEqual([clickPayload('outra', 'confirmar')]);
    detach(); click(); await flush();
    expect(sent).toHaveLength(1);
  });

  const present = (name = 'ionModalDidPresent') => document.querySelector('ion-modal')!.dispatchEvent(new Event(name, { bubbles: true }));
  const dismiss = () => document.querySelector('ion-modal')!.dispatchEvent(new Event('ionModalDidDismiss', { bubbles: true }));

  it('modal com template do owner, ao ser apresentado, nasce na tela visível do owner até fechar', async () => {
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${ref()}">Confirmar</button></ion-modal>`;
    install(new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' })));
    click(); await flush();
    expect(sent).toEqual([]); // antes de apresentar não há prova da origem
    present(); click(); await flush();
    expect(sent.filter((event) => event.name === 'click')).toEqual([clickPayload('documentos', 'confirmar')]);
    sent.length = 0; dismiss(); click(); await flush();
    expect(sent).toEqual([]);
  });

  it('modal só com gestos de outro owner, ou sem a tela do owner, não herda tela', async () => {
    const other = encodeTrackingToken({ owner: 'outro', funcionalidade: 'x', tela: 'y', requireOrigin: true,
      click: { id: 'alheio', event: 'click', elemento: 'botao', rotulo: 'alheio' } });
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${other}">Alheio</button></ion-modal>`;
    install(new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' })));
    present(); click(); await flush();
    expect(sent).toEqual([]);
    stop?.();
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${ref()}">Confirmar</button></ion-modal>`;
    install(new AutoTrackingSurfaces('mob', () => null));
    present(); click(); await flush();
    expect(sent).toEqual([]);
  });

  it('overlay de design system (web component) com o ciclo <prefixo>ModalDidPresent vale igual ao Ionic, inclusive criado depois', async () => {
    install(new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' })));
    document.body.innerHTML = `<ds-modal><div class="conteudo"><button id="action" data-at-ref="${ref()}">Confirmar</button></div></ds-modal>`;
    await flush();
    const modal = document.querySelector('ds-modal')!;
    click(); await flush();
    expect(sent).toEqual([]);
    modal.dispatchEvent(new CustomEvent('dsModalDidPresent', { bubbles: true, composed: true }));
    click(); await flush();
    expect(sent.filter((event) => event.name === 'click')).toEqual([clickPayload('documentos', 'confirmar')]);
    sent.length = 0;
    modal.dispatchEvent(new CustomEvent('dsModalDidDismiss', { bubbles: true, composed: true }));
    click(); await flush();
    expect(sent).toEqual([]);
  });

  it('só host de overlay de web component ganha ciclo de vida derivado do nome', () => {
    for (const tag of ['ion-modal', 'ds-modal', 'acme-ui-bottom-sheet', 'ion-action-sheet', 'x-popover']) expect(OVERLAY_HOST_TAG.test(tag)).toBe(true);
    for (const tag of ['ds-modal-card', 'modal', 'app-card', 'lib-modal-service-x']) expect(OVERLAY_HOST_TAG.test(tag)).toBe(false);
  });

  it('overlay removido sem evento de fechamento perde o vínculo', async () => {
    install(new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' })));
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${ref()}">Confirmar</button></ion-modal>`;
    await flush();
    present();
    const modal = document.querySelector('ion-modal')!;
    modal.remove();
    await flush();
    document.body.append(modal); // mesmo modal de volta, sem nova apresentação
    await flush();
    click(); await flush();
    expect(sent.filter((event) => event.name === 'click')).toEqual([]);
  });

  it('vínculo declarado no código vence o da apresentação e reabrir o mesmo modal não quebra', async () => {
    document.body.innerHTML = `<ion-modal><button id="action" data-at-ref="${ref()}">Confirmar</button></ion-modal>`;
    const surfaces = new AutoTrackingSurfaces('mob', () => ({ funcionalidade: 'reembolso', tela: 'documentos' }));
    install(surfaces);
    const detach = surfaces.register(document.querySelector('ion-modal')!, { screen: { funcionalidade: 'reembolso', tela: 'documentos' }, actions: [] });
    present(); dismiss(); present(); click(); await flush();
    expect(sent.filter((event) => event.name === 'click')).toEqual([clickPayload('documentos', 'confirmar')]);
    expect(warnings.filter((message) => message.includes('ignorad'))).toEqual([]);
    detach();
  });
});

describe('runtime: emissão no formato do Builder do time', () => {
  let stops: Array<() => void> = [];
  const mob: TrackingEvent[] = [];
  const fed: TrackingEvent[] = [];

  beforeEach(() => {
    mob.length = 0; fed.length = 0;
    document.documentElement.removeAttribute('data-at-current-screen');
    document.body.innerHTML = `<app-root>
      <app-tipo>
        <ion-header data-at-screen="t" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento"></ion-header>
        <ion-button id="mobBtn" ${at('mob', 'sair')}>Sair</ion-button>
        <ion-button id="fedBtn" ${at('mfe-exemplo', 'anexar')}>Anexar <b>recibo</b></ion-button>
        <ion-button id="icone" ${at('mfe-exemplo', 'abrir-filtro')}><ion-icon></ion-icon></ion-button>
        <lib-header id="hdr" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento"
          data-at-outputs="h-voltar|click|#btnVoltar|voltar;h-icone|click|div.acao|icone">
          <h1 id="titulo">Título</h1><div id="btnVoltar" aria-label="Voltar"></div><div class="acao"></div>
        </lib-header>
        <x-card id="card" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento" data-at-outputs="c-ok|click|*|ok">
          <span id="texto">texto</span><button id="okBtn">Confirmar</button>
        </x-card>
      </app-tipo>
    </app-root>`;
    stops = [installDomTracker(document, deps('mob', mob)), installDomTracker(document, deps('mfe-exemplo', fed))];
  });
  afterEach(() => stops.forEach((s) => s()));

  const click = (sel: string) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

  it('tela vem da página onde o gesto aconteceu; uma emissão, só pelo owner do elemento', async () => {
    click('#fedBtn b');
    await flush();
    expect(mob).toHaveLength(0);
    expect(fed).toEqual([clickPayload('tipo-documento', 'anexar')]);
  });

  it('botão só com ícone usa o rótulo estável do CLI', async () => {
    click('#icone ion-icon');
    await flush();
    expect(fed[0]!.params['rotulo']).toBe('abrir-filtro');
  });

  it('saída mapeada: só o elemento interno que a dispara emite; clicar no título não emite', async () => {
    click('#titulo');
    click('#btnVoltar');
    click('.acao');
    await flush();
    expect(fed.map((e) => e.params['rotulo'])).toEqual(['voltar', 'icone']);
  });

  it('modo ref: token autocontido envia screen_view, clique e output corretamente, sem manifesto', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const marker = document.querySelector('app-tipo ion-header')!;
    const button = document.getElementById('fedBtn')!;
    const header = document.getElementById('hdr')!;
    for (const element of [marker, button, header]) {
      for (const attr of Array.from(element.attributes)) if (attr.name.startsWith('data-at-')) element.removeAttribute(attr.name);
    }
    marker.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento', screenId: 't' }));
    button.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      click: { id: 'anexar', event: 'click', elemento: 'botao', rotulo: 'anexar' } }));
    header.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      outputs: [{ id: 'h-voltar', event: 'click', selector: '#btnVoltar', label: 'voltar', output: 'voltar' }] }));
    const runtime = { ...deps('mfe-exemplo', fed), mode: 'ref' as const };
    stops = [installDomTracker(document, runtime)];
    expect(emitScreenView(document, 'app-tipo', runtime)).toBe(true);
    await flush();
    expect(fed[0]).toEqual({ name: 'screen_view', params: expect.objectContaining({ funcionalidade: 'reembolso' }) });
    fed.length = 0;
    button.setAttribute('aria-label', 'Excluir João');
    click('#fedBtn');
    button.setAttribute('aria-label', 'Excluir Maria');
    click('#fedBtn');
    click('#titulo'); // sem output de título
    click('#btnVoltar');
    await flush();
    // Texto variável (nome de pessoa) nunca vai ao analytics: rótulo é o do contrato.
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['anexar', 'anexar', 'voltar']);
    expect(JSON.stringify(fed)).not.toMatch(/joao|maria/i);
    expect(fed.map((event) => event.name)).toEqual(['click', 'click', 'click']);
    expect(button.outerHTML).not.toContain('data-at-id');
  });

  it('modo ref: opção dinâmica é obtida do aria-label validado', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const star = document.getElementById('fedBtn')!;
    for (const attr of Array.from(star.attributes)) if (attr.name.startsWith('data-at-')) star.removeAttribute(attr.name);
    star.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'avaliacao-video', tela: 'star-ranking',
      click: { id: 'star-ranking-on-cliked', event: 'click', elemento: 'botao', rotulo: 'avaliar', opcaoPermitida: '1|2|3|4|5', opcaoFonte: 'aria-label-numero' } }));
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    star.setAttribute('aria-label', 'Avaliar com 4 estrelas');
    click('#fedBtn');
    star.setAttribute('aria-label', 'Avaliar com 2 estrelas');
    click('#fedBtn');
    await flush();
    expect(fed.map((event) => event.params['opcao_selecionada_1'])).toEqual(['4', '2']);
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['avaliar', 'avaliar']);
    expect(star.outerHTML).not.toContain('data-at-option');
  });

  it('item de lista estática envia o valor visível somente quando provado pelo CLI', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const menu = document.querySelector('app-tipo')!;
    const token = encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'menu', tela: 'inicio',
      click: { id: 'menu-navegar-para', event: 'click', elemento: 'botao', rotulo: 'navegar-para' }, rotulos: ['welcome', 'welcome-home', 'salas-vip'] });
    menu.insertAdjacentHTML('beforeend', `<x-item id="vip" data-at-ref="${token}"><b>Salas VIP</b><p>Acesso a salas</p></x-item>`
      + `<x-item id="home" data-at-ref="${token}"><b>Welcome Home</b></x-item>`
      + `<x-item id="pessoa" data-at-ref="${token}"><b>Maria da Silva</b></x-item>`
      + `<x-item id="aria" title="Welcome" data-at-ref="${token}"><b>Welcome Home</b></x-item>`);
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    for (const id of ['vip', 'home', 'pessoa', 'aria']) click(`#${id} b`);
    await flush();
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['salas-vip', 'welcome-home', 'welcome']);
    expect(JSON.stringify(fed)).not.toMatch(/maria/i);
  });

  it('rótulo dinâmico: envia o texto atual no clique, sem badge, e bloqueia dado pessoal', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const page = document.querySelector('app-tipo')!;
    const token = encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'opcoes-reembolso',
      outputs: [{ id: 'opcoes-reembolso-bsds', event: 'click', selector: ':host', label: 'botao', output: 'bsdsClick' }], rotuloDinamico: ['opcoes-reembolso-bsds'] });
    page.insertAdjacentHTML('beforeend', `<bsds-service-button id="dyn" data-at-ref="${token}"><span>Orientação do reembolso</span><bsds-badge slot="top">Novo</bsds-badge></bsds-service-button>`);
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    const button = document.querySelector('#dyn')!;
    click('#dyn span');
    button.querySelector('span')!.textContent = 'Solicitar reembolso';
    click('#dyn span');
    button.querySelector('span')!.textContent = 'Cartão 1234 5678 9012';
    click('#dyn span');
    await flush();
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['orientacao-do-reembolso', 'solicitar-reembolso']);
    expect(JSON.stringify(fed)).not.toMatch(/1234|novo/);
  });

  it('rótulo dinâmico todo em slot (card de web component) usa o slot de conteúdo, nunca o badge', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const page = document.querySelector('app-tipo')!;
    const token = encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'opcoes-reembolso',
      outputs: [{ id: 'card-programa', event: 'click', selector: ':host', label: 'card', output: 'click' }], rotuloDinamico: ['card-programa'] });
    page.insertAdjacentHTML('beforeend', `<ds-card id="card-slot" data-at-ref="${token}"><ds-badge slot="top">Novo</ds-badge>`
      + '<div slot="content"><ds-text>Orientação</ds-text><ds-text>Programa de nutrição</ds-text></div></ds-card>');
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    click('#card-slot ds-text');
    await flush();
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['orientacao-programa-de-nutricao']);
  });

  it('modo ref: opção ambígua não é inventada', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const star = document.getElementById('fedBtn')!;
    for (const attr of Array.from(star.attributes)) if (attr.name.startsWith('data-at-')) star.removeAttribute(attr.name);
    star.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'avaliacao-video', tela: 'star-ranking',
      click: { id: 'star-ranking-on-cliked', event: 'click', elemento: 'botao', rotulo: 'avaliar', opcaoPermitida: '1|2|3|4|5', opcaoFonte: 'aria-label-numero' } }));
    star.setAttribute('aria-label', 'Notas 2 e 4 estrelas');
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    click('#fedBtn'); await flush();
    expect(fed).toHaveLength(1);
    expect(fed[0]!.params['opcao_selecionada_1']).toBeUndefined();
  });

  it('modo ref: token inválido nunca dispara e classic ignora o token', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const button = document.getElementById('fedBtn')!;
    for (const attr of Array.from(button.attributes)) if (attr.name.startsWith('data-at-')) button.removeAttribute(attr.name);
    button.setAttribute('data-at-ref', 'v1.invalido');
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    click('#fedBtn'); await flush();
    expect(fed).toHaveLength(0);
    stops.forEach((stop) => stop()); stops = [];
    button.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      click: { id: 'anexar', event: 'click', elemento: 'botao', rotulo: 'anexar' } }));
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'classic' })];
    click('#fedBtn'); await flush();
    expect(fed).toHaveLength(0);
  });

  it('gestos compactados v2 mantêm a emissão e a identidade do evento', async () => {
    const { encodeOutputBindings } = await import('../../src/domain/contract/output-bindings.js');
    const host = document.getElementById('hdr')!;
    host.setAttribute('data-at-outputs', encodeOutputBindings([
      { id: 'h-voltar', event: 'click', selector: '#btnVoltar', label: 'voltar', output: 'voltar' },
      { id: 'h-voltar', event: 'click', selector: '.acao', label: 'voltar', output: 'voltar' },
      { id: 'h-voltar', event: 'click', selector: 'h1#titulo', label: 'voltar', output: 'voltar' },
    ]));
    expect(host.getAttribute('data-at-outputs')).toMatch(/^v2:/);
    click('#btnVoltar');
    await flush();
    expect(fed.map((e) => e.params['rotulo'])).toEqual(['voltar']);
  });

  it('componente sem definição: emite só ao acionar elemento interativo interno', async () => {
    click('#texto');
    click('#okBtn');
    await flush();
    expect(fed.map((e) => e.params['rotulo'])).toEqual(['ok']);
  });

  it('dois cliques genuínos geram duas emissões', async () => {
    click('#mobBtn');
    click('#mobBtn');
    await flush();
    expect(mob).toHaveLength(2);
  });

  it('Shadow DOM open e closed: gesto interno atribuído ao host marcado', async () => {
    document.getElementById('mobBtn')!.attachShadow({ mode: 'open' }).appendChild(document.createElement('button')).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    document.getElementById('fedBtn')!.attachShadow({ mode: 'closed' }).appendChild(document.createElement('button')).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(mob).toHaveLength(1);
    expect(fed).toHaveLength(1);
  });

  it('overlay de outro owner não herda a última tela do host', async () => {
    document.body.insertAdjacentHTML('beforeend', `<app-ajuda><ion-header data-at-screen="h" data-at-owner="mob" data-at-funcionalidade="home" data-at-tela="inicio"></ion-header></app-ajuda>`);
    emitScreenView(document, 'app-ajuda', deps('mob', mob));
    const modal = document.createElement('ion-modal');
    modal.innerHTML = `<ion-button id="excluir" ${at('mfe-exemplo', 'excluir')}>Excluir</ion-button>`;
    document.body.appendChild(modal);
    click('#excluir');
    await flush();
    expect(fed[0]!.params).toMatchObject({ funcionalidade: 'componentes', subfuncionalidade: 'card', tela: 'app-x:saude:componentes:card', rotulo: 'excluir' });
    expect(mob).toHaveLength(1); // screen_view, mas nenhum click do FED
  });

  it('overlay sem tela de origem não herda a tela global de outro MFE', async () => {
    document.body.insertAdjacentHTML('beforeend', `<app-ajuda><ion-header data-at-screen="h" data-at-owner="mob" data-at-funcionalidade="home" data-at-tela="inicio"></ion-header></app-ajuda>`);
    emitScreenView(document, 'app-ajuda', deps('mob', mob));
    const incomplete = document.createElement('widget-modal');
    incomplete.innerHTML = '<button id="sem-prova" data-at-id="acao" data-at-owner="mfe-exemplo" data-at-rotulo="fechar">Fechar</button>';
    document.body.appendChild(incomplete);
    click('#sem-prova');
    await flush();
    expect(fed).toHaveLength(0);
  });

  it('select emite abertura e escolha separadamente, sem opção atribuída à abertura', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `<ion-select id="sel" aria-label="Tipo de documento" ${at('mfe-exemplo', 'sel', 'data-at-event="ionChange"')}><ion-select-option>Recibo médico</ion-select-option></ion-select>`);
    const sel = document.getElementById('sel')!;
    (sel.querySelector('ion-select-option') as unknown as { value: string }).value = 'r1';
    sel.click();
    sel.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: 'r1' } }));
    await flush();
    expect(fed).toEqual([
      clickPayload('tipo-documento', 'sel'),
      clickPayload('tipo-documento', 'sel', { opcao_selecionada_1: 'recibo-medico' }),
    ]);
  });

  it('não conta o botão interno de limpar como abertura do select', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `
      <bsad-form-select id="campo" ${at('mfe-exemplo', 'tipo', 'data-at-event="ionChange"')}>
        <ion-select id="abrir"></ion-select><button id="limpar">Limpar</button>
      </bsad-form-select>`);
    click('#limpar');
    click('#abrir');
    await flush();
    expect(fed).toEqual([clickPayload('tipo-documento', 'tipo')]);
  });

  it('modo ref também mantém abertura e escolha como gestos separados', async () => {
    stops.forEach((stop) => stop()); stops = [];
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', '<ion-select id="ref-select"><ion-select-option>Recibo médico</ion-select-option></ion-select>');
    const select = document.getElementById('ref-select')!;
    (select.querySelector('ion-select-option') as Element & { value?: string }).value = 'r1';
    select.setAttribute('data-at-ref', encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      click: { id: 'tipo-documento', event: 'ionChange', elemento: 'dropdown', rotulo: 'tipo-documento' } }));
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' })];
    select.click();
    select.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: 'r1' } }));
    await flush();
    expect(fed.map((event) => event.params['opcao_selecionada_1'])).toEqual([undefined, 'recibo-medico']);
  });

  it('radio identifica a opção e checkbox identifica o estado sem confundir o clique de abertura', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `
      <ion-radio-group id="grupo" ${at('mob', 'grupo', 'data-at-event="ionChange"')}>
        <ion-radio id="opcao" aria-label="Consulta digital">Consulta digital</ion-radio>
      </ion-radio-group>
      <ion-checkbox id="aceite" ${at('mob', 'aceite', 'data-at-event="ionChange"')}>Aceitar</ion-checkbox>`);
    const grupo = document.getElementById('grupo')!;
    (document.getElementById('opcao') as Element & { value?: unknown }).value = 'digital';
    grupo.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: 'digital' } }));
    const aceite = document.getElementById('aceite')!;
    aceite.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    aceite.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { checked: true } }));
    await flush();
    expect(mob).toHaveLength(2);
    expect(mob.map((event) => event.params['opcao_selecionada_1'])).toEqual(['consulta-digital', 'true']);
  });

  it('seleção múltipla consulta somente o controle uma vez por mudança e preserva a ordem dos valores', async () => {
    const select = document.createElement('select');
    select.setAttribute('data-at-ref', encodeTrackingToken({
      owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      click: { id: 'atendimento', event: 'change', elemento: 'dropdown', rotulo: 'atendimento' },
    }));
    select.innerHTML = '<option value="a">Consulta digital</option><option value="b">Consulta presencial</option>';
    document.body.appendChild(select);
    stops.forEach((stop) => stop()); stops = [];
    stops.push(installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref' }));
    const query = jest.spyOn(select, 'querySelectorAll');
    const documentQuery = jest.spyOn(document, 'querySelectorAll');
    try {
      for (let index = 0; index < 20; index++) {
        select.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value: ['b', 'a'] } }));
      }
      expect(query).toHaveBeenCalledTimes(20);
      expect(documentQuery).not.toHaveBeenCalled();
      await flush();
      expect(fed).toHaveLength(20);
      expect(fed.every((event) => event.params['opcao_selecionada_1'] === 'consulta-presencial-consulta-digital')).toBe(true);
    } finally {
      query.mockRestore();
      documentQuery.mockRestore();
    }
  });

  it('select multiple nativo inclui todas as opções selecionadas e respeita o rótulo visível', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `
      <select id="selecao-multipla" multiple ${at('mob', 'atendimento', 'data-at-event="change"')}>
        <option value="a" selected label="Consulta digital">Texto alternativo</option>
        <option value="b">Não selecionada</option>
        <option value="c" selected>Consulta presencial</option>
      </select>`);
    document.getElementById('selecao-multipla')!.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await flush();
    expect(mob[0]?.params['opcao_selecionada_1']).toBe('consulta-digital-consulta-presencial');
  });

  it('checkbox nativo informa o estado e radio nativo informa o rótulo da opção', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `
      <label><input id="checkbox-nativo" type="checkbox" ${at('mob', 'aceite', 'data-at-event="change"')}>Aceitar</label>
      <label for="radio-nativo">Consulta presencial</label>
      <input id="radio-nativo" type="radio" value="presencial" ${at('mob', 'atendimento', 'data-at-event="change"')}>`);
    const checkbox = document.getElementById('checkbox-nativo') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    document.getElementById('radio-nativo')!.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await flush();
    expect(mob.map((event) => event.params['opcao_selecionada_1'])).toEqual(['true', 'false', 'consulta-presencial']);
  });

  it('clique fora de uma página marcada usa sua própria origem e ignora a tela global de outro MFE', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="fora-da-pagina" ${at('mob', 'voltar')}>Voltar</button>`);
    document.documentElement.setAttribute('data-at-current-screen', 'outro-mfe|outra-tela');
    click('#fora-da-pagina');
    await flush();
    expect(mob[0]?.params['funcionalidade']).toBe('componentes');
    expect(mob[0]?.params['tela']).toBe('app-x:saude:componentes:card');
  });

  it('superfície imperativa preserva tela de origem, registra opção física e encerra vínculo no fechamento', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const surfaces = new AutoTrackingSurfaces('mfe-exemplo');
    stops.push(installDomTracker(document, { ...deps('mfe-exemplo', fed), surfaces }));
    const modal = document.createElement('ion-modal');
    modal.innerHTML = '<button id="opcao-fisica" class="opcao">Consulta digital</button><button id="fechar-fisico" class="fechar">Fechar</button>';
    document.body.appendChild(modal);
    const dispose = surfaces.register(modal, {
      screen: { funcionalidade: 'reembolso', tela: 'tipo-documento' },
      actions: [
        { selector: '.opcao', id: 'tipo-atendimento', elemento: 'lista', rotulo: 'tipo-atendimento',
          optionOf: (element) => element.textContent?.trim() ?? null, allowedOptions: ['Consulta digital'] },
        { selector: '.fechar', id: 'fechar-modal', elemento: 'botao', rotulo: 'fechar-modal' },
      ],
    });
    document.documentElement.setAttribute('data-at-current-screen', 'outro-mfe|outra-tela');
    click('#opcao-fisica');
    click('#fechar-fisico');
    modal.querySelector('.opcao')!.textContent = 'Maria da Silva';
    click('#opcao-fisica');
    await flush();
    expect(fed).toEqual([
      clickPayload('tipo-documento', 'tipo-atendimento', { elemento: 'lista', opcao_selecionada_1: 'consulta-digital' }),
      clickPayload('tipo-documento', 'fechar-modal'),
    ]);
    dispose();
    click('#opcao-fisica');
    await flush();
    expect(fed).toHaveLength(2);
    modal.remove();
  });

  it('output de select com lista em portal envia abertura e opção com a mesma tela de origem', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const surfaces = new AutoTrackingSurfaces('mfe-exemplo');
    const host = document.createElement('bsad-form-select');
    host.setAttribute('data-at-ref', encodeTrackingToken({
      owner: 'mfe-exemplo', funcionalidade: 'reembolso', tela: 'tipo-documento',
      outputs: [
        { id: 'tipo-atendimento', event: 'ionChange', selector: 'ion-select.item__select', label: 'tipo-atendimento', output: 'onChange', elemento: 'dropdown' },
        { id: 'tipo-atendimento', event: 'click', selector: 'ion-select.item__select', label: 'tipo-atendimento', output: 'onChange', elemento: 'dropdown' },
      ],
    }));
    host.innerHTML = '<ion-select class="item__select" id="abrir-lista"></ion-select>';
    document.querySelector('app-tipo')!.appendChild(host);
    stops = [installDomTracker(document, { ...deps('mfe-exemplo', fed), mode: 'ref', surfaces })];
    click('#abrir-lista');

    const modal = document.createElement('ion-modal');
    modal.innerHTML = '<button role="checkbox" class="select-sheet__option" id="opcao-lista"><span>Consulta digital</span></button>';
    document.body.appendChild(modal);
    const dispose = surfaces.register(modal, {
      screen: { funcionalidade: 'reembolso', tela: 'tipo-documento' },
      actions: [{ selector: 'button.select-sheet__option', id: 'tipo-atendimento', elemento: 'dropdown', rotulo: 'tipo-atendimento',
        optionOf: (element) => element.textContent?.trim() ?? null, allowedOptions: ['Consulta digital'] }],
    });
    document.documentElement.setAttribute('data-at-current-screen', 'outro-mfe|outra-tela');
    click('#opcao-lista span');
    await flush();

    expect(fed).toEqual([
      clickPayload('tipo-documento', 'tipo-atendimento', { elemento: 'dropdown' }),
      clickPayload('tipo-documento', 'tipo-atendimento', { elemento: 'dropdown', opcao_selecionada_1: 'consulta-digital' }),
    ]);
    dispose();
    modal.remove();
  });

  it('modal aberto por código usa a tela capturada para ações já marcadas no seu template', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const surfaces = new AutoTrackingSurfaces('mfe-exemplo');
    stops.push(installDomTracker(document, { ...deps('mfe-exemplo', fed), surfaces }));
    const modal = document.createElement('ion-modal');
    modal.innerHTML = `<button id="acao-modal" ${at('mfe-exemplo', 'fechar-modal')}>Fechar</button>`;
    document.body.appendChild(modal);
    const dispose = surfaces.register(modal, {
      screen: { funcionalidade: 'reembolso', tela: 'tipo-documento' }, actions: [],
    });
    document.documentElement.setAttribute('data-at-current-screen', 'outro-mfe|outra-tela');
    click('#acao-modal');
    await flush();
    expect(fed).toEqual([clickPayload('tipo-documento', 'fechar-modal')]);
    dispose();
    modal.remove();
  });

  it('envia o rótulo do contrato (o mesmo da planilha) mesmo quando o app altera o texto', async () => {
    const button = document.getElementById('fedBtn')!;
    button.textContent = 'Resultado carregado';
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(fed[0]?.params['rotulo']).toBe('anexar');
  });

  it('marcador legado sem rótulo usa o texto visível e nunca envia rótulo vazio', async () => {
    const button = document.getElementById('fedBtn')!;
    button.removeAttribute('data-at-rotulo');
    click('#fedBtn');
    button.textContent = '';
    click('#fedBtn');
    await flush();
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['anexar-recibo', 'anexar']);
  });

  it('emite a opção comprovada separada do rótulo em um clique', async () => {
    const button = document.getElementById('fedBtn')!;
    button.setAttribute('data-at-option', '4');
    button.setAttribute('data-at-option-allowed', '1|2|3|4|5');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(fed[0]?.params['rotulo']).toBe('anexar');
    expect(fed[0]?.params['opcao_selecionada_1']).toBe('4');
  });

  it('não envia valor que mudou fora do conjunto numérico comprovado', async () => {
    const button = document.getElementById('fedBtn')!;
    const warnings: string[] = [];
    const sent: TrackingEvent[] = [];
    button.setAttribute('data-at-owner', 'verificacao');
    stops.push(installDomTracker(document, deps('verificacao', sent, 'app-x', warnings)));
    button.setAttribute('data-at-option', '987654321');
    button.setAttribute('data-at-option-allowed', '1|2|3|4|5');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(sent[0]?.params['opcao_selecionada_1']).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(warnings).toEqual([expect.stringContaining('opção pública')]);
    expect(warnings[0]).not.toContain('987654321');
  });

  it('mantém compatibilidade com marcações anteriores sem lista de valores', async () => {
    const button = document.getElementById('fedBtn')!;
    button.setAttribute('data-at-option', '4');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(fed[0]?.params['opcao_selecionada_1']).toBe('4');
  });

  it('não inventa opção selecionada quando o valor é um objeto sem opção correspondente', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `<ion-select id="obj" aria-label="Serviço" ${at('mob', 'servico', 'data-at-event="ionChange"')}></ion-select>`);
    document.getElementById('obj')!.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: { id: 1 } } }));
    await flush();
    expect(mob).toHaveLength(0);
  });

  it('envia o texto da opção carregada quando o valor é um objeto correspondente', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `<ion-select id="servico-dinamico" aria-label="Serviço" ${at('mob', 'servico', 'data-at-event="ionChange"')}><ion-select-option>Consulta digital</ion-select-option></ion-select>`);
    const selected = { id: 7 };
    const select = document.getElementById('servico-dinamico')!;
    (select.querySelector('ion-select-option') as unknown as { value: unknown }).value = selected;
    select.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: selected } }));
    await flush();
    expect(mob[0]?.params['rotulo']).toBe('servico');
    expect(mob[0]?.params['opcao_selecionada_1']).toBe('consulta-digital');
  });

  it('descobre CustomEvents de Web Components carregados após a instalação e remove listeners no teardown', async () => {
    const host = document.createElement('custom-action');
    host.setAttribute('data-at-owner', 'mfe-exemplo');
    host.setAttribute('data-at-elemento', 'botao');
    host.setAttribute('data-at-outputs', 'acao-nova|actionConfirmed|:host|confirmar|actionConfirmed');
    document.querySelector('app-tipo')!.appendChild(host);
    await flush(); // MutationObserver registra o evento do componente lazy.
    host.dispatchEvent(new CustomEvent('actionConfirmed', { bubbles: true, composed: true }));
    await flush();
    expect(fed.map((event) => event.params['rotulo'])).toContain('confirmar');
    expect(mob).toHaveLength(0);

    stops.forEach((stop) => stop());
    stops = [];
    host.dispatchEvent(new CustomEvent('actionConfirmed', { bubbles: true, composed: true }));
    await flush();
    expect(fed).toHaveLength(1);
  });

  it('CustomEvents de Web Components compostos alcançam o owner correto, sem rastrear inputs ou dismiss', async () => {
    const ui = document.querySelector('app-tipo')!;
    ui.insertAdjacentHTML('beforeend', `
      <widget-service-button id="servico" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento"
        data-at-outputs="servico|widgetClick|:host|saude-digital|widgetClick"></widget-service-button>
      <widget-header id="cabecalho" data-at-owner="mob" data-at-funcionalidade="primeiro-acesso" data-at-tela="cadastro"
        data-at-outputs="voltar|widgetBackButtonClick|:host|voltar|widgetBackButtonClick"></widget-header>
      <widget-input id="campo" aria-label="CPF"></widget-input>
      <widget-modal id="modal"></widget-modal>`);
    await flush(); // registros dinâmicos, sem lista fixa de nomes de eventos do Web Components
    const event = (selector: string, name: string) => document.querySelector(selector)!
      .dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    event('#campo', 'widgetInput');
    event('#campo', 'widgetChange');
    event('#modal', 'widgetModalDidDismiss');
    event('#servico', 'widgetClick');
    event('#cabecalho', 'widgetBackButtonClick');
    await flush();
    expect(fed.map((x) => x.params['rotulo'])).toEqual(['saude-digital']);
    expect(mob.map((x) => x.params['rotulo'])).toEqual(['voltar']);
  });

  it('se a marcação tiver seletor inválido, o gesto do app continua funcionando sem exceção do tracking', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const warnings: string[] = [];
    stops = [installDomTracker(document, deps('mob', mob, 'app-x', warnings))];
    const host = document.createElement('x-faulty');
    host.setAttribute('data-at-owner', 'mob');
    host.setAttribute('data-at-outputs', 'id|click|[|salvar|onClick');
    const button = document.createElement('button');
    host.appendChild(button);
    document.body.appendChild(host);
    let businessClicks = 0;
    button.addEventListener('click', () => { businessClicks++; });
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(businessClicks).toBe(1);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('ignorado com segurança')]));
  });

  it('um documento de iframe não depende do Element global da janela principal', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const frameDocument = iframe.contentDocument!;
    frameDocument.body.innerHTML =
      '<button id="iframeAction" data-at-id="inside" data-at-owner="mob" data-at-funcionalidade="demo" data-at-tela="iframe" data-at-elemento="botao" data-at-rotulo="avancar">Avançar</button>';
    const sent: TrackingEvent[] = [];
    const stop = installDomTracker(frameDocument, deps('mob', sent));
    try {
      const inside = frameDocument.getElementById('iframeAction')!;
      inside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.params['tela']).toBe('app-x:saude:demo:iframe');
    } finally {
      stop();
      iframe.remove();
    }
  });

  it('montagem pesada de tela não impede cliques e mantém owner correto durante a descoberta incremental', async () => {
    const app = document.querySelector('app-tipo')!;
    const big = document.createElement('section');
    big.innerHTML = '<div><span>sem tracking</span></div>'.repeat(3000);
    app.appendChild(big);
    let businessClicks = 0;
    document.getElementById('mobBtn')!.addEventListener('click', () => { businessClicks++; });
    for (let i = 0; i < 20; i++) {
      click('#mobBtn');
      click('#fedBtn');
    }
    await flush();
    expect(businessClicks).toBe(20);
    expect(mob).toHaveLength(20);
    expect(fed).toHaveLength(20);
    expect(mob.every((event) => event.params['rotulo'] === 'sair')).toBe(true);
    expect(fed.every((event) => event.params['rotulo'] === 'anexar')).toBe(true);
    // Teardown deve parar o processamento pendente sem acessar DOM destruído.
    stops.forEach((stop) => stop());
    stops = [];
    big.remove();
    await flush();
  });

  it('destruição durante resolução assíncrona impede envio para provider/MFE desmontado', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const sent: TrackingEvent[] = [];
    let unblock!: (environment: string) => void;
    const environment = new Promise<string>((resolve) => { unblock = resolve; });
    const stop = installDomTracker(document, {
      ...deps('mob', sent),
      resolveEnvironment: () => environment,
    });
    click('#mobBtn');
    stop();
    unblock('app-x');
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('owner diferente não altera a tela global nem emite screen_view', async () => {
    document.documentElement.setAttribute('data-at-current-screen', 'original|pagina');
    expect(emitScreenView(document, 'app-tipo', deps('mob', mob))).toBe(true);
    await flush();
    expect(mob).toHaveLength(0);
    expect(document.documentElement.getAttribute('data-at-current-screen')).toBe('original|pagina');
  });

  it('falha assíncrona do adaptador é diagnosticada sem interromper o clique de negócio', async () => {
    stops.forEach((stop) => stop()); stops = [];
    const messages: string[] = [];
    let businessClicks = 0;
    const button = document.getElementById('mobBtn')!;
    button.addEventListener('click', () => { businessClicks++; });
    stops = [installDomTracker(document, {
      ...deps('mob', []),
      send: async () => { throw new Error('analytics-adapter-offline'); },
      warn: (message) => { messages.push(message); },
    })];
    click('#mobBtn');
    await flush();
    expect(businessClicks).toBe(1);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('falha no envio: Error: analytics-adapter-offline'),
    ]));
  });

  it('ambiente não resolvido: não envia e avisa', async () => {
    stops.forEach((s) => s());
    const sent: TrackingEvent[] = []; const warns: string[] = [];
    stops = [installDomTracker(document, deps('mob', sent, null, warns))];
    click('#mobBtn');
    await flush();
    expect(sent).toHaveLength(0);
    expect(warns[0]).toContain('ambiente não resolvido');
  });

  it('screen_view: só ambiente, produto, funcionalidade e tela, pelo owner do marcador', async () => {
    emitScreenView(document, 'app-tipo', deps('mob', mob));
    emitScreenView(document, 'app-tipo', deps('mfe-exemplo', fed));
    await flush();
    expect(mob).toHaveLength(0);
    expect(fed).toEqual([{ name: 'screen_view', params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', subfuncionalidade: 'tipo-documento', tela: 'app-x:saude:reembolso:tipo-documento' } }]);
  });
});

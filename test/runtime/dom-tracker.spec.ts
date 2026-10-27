/** @jest-environment jsdom */
import { installDomTracker, emitScreenView, type DomTrackerDeps } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

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
  params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', tela: `app-x:saude:${tela}`, categoria: `app-x:saude:${tela}`, elemento: 'botao', rotulo, acao: 'clique', ...extra },
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
    expect(fed).toEqual([clickPayload('tipo-documento', 'anexar-recibo')]);
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

  it('componente sem definição: emite só ao acionar elemento interativo interno', async () => {
    click('#texto');
    click('#okBtn');
    await flush();
    expect(fed.map((e) => e.params['rotulo'])).toEqual(['confirmar']);
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
    expect(fed[0]!.params).toMatchObject({ funcionalidade: 'componentes', tela: 'app-x:saude:card', rotulo: 'excluir' });
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

  it('ionChange envia a opção escolhida; o clique no select não emite', async () => {
    document.querySelector('app-tipo')!.insertAdjacentHTML('beforeend', `<ion-select id="sel" aria-label="Tipo de documento" ${at('mob', 'sel', 'data-at-event="ionChange"')}><ion-select-option>Recibo médico</ion-select-option></ion-select>`);
    const sel = document.getElementById('sel')!;
    (sel.querySelector('ion-select-option') as unknown as { value: string }).value = 'r1';
    sel.click();
    sel.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: 'r1' } }));
    await flush();
    expect(mob).toEqual([clickPayload('tipo-documento', 'tipo-de-documento', { opcao_selecionada_1: 'recibo-medico' })]);
  });

  it('lê no clique o rótulo atualizado pelo app', async () => {
    const button = document.getElementById('fedBtn')!;
    button.textContent = 'Resultado carregado';
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(fed[0]?.params['rotulo']).toBe('resultado-carregado');
  });

  it('emite a opção comprovada separada do rótulo em um clique', async () => {
    const button = document.getElementById('fedBtn')!;
    button.setAttribute('data-at-option', '4');
    button.setAttribute('data-at-option-allowed', '1|2|3|4|5');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(fed[0]?.params['rotulo']).toBe('anexar-recibo');
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
    expect(warnings).toEqual([expect.stringContaining('fora dos valores comprovados')]);
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
    expect(mob).toHaveLength(1);
    expect(mob[0]?.params['opcao_selecionada_1']).toBeUndefined();
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
    expect(fed).toEqual([{ name: 'screen_view', params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', tela: 'app-x:saude:tipo-documento' } }]);
  });
});

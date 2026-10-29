/** @jest-environment jsdom */
import { installDomTracker, emitScreenView, type DomTrackerDeps } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token.js';

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
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['excluir-joao', 'excluir-maria', 'voltar']);
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
    expect(fed.map((event) => event.params['rotulo'])).toEqual(['avaliar-com-4-estrelas', 'avaliar-com-2-estrelas']);
    expect(star.outerHTML).not.toContain('data-at-option');
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
      expect(sent[0]!.params['tela']).toBe('app-x:saude:iframe');
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
    expect(fed.every((event) => event.params['rotulo'] === 'anexar-recibo')).toBe(true);
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
    expect(fed).toEqual([{ name: 'screen_view', params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', tela: 'app-x:saude:tipo-documento' } }]);
  });
});

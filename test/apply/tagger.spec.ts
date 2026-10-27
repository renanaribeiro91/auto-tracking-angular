import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import type { ComponentCatalog, ComponentDef } from '../../src/application/apply/ports/component-catalog.js';

const def = (over: Partial<ComponentDef> & Pick<ComponentDef, 'selectors'>): ComponentDef => ({
  source: 'design-lib',
  outputs: new Map(),
  inputs: new Set(),
  template: '',
  methods: new Map(),
  hostListeners: [],
  ...over,
});

/** componente de biblioteca: duas saídas disparadas por elementos internos distintos */
const header = def({
  selectors: ['lib-header'],
  outputs: new Map([['voltar', 'voltar'], ['icone', 'icone'], ['valor', 'valorChange']]),
  inputs: new Set(['valor']),
  template: '<div id="btnVoltar" (click)="botaoVoltar()"></div><h1>Título</h1><div class="acao icone" (click)="this.icone.emit()"></div>',
  methods: new Map([['botaoVoltar', 'this.voltar.emit();']]),
});
const select = def({
  selectors: ['lib-select'],
  outputs: new Map([['onChange', 'onChange']]),
  template: '<ion-select (ionChange)="setValue($event)"></ion-select>',
  methods: new Map([['setValue', 'this.onChange.emit(v);']]),
});
const local = def({
  selectors: ['app-card'],
  source: 'projeto',
  outputs: new Map([['abrir', 'abrir'], ['tocar', 'tocar']]),
  template: '<button (click)="abrir.emit()">Abrir</button>',
  hostListeners: [{ event: 'click', expr: 'onHost()' }],
  methods: new Map([['onHost', 'this.tocar.emit();']]),
});
const catalog: ComponentCatalog = { get: (tag) => [header, select, local].find((d) => d.selectors.includes(tag)) };

const ctx = (over: Partial<TagContext> = {}): TagContext => ({
  owner: 'mfe-exemplo',
  relFile: 'lib/pages/reembolso/tipo-documento/tipo-documento.page.html',
  funcionalidade: 'reembolso',
  tela: 'tipo-documento',
  isScreen: false,
  catalog,
  usedIds: new Set(),
  ...over,
});

describe('tagger: toda interação declarada no template', () => {
  it('registra aria-label literal vinculado em vez do fallback de método', () => {
    const result = tagTemplate(`<ion-icon data-at-id="rating" data-at-rotulo="on-cliked" [attr.aria-label]="'icon-star-ranking-avaliar'" (click)="onCliked()"></ion-icon>`, ctx());
    expect(result.entries[0]).toMatchObject({ id: 'rating', rotulo: 'icon-star-ranking-avaliar', rotuloDinamico: false });
    expect(result.html).toContain('data-at-id="rating"');
  });

  it('marca como dinâmico um aria-label ligado a expressão não literal', () => {
    const result = tagTemplate('<button [attr.aria-label]="item.nome" (click)="escolher()"></button>', ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: '', rotuloDinamico: true });
  });
  it('documenta seleção dinâmica apenas quando há evento de mudança observável', () => {
    const selection = tagTemplate('<ion-select (ionChange)="selecionar($event)"></ion-select>', ctx());
    const action = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx());
    expect(selection.entries[0]?.opcao_selecionada_1).toBe('dinâmica (opção selecionada)');
    const nativeSelect = tagTemplate('<select (change)="selecionar($event)"><option>Primeira</option></select>', ctx());
    expect(nativeSelect.entries).toHaveLength(1);
    expect(nativeSelect.entries[0]?.opcao_selecionada_1).toBe('dinâmica (opção selecionada)');
    expect(action.entries[0]?.opcao_selecionada_1).toBeUndefined();
  });
  it('(click) nativo: id, módulo, tela, elemento e rótulo estáveis', () => {
    const r = tagTemplate('<ion-button (click)="avancar()">Avançar</ion-button>', ctx());
    expect(r.html).toBe(
      '<ion-button data-at-id="reembolso-tipo-documento-avancar" data-at-elemento="botao" data-at-rotulo="avancar" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento" (click)="avancar()">Avançar</ion-button>',
    );
    expect(r.entries[0]).toMatchObject({ evento: 'click', acao: 'clique', elemento: 'botao', rotulo: 'avancar', origem: '(click)' });
  });

  it('botão só com ícone recebe rótulo pelo handler; texto interpolado é dinâmico', () => {
    const icone = tagTemplate('<ion-button (click)="abrirFiltro()"><ion-icon name="x"></ion-icon></ion-button>', ctx());
    expect(icone.entries[0]).toMatchObject({ rotulo: 'abrir-filtro', rotuloDinamico: false });
    const dinamico = tagTemplate('<ion-item (click)="selecionar(item)">{{ item.nome }}</ion-item>', ctx());
    expect(dinamico.entries[0]).toMatchObject({ rotulo: '', rotuloDinamico: true, elemento: 'lista' });
  });

  it('rótulo ignora blocos @if/@else e URLs; id fica curto', () => {
    const r = tagTemplate('<button (click)="ok()">@if (logado) { Li e concordo com os termos de uso e a política de privacidade https://exemplo.invalid/termos }</button>', ctx());
    expect(r.entries[0]!.id).toBe('reembolso-tipo-documento-li-e-concordo-com-os-termos');
    expect(r.entries[0]!.rotulo).not.toMatch(/https|logado/);
  });

  it('não rastreia digitação, foco, clique ou alterações em inputs', () => {
    const html = [
      '<input type="text" (click)="focar()" (change)="alterar()" data-at-id="antigo" data-at-elemento="botao" data-at-rotulo="focar" data-at-owner="mfe-exemplo" data-at-funcionalidade="x" data-at-tela="x">',
      '<ion-textarea (click)="validar()"></ion-textarea>',
      '<widget-input (widgetChange)="nome=$event" data-at-outputs="id|widgetChange|:host|nome|widgetChange" data-at-owner="mob"></widget-input>',
      '<demo-form-input-cep (onChange)="buscarCep($event)"></demo-form-input-cep>',
      '<demo-form-input (click)="pesquisar()"></demo-form-input>',
      '<demo-input-email (onChange)="salvarEmail($event)"></demo-input-email>',
    ].join('');
    const result = tagTemplate(html, ctx());
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).not.toMatch(/data-at-(id|outputs|elemento|rotulo|owner|funcionalidade|tela)=/);
    expect(tagTemplate(result.html, ctx()).html).toBe(result.html);
  });

  it('não confunde card de documento com input de texto; preserva ação de negócio', () => {
    const doc = def({
      selectors: ['demo-card-input-document'],
      outputs: new Map([['onExcluir', 'onExcluir']]),
      template: '<ion-button (click)="excluir()">Excluir</ion-button>',
      methods: new Map([['excluir', '{ this.onExcluir.emit(); }']]),
    });
    const c: ComponentCatalog = { get: (tag) => tag === 'demo-card-input-document' ? doc : catalog.get(tag) };
    const r = tagTemplate('<demo-card-input-document (onExcluir)="remover()"></demo-card-input-document>', ctx({ catalog: c }));
    expect(r.entries).toHaveLength(1);
    expect(r.html).toContain('data-at-outputs');
  });

  it('preserva removerItem de chip composto, que é botão e não digitação', () => {
    const chip = def({
      selectors: ['demo-input-chip'],
      outputs: new Map([['removerItem', 'removerItem']]),
      template: '<button (click)="removerItem.emit()">Remover</button>',
    });
    const c: ComponentCatalog = { get: (tag) => tag === 'demo-input-chip' ? chip : catalog.get(tag) };
    const r = tagTemplate('<demo-input-chip (removerItem)="removerPais($event)"></demo-input-chip>', ctx({ catalog: c }));
    expect(r.entries.map((e) => e.origem)).toEqual(['(removerItem) em <demo-input-chip>']);
    expect(r.html).toContain('data-at-outputs');
  });

  it('ion-select vira ionChange com elemento dropdown', () => {
    const r = tagTemplate('<ion-select aria-label="Tipo de documento" (ionChange)="trocar($event)"></ion-select>', ctx());
    expect(r.html).toContain('data-at-event="ionChange"');
    expect(r.entries[0]).toMatchObject({ elemento: 'dropdown', rotulo: 'tipo-de-documento' });
  });

  it('link só com routerLink/href é interação; href "#" não é', () => {
    const r = tagTemplate('<a routerLink="/ajuda">Ajuda</a><a href="#">nada</a>', ctx());
    expect(r.entries.map((e) => [e.elemento, e.rotulo, e.origem])).toEqual([['link', 'ajuda', 'routerLink']]);
  });

  it('saídas de componente de biblioteca são mapeadas até o elemento interno que as dispara', () => {
    const r = tagTemplate('<lib-header (voltar)="voltar()" (icone)="abrirMapa()" (valorChange)="x=$event" (blur)="t()"></lib-header>', ctx());
    expect(r.html).toContain(
      'data-at-outputs="reembolso-tipo-documento-voltar|click|#btnVoltar|voltar|voltar;reembolso-tipo-documento-abrir-mapa|click|div.acao.icone|abrir-mapa|icone"',
    );
    expect(r.entries.map((e) => e.origem)).toEqual(['(voltar) em <lib-header>', '(icone) em <lib-header>']);
  });

  it('compacta saídas repetidas e conserva o ID que já existia no HTML', () => {
    const card = def({
      selectors: ['widget-actions'], outputs: new Map([['onAction', 'onAction']]),
      template: '<button class="acao1" (click)="this.onAction.emit()">A</button>'
        + '<button class="acao2" (click)="this.onAction.emit()">B</button>'
        + '<button class="acao3" (click)="this.onAction.emit()">C</button>',
    });
    const c: ComponentCatalog = { get: (tag) => tag === 'widget-actions' ? card : catalog.get(tag) };
    const legacy = '<widget-actions data-at-outputs="meu-id-manual|click|button.acao1|acao|onAction" (onAction)="acao()"></widget-actions>';
    const first = tagTemplate(legacy, ctx({ catalog: c, usedIds: new Set(['meu-id-manual']) }));
    expect(first.entries.map((entry) => entry.id)).toEqual(['meu-id-manual']);
    expect(first.html).toContain('data-at-outputs="meu-id-manual|click|button.acao1|');
    const second = tagTemplate(first.html, ctx({ catalog: c, usedIds: new Set(['meu-id-manual']) }));
    expect(second.html).toBe(first.html);
    expect(second.entries[0]?.id).toBe('meu-id-manual');
  });

  it('saída comprovada por ionChange é mantida; output desconhecido é ignorado sem alerta', () => {
    expect(tagTemplate('<lib-select (onChange)="filtrar($event)"></lib-select>', ctx()).html).toContain('|ionChange|ion-select|');
    const unknown = tagTemplate('<x-desconhecido (confirmar)="ok()"></x-desconhecido>', ctx());
    expect(unknown.entries).toHaveLength(0);
    expect(unknown.html).not.toContain('data-at-outputs');
    expect(unknown.diagnostics).toEqual([]);
    const second = tagTemplate(unknown.html, ctx());
    expect(second.html).toBe(unknown.html);
  });

  it('output declarado sem gesto comprovado fica fora do escopo, sem pendência', () => {
    const missingProducer = def({ selectors: ['lib-sem-gesto'], outputs: new Map([['confirmar', 'confirmar']]), template: '<span>Sem gesto</span>' });
    const localCatalog: ComponentCatalog = { get: (tag) => tag === 'lib-sem-gesto' ? missingProducer : catalog.get(tag) };
    const r = tagTemplate('<lib-sem-gesto (confirmar)="salvar()"></lib-sem-gesto>', ctx({ catalog: localCatalog }));
    expect(r.entries).toHaveLength(0);
    expect(r.html).not.toContain('data-at-outputs');
    expect(r.diagnostics).toEqual([]);
  });

  it('estado de formulário não vira um clique', () => {
    const component = def({
      selectors: ['ui-form'], outputs: new Map([['onChange', 'onChange']]),
      methods: new Map([['iniciar', '{ this.form.valueChanges.subscribe(v => this.onChange.emit(v)); }']]),
    });
    const c: ComponentCatalog = { get: (tag) => tag === 'ui-form' ? component : catalog.get(tag) };
    const r = tagTemplate('<ui-form (onChange)="atualizar()"></ui-form>', ctx({ catalog: c }));
    expect(r.diagnostics).toEqual([]);
    expect(r.entries).toEqual([]);
  });

  it('não confunde conclusão pelo store com clique', () => {
    const c = def({ selectors: ['ui-store'], outputs: new Map([['done', 'done']]),
      methods: new Map([['iniciar', '{ this.store.select(selector).subscribe(v => { if(v) this.done.emit(true); }); }']]) });
    const r = tagTemplate('<ui-store (done)="concluido()"></ui-store>', ctx({ catalog: { get: () => c } }));
    expect(r.diagnostics).toEqual([]);
  });

  it('não transforma botão comentado em pendência de clique', () => {
    const card = def({ selectors: ['ui-card'], source: 'projeto',
      outputs: new Map([['favorito', 'favorito']]),
      template: '<!-- <button (click)="alternar()">Favoritar</button> -->',
      methods: new Map([['alternar', '{ this.favorito.emit(true); }']]) });
    const r = tagTemplate('<ui-card (favorito)="salvar()"></ui-card>', ctx({ catalog: { get: () => card } }));
    expect(r.diagnostics).toEqual([]);
    expect(r.entries).toEqual([]);
  });

  it('não inventa segundo gesto para output órfão em biblioteca instalada', () => {
    const item = def({
      selectors: ['demo-item'],
      outputs: new Map([['onClick', 'onClick'], ['clickIcon', 'clickIcon']]),
      template: '<div class="status" (click)="handleClick($event)"><demo-icon slot="end"></demo-icon></div>',
      methods: new Map([
        ['handleClick', '{ this.onClick.emit(event); }'],
        ['handleClickIcon', '{ this.clickIcon.emit(event); }'],
      ]),
    });
    const result = tagTemplate(
      '<demo-item (onClick)="editar()" (clickIcon)="editar()"></demo-item>',
      ctx({ catalog: { get: () => item } }),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.entries.map((entry) => entry.origem)).toEqual(['(onClick) em <demo-item>']);
    expect(result.html).toContain('|click|div.status|');
    expect(result.html).not.toContain('|clickIcon');
  });

  it('emissor indireto sem origem DOM comprovada é ignorado sem alerta', () => {
    const item = def({
      selectors: ['lib-item'],
      outputs: new Map([['clickIcon', 'clickIcon']]),
      template: '<div>Sem gesto observado</div>',
      methods: new Map([
        ['handleClickIcon', '{ this.clickIcon.emit(); }'],
        ['wire', '{ this.handleClickIcon(); }'],
      ]),
    });
    const result = tagTemplate('<lib-item (clickIcon)="editar()"></lib-item>',
      ctx({ catalog: { get: () => item } }));
    expect(result.diagnostics).toEqual([]);
  });

  it('bindings não declarados nos componentes certos ficam fora do escopo sem alertas', () => {
    const components = [
      def({ selectors: ['app-ultimas-solicitacoes'], source: 'projeto',
        outputs: new Map([['selecionarProfissionalClick', 'selecionarProfissionalClick']]) }),
      def({ selectors: ['bsc-dados-documento-terapia'], source: 'projeto',
        outputs: new Map([['prosseguir', 'prosseguir']]) }),
    ];
    const result = tagTemplate(
      '<app-ultimas-solicitacoes (adicionarNovoProfissionalClick)="adicionar()"></app-ultimas-solicitacoes>'
      + '<bsc-dados-documento-terapia (excluirEvent)="excluir()"></bsc-dados-documento-terapia>',
      ctx({ catalog: { get: (tag) => components.find((c) => c.selectors.includes(tag)) } }),
    );
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('output Angular de filho desconhecido não é evento DOM comprovado e não vira diagnóstico', () => {
    const outer = def({ selectors: ['ui-outer'], outputs: new Map([['salvar', 'salvar']]),
      template: '<ui-inner (onSaved)="salvar.emit()"></ui-inner>' });
    const r = tagTemplate('<ui-outer (salvar)="ok()"></ui-outer>', ctx({ catalog: { get: () => outer } }));
    expect(r.entries).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it('um clique no cabeçalho alterna accordion sem duplicar opened/closed', () => {
    const component = def({
      selectors: ['ui-accordion'],
      outputs: new Map([['opened', 'opened'], ['closed', 'closed']]),
      methods: new Map([
        ['abrir', '{ this.opened.emit(); }'],
        ['fechar', '{ this.closed.emit(); }'],
      ]),
      template: '<mat-expansion-panel (opened)="abrir()" (closed)="fechar()"><mat-expansion-panel-header>Título</mat-expansion-panel-header></mat-expansion-panel>',
    });
    const c: ComponentCatalog = { get: () => component };
    const result = tagTemplate('<ui-accordion (opened)="abrir()" (closed)="fechar()"></ui-accordion>', ctx({ catalog: c }));
    expect(result.diagnostics).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.html).toContain('|click|mat-expansion-panel-header|');
  });

  it('seleção de aba rastreia click no role tab, não a notificação de estado', () => {
    const component = def({
      selectors: ['ui-tabs'], outputs: new Map([['selectedTabChange', 'selectedTabChange']]),
      template: '<mat-tab-group (selectedTabChange)="selectedTabChange.emit($event)"></mat-tab-group>',
    });
    const r = tagTemplate('<ui-tabs (selectedTabChange)="trocar()"></ui-tabs>', ctx({
      catalog: { get: () => component },
    }));
    expect(r.diagnostics).toEqual([]);
    expect(r.html).toContain('|click|mat-tab-header [role=tab]|');
  });

  it('swiperslidechange é mudança de estado, não click fabricado', () => {
    const component = def({
      selectors: ['ui-slides'], source: 'projeto',
      outputs: new Map([['slideChanged', 'slideChanged']]),
      methods: new Map([['slideChange', '{ this.slideChanged.emit(1); }']]),
      template: '<swiper-container (swiperslidechange)="slideChange($event)"></swiper-container>',
    });
    const r = tagTemplate('<ui-slides (slideChanged)="atualizar()"></ui-slides>', ctx({ catalog: { get: () => component } }));
    expect(r.entries).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it('ionCancel público é observado no seletor do calendário', () => {
    const component = def({
      selectors: ['ui-datetime'], outputs: new Map([['dataCancelada', 'dataCancelada']]),
      template: '<ion-datetime (ionCancel)="cancelar($event)"></ion-datetime>',
      methods: new Map([['cancelar', '{ this.dataCancelada.emit(); }']]),
    });
    const r = tagTemplate('<ui-datetime (dataCancelada)="desfazer()"></ui-datetime>', ctx({ catalog: { get: () => component } }));
    expect(r.diagnostics).toEqual([]);
    expect(r.html).toContain('|ionCancel|ion-datetime|');
  });

  it('não aprova callback de modal sem vínculo DOM', () => {
    const modal = def({ selectors: ['ui-modal'], outputs: new Map([['onFechar', 'onFechar']]) });
    const c: ComponentCatalog = { get: () => modal };
    const result = tagTemplate('<ui-modal (onFechar)="fechar()"></ui-modal>', ctx({ catalog: c }));
    expect(result.diagnostics).toEqual([]);
  });

  it('não confunde ciclo de vida de modal com gesto do usuário', () => {
    const modal = def({
      selectors: ['ui-modal'],
      outputs: new Map([['openedModal', 'openedModal'], ['closedModal', 'closedModal']]),
      methods: new Map([['ngOnChanges', '{ this.openedModal.emit(); }'], ['onDidDismiss', '{ this.closedModal.emit(); }']]),
    });
    const modalCatalog: ComponentCatalog = { get: (tag) => tag === 'ui-modal' ? modal : catalog.get(tag) };
    const result = tagTemplate('<ui-modal (openedModal)="carregar()" (closedModal)="finalizar()"></ui-modal>', ctx({ catalog: modalCatalog }));
    expect(result.entries).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.html).not.toContain('data-at-outputs');
  });

  it('componente do projeto: elemento interno já é marcado no próprio template; só o HostListener vai no host', () => {
    const r = tagTemplate('<app-card (abrir)="ver()" (tocar)="tocar()"></app-card>', ctx());
    expect(r.html).toContain('data-at-outputs="reembolso-tipo-documento-tocar|click|:host|tocar|tocar"');
    expect(r.entries).toHaveLength(1);
  });

  it('marcador de tela no primeiro elemento real (ng-template pulado, ng-container transparente)', () => {
    const r = tagTemplate('<ng-template #t><span>x</span></ng-template><ng-container><ion-content>a</ion-content></ng-container>', ctx({ isScreen: true }));
    expect(r.html).toContain('<ion-content data-at-screen="reembolso-tipo-documento-tela"');
    expect(r.entries[0]).toMatchObject({ evento: 'screen_view', acao: 'visualizacao', elemento: '' });
    const vazio = tagTemplate('<ng-template #t><span>x</span></ng-template>', ctx({ isScreen: true }));
    expect(vazio.diagnostics.map((d) => d.code)).toEqual(['SCREEN_MARKER_NOT_PLACEABLE']);
  });

  it('ignora tags comentadas e acusa texto que contradiz o handler', () => {
    expect(tagTemplate('<!-- <button (click)="a()">A</button> -->', ctx()).entries).toHaveLength(0);
    expect(tagTemplate('<button (click)="avancar()">Voltar</button>', ctx()).diagnostics[0]!.code).toBe('VISIBLE_LABEL_BEHAVIOR_CONFLICT');
  });

  it('preserva ajuste manual, repõe ausentes e remove marcação obsoleta', () => {
    const r = tagTemplate('<button data-at-id="meu-id" data-at-rotulo="salvar-rascunho" (click)="s()">Salvar</button><div data-at-id="velho" data-at-tela="x">sem handler</div>', ctx());
    expect(r.html).toContain('data-at-id="meu-id"');
    expect(r.entries[0]).toMatchObject({ id: 'meu-id', rotulo: 'salvar-rascunho' });
    expect(r.html).toContain('<div>sem handler</div>');
  });

  it('reconcilia o owner da configuração sem renomear ids e fica idempotente', () => {
    const old = '<button data-at-id="reembolso-tipo-documento-avancar" data-at-owner="mob" (click)="avancar()">Avançar</button>';
    const first = tagTemplate(old, ctx({ owner: 'mfe-exemplo' }));
    expect(first.html).toContain('data-at-id="reembolso-tipo-documento-avancar"');
    expect(first.html).toContain('data-at-owner="mfe-exemplo"');
    expect(first.entries[0]).toMatchObject({ id: 'reembolso-tipo-documento-avancar', owner: 'mfe-exemplo' });

    const second = tagTemplate(first.html, ctx({ owner: 'mfe-exemplo', usedIds: new Set([first.entries[0]!.id]) }));
    expect(second.html).toBe(first.html);
    expect(second.entries).toEqual(first.entries);
  });

  it('duas saídas comprovadas pelo mesmo gesto mantêm ids distintos e estáveis', () => {
    const agenda = def({ selectors: ['x-agenda'], outputs: new Map([['voltar', 'voltar'], ['abrirInfo', 'abrirInfo']]), template: '<button (click)="voltar.emit(); abrirInfo.emit()">Ações</button>' });
    const agendaCatalog: ComponentCatalog = { get: (tag) => tag === 'x-agenda' ? agenda : catalog.get(tag) };
    const html = '<x-agenda (voltar)="voltar()" (abrirInfo)="info()"></x-agenda>';
    const first = tagTemplate(html, ctx({ catalog: agendaCatalog }));
    const second = tagTemplate(first.html, ctx({ catalog: agendaCatalog, usedIds: new Set(first.entries.map((e) => e.id)) }));
    expect(first.entries.map((e) => e.id)).toEqual(['reembolso-tipo-documento-voltar', 'reembolso-tipo-documento-info']);
    expect(second.html).toBe(first.html);
    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
  });

  it('troca atributo gerenciado que é o primeiro da tag sem corromper o nome da tag', () => {
    const old = '<lib-header data-at-outputs="x|click|#btnVoltar|voltar" data-at-owner="mfe-exemplo"\n  (voltar)="voltar()"></lib-header>';
    const r = tagTemplate(old, ctx({ usedIds: new Set(['x']) }));
    expect(r.html.startsWith('<lib-header ')).toBe(true);
    expect(r.html).toContain('data-at-outputs="reembolso-tipo-documento-voltar|click|#btnVoltar|voltar|voltar"');
    expect(r.html.match(/data-at-outputs=/g)).toHaveLength(1);
    expect(tagTemplate(r.html, ctx({ usedIds: new Set(r.entries.map((e) => e.id)) })).html).toBe(r.html);
  });

  it('não renomeia contexto de componente compartilhado já instrumentado por mudança de pastas', () => {
    const old = '<button data-at-id="consulta-abrir" data-at-owner="mob" data-at-funcionalidade="consulta" data-at-tela="resumo" (click)="abrir()">Abrir</button>';
    const modifiedContext = ctx({ funcionalidade: 'detalhes', tela: 'resumo' });
    const first = tagTemplate(old, modifiedContext);
    expect(first.html).toContain('data-at-funcionalidade="consulta"');
    expect(first.entries[0]).toMatchObject({ id: 'consulta-abrir', funcionalidade: 'consulta', tela: 'resumo' });
    expect(tagTemplate(first.html, modifiedContext).html).toBe(first.html);
    const brandNew = tagTemplate('<button (click)="abrir()">Abrir</button>', modifiedContext);
    expect(brandNew.entries[0]?.funcionalidade).toBe('detalhes');
  });

  it('segunda execução não altera nada (ids, saídas e atributos estáveis)', () => {
    const html = '<lib-header (voltar)="voltar()"></lib-header><ion-button (click)="a()">A</ion-button><ion-button (click)="a()">A</ion-button>';
    const first = tagTemplate(html, ctx({ isScreen: true }));
    const used = new Set([...first.html.matchAll(/data-at-(?:id|screen)="([^"]+)"/g)].map((m) => m[1]!));
    const second = tagTemplate(first.html, ctx({ isScreen: true, usedIds: used }));
    expect(second.html).toBe(first.html);
    expect(second.entries).toEqual(first.entries);
    expect(first.entries.filter((e) => e.evento === 'click').map((e) => e.id)).toEqual(['reembolso-tipo-documento-voltar', 'reembolso-tipo-documento-a', 'reembolso-tipo-documento-a-2']);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemplateTagger, tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { encodeTrackingToken } from '../../src/domain/contract/tracking-token-encoder.js';
import type { ComponentCatalog, ComponentDef } from '../../src/application/apply/ports/component-catalog.js';
import { listItemFields as listItemFields_, staticListLabels } from '../../src/application/apply/selection-provenance.js';
import type { ComponentInfo } from '../../src/application/apply/ports/project-index.js';

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
  it('retira apenas tracking de componente sem uso e conserva comentários e bindings de negócio', () => {
    const tagger = new TemplateTagger();
    const source = '<!-- <button data-at-id="exemplo"> -->\n<button data-testid="salvar" data-at-id="antigo" [attr.data-at-ref]="token" (click)="salvar()">Salvar</button>';
    const expected = '<!-- <button data-at-id="exemplo"> -->\n<button data-testid="salvar" (click)="salvar()">Salvar</button>';
    expect(tagger.untagTemplate(source)).toBe(expected);
    expect(tagger.untagTemplate(expected)).toBe(expected);
  });
  it('identificador de teste em aria-label vira rótulo sem prefixo técnico e substitui rótulo técnico antigo', () => {
    const result = tagTemplate(`<ion-icon data-at-id="rating" data-at-rotulo="on-cliked" [attr.aria-label]="'icon-star-ranking-avaliar'" (click)="onCliked()"></ion-icon>`, ctx());
    expect(result.entries[0]).toMatchObject({ id: 'rating', rotulo: 'star-ranking-avaliar' });
    expect(result.html).toContain('data-at-id="rating"');
    expect(result.html).toContain('data-at-rotulo="star-ranking-avaliar"');
  });

  it('preserva rótulo manual legível já gravado', () => {
    const result = tagTemplate('<button data-at-rotulo="enviar-pedido" (click)="salvar()">Salvar</button>', ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: 'enviar-pedido' });
  });

  it('title humano prevalece sobre data-testid usado como aria-label', () => {
    const result = tagTemplate(`<bsad-button title="Prosseguir" [attr.aria-label]="'btn-anexar-pedido-medico-prosseguir'" (click)="navegarParaProsseguir()"></bsad-button>`, ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: 'prosseguir' });
  });

  it('handler sem texto perde palavras de código; data-testid é o próximo recurso', () => {
    expect(tagTemplate('<bsad-header (click)="cliqueVoltar()"></bsad-header>', ctx()).entries[0]!.rotulo).toBe('voltar');
    expect(tagTemplate('<div (click)="clickCheckbox()"></div>', ctx()).entries[0]!.rotulo).toBe('checkbox');
    expect(tagTemplate(`<ion-icon [attr.data-testid]="'icon-card-acompanhamento-lupa'" (click)="clique()"></ion-icon>`, ctx()).entries[0]!.rotulo)
      .toBe('acompanhamento-lupa');
  });

  it('wrapper sem texto usa o rótulo único do filho', () => {
    const result = tagTemplate('<div (click)="clickCheckbox()"><bsad-form-checkbox label="Agendar em dias diferentes"></bsad-form-checkbox></div>', ctx());
    expect(result.entries[0]!.rotulo).toBe('agendar-em-dias-diferentes');
  });

  it('expressão com ">" em atributo de filho não vaza para o rótulo', () => {
    const html = `<div (click)="abrirModalLocalizacao()" [attr.aria-label]="'btn-welcome-home-abrir-localizacao'"><x-select [enable]="lista.length > 0" [label]="ok ? 'a' : 'b'"></x-select></div>`;
    expect(tagTemplate(html, ctx()).entries[0]!.rotulo).toBe('abrir-localizacao');
  });

  it('title ligado a literal é rótulo; texto longo projetado em componente não é', () => {
    expect(tagTemplate(`<bsad-button [title]="'Avançar'" (click)="avancar()"></bsad-button>`, ctx()).entries[0]!.rotulo).toBe('avancar');
    const modal = tagTemplate('<x-modal (click)="onModalCloseButton()"><p>Ao ser redirecionado para efetuar a ligação o aplicativo pode fechar</p></x-modal>', ctx());
    expect(modal.entries[0]!.rotulo).toBe('fechar');
  });

  it('argumento literal já contido no handler não é repetido', () => {
    expect(tagTemplate(`<button (click)="editarLocalAtendimento('local-atendimento')"></button>`, ctx()).entries[0]!.rotulo).toBe('editar-local-atendimento');
    expect(tagTemplate(`<button (click)="abrir('termos')"></button>`, ctx()).entries[0]!.rotulo).toBe('abrir-termos');
    expect(tagTemplate(`<button (click)="selecionarPlano('plan')"></button>`, ctx()).entries[0]!.rotulo).toBe('selecionar-plano-plan');
  });

  it('URL no argumento do handler não entra no rótulo', () => {
    expect(tagTemplate(`<a (click)="redireciona('http://www.exemplo.invalid')"><img src="x.png"></a>`, ctx()).entries[0]!.rotulo).toBe('redireciona');
  });

  describe('rótulo de item de lista estática', () => {
    const classText = `class MenuPage {
      itens = [{ titulo: 'Saúde em equilíbrio', rota: 'a' }, { titulo: 'Salas<br>VIP', rota: 'b' }] as const;
      @Input() externos: Item[] = [];
      mistos = [{ titulo: 'A' }, { titulo: this.nome }];
    }`;
    const listLabels = staticListLabels({ classText } as ComponentInfo);

    it('extrai somente listas inteiramente literais', () => {
      expect(listLabels('itens', 'titulo')).toEqual(['Saúde em equilíbrio', 'Salas<br>VIP']);
      expect(listLabels('externos', 'titulo')).toBeNull();
      expect(listLabels('mistos', 'titulo')).toBeNull();
      expect(listLabels('itens', 'inexistente')).toBeNull();
    });

    it('*ngFor no próprio elemento e @for no ancestral provam o conjunto; valor variável fica fora', () => {
      const own = tagTemplate('<x-botao *ngFor="let b of itens" [title]="b.titulo" (click)="navegarPara(b)"></x-botao>', ctx({ listLabels, mode: 'ref' }));
      expect(own.entries[0]).toMatchObject({ rotulo: 'navegar-para', rotulos: ['saude-em-equilibrio', 'salas-vip'] });
      expect(decodeTrackingToken(own.entries[0]!.ref!)?.rotulos).toEqual(['saude-em-equilibrio', 'salas-vip']);
      const block = tagTemplate('@for (op of itens; track op.rota) { <button (click)="abrir(op)">{{ op.titulo }}</button> }', ctx({ listLabels }));
      expect(block.entries[0]!.rotulos).toEqual(['saude-em-equilibrio', 'salas-vip']);
      expect(block.html).toContain('data-at-rotulos="saude-em-equilibrio|salas-vip"');
      const external = tagTemplate('<x-botao *ngFor="let b of externos" [title]="b.titulo" (click)="abrir(b)"></x-botao>', ctx({ listLabels }));
      // Lista não provável: o texto é lido no clique; 'abrir' segue como fallback do contrato.
      expect(external.entries[0]).toMatchObject({ rotulo: '[rotulo-do-botao-exibido]' });
      expect(external.html).toContain('data-at-rotulo="abrir"');
      expect(external.html).toMatch(/data-at-rotulo-dinamico="[^"|]+"/);
      expect(external.entries[0]!.rotulos).toBeUndefined();
    });
  });

  it('texto comprovado vira rótulo fixo; mais de um valor vira lista; sem prova segue marcador', () => {
    const tagged = (html: string, known: Record<string, readonly string[]>) => tagTemplate(html, ctx({ mode: 'ref', displayTexts: (expression) => known[expression] ?? null })).entries[0]!;
    expect(tagged(`<button (click)="ir()"><span>{{ textos.BOTAO }}</span></button>`, { 'textos.BOTAO': ['Ok, entendi'] })).toMatchObject({ rotulo: 'ok-entendi' });
    expect(tagged(`<button (click)="ir()">{{ rotulo }}</button>`, { rotulo: ['Salvar', 'Voltar'] })).toMatchObject({ rotulos: ['salvar', 'voltar'] });
    expect(tagged(`<button (click)="ir()">{{ textos.BOTAO }}</button>`, {})).toMatchObject({ rotulo: '[rotulo-do-botao-exibido]' });
    expect(tagged(`<ng-container *ngFor="let item of itens"><button (click)="ir(item)">{{ item }}</button></ng-container>`, { item: ['Falso'] }).rotulo).not.toBe('falso');
  });

  it('card com vários textos é nomeado pela ação; um único texto dinâmico segue lido da tela', () => {
    expect(tagTemplate(`<div (click)="editarDados()"><p>{{ nome }}</p><p>{{ valor }}</p></div>`, ctx({ mode: 'ref' })).entries[0]!.rotulo).toBe('editar-dados');
    expect(tagTemplate(`<button (click)="ir()">{{ apiTexto }}</button>`, ctx({ mode: 'ref' })).entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
  });

  it('identificador de teste ligado não esconde o texto real', () => {
    const entry = tagTemplate(`<button [attr.aria-label]="ids.BTN" title="Salvar" (click)="ir()"></button>`, ctx({ mode: 'ref', displayTexts: (expression) => expression === 'ids.BTN' ? ['btn-salvar'] : null })).entries[0]!;
    expect(entry.rotulo).toBe('salvar');
  });

  it('formulário usa o texto do botão de envio e método em inglês vira o verbo do negócio', () => {
    expect(tagTemplate(`<form (ngSubmit)="emitirEntrar()"><button type="submit">Entrar</button></form>`, ctx({ mode: 'ref' })).entries[0]!.rotulo).toBe('entrar');
    expect(tagTemplate(`<ion-icon (click)="openFiltro()"></ion-icon>`, ctx({ mode: 'ref' })).entries[0]!.rotulo).toBe('abrir-filtro');
    expect(tagTemplate(`<ion-icon (click)="toggleChange()"></ion-icon>`, ctx({ mode: 'ref' })).entries[0]!.rotulo).toBe('alternar');
  });

  it('aba de página não é dropdown', () => {
    expect(new TemplateTagger().elementoFor('x-tab-group', new Map(), 'selectedTabChange')).toBe('aba');
    expect(new TemplateTagger().elementoFor('x-tab-botao', new Map(), 'abaClick')).toBe('aba');
  });

  it('clique de tab bar é tab-bar e usa o nome exibido da aba como rótulo', () => {
    const tab = def({ selectors: ['x-tab-bar'], outputs: new Map([['onClick', 'onClick']]), template: `<button (click)="onClick.emit()">x</button>` });
    const r = tagTemplate(`<x-tab-bar tabTitle="Clube mais Saúde" (onClick)="ir()"></x-tab-bar>`, ctx({ mode: 'ref', catalog: { get: (tag) => (tag === 'x-tab-bar' ? tab : catalog.get(tag)) } }));
    expect(r.entries).toEqual([expect.objectContaining({ elemento: 'tab-bar', rotulo: 'clube-mais-saude' })]);
  });

  it('saída cujo gesto já pertence a outra saída nunca dispara e fica fora da evidência', () => {
    const select = def({ selectors: ['x-sel'], outputs: new Map([['aberto', 'aberto'], ['fechado', 'fechado']]), template: `<button (click)="aberto.emit(); fechado.emit()">x</button>` });
    const r = tagTemplate(`<x-sel (aberto)="abrir()" (fechado)="fechar()"></x-sel>`, ctx({ mode: 'ref', catalog: { get: (tag) => (tag === 'x-sel' ? select : catalog.get(tag)) } }));
    expect(r.entries.map((item) => item.origem)).toEqual(['(aberto) em <x-sel>']);
    expect(decodeTrackingToken(r.entries[0]!.ref!)?.outputs?.map((item) => item.output)).toEqual(['aberto']);
  });

  it('componente tagueado ausente das dependências instaladas mantém a marcação e avisa', () => {
    const ref = encodeTrackingToken({ owner: 'mfe-exemplo', funcionalidade: 'home', tela: 'home',
      outputs: [{ id: 'home-inicio', event: 'click', selector: 'ion-tab-button', label: 'inicio', output: 'onClick', elemento: 'filtro' }] });
    const html = `<x-tab-bar data-at-ref="${ref}" (onClick)="ir()"></x-tab-bar>`;
    const result = tagTemplate(html, ctx({ mode: 'ref' }));
    expect(result.html).toBe(html);
    expect(result.entries).toEqual([expect.objectContaining({ id: 'home-inicio', evento: 'click', elemento: 'filtro', rotulo: 'inicio', ref })]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['COMPONENT_DEFINITION_MISSING']);
  });

  it('input de texto do componente é o rótulo; lista importada de outro arquivo prova os valores', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-lista-'));
    try {
      fs.writeFileSync(path.join(dir, 'itens.data.ts'), `export const itens: Item[] = [{ id: 1, texto: 'Alterar Senha' }, { id: 2, texto: 'Termos de uso' }];`);
      const classText = `class ListaPage { configuracoes: Item[]; ngOnInit() { this.configuracoes = itens; } }`;
      fs.writeFileSync(path.join(dir, 'lista.page.ts'), `import { itens } from './itens.data';\n${classText}`);
      const listLabels = staticListLabels({ classText, tsFile: path.join(dir, 'lista.page.ts') } as ComponentInfo);
      const item = def({ selectors: ['x-lista-link-item'], outputs: new Map([['clickEvent', 'clickEvent']]),
        template: '<a (click)="clickEvent.emit()">{{ texto }}</a>', inputs: new Set(['texto']) });
      const html = `<ng-container *ngFor="let configuracao of configuracoes; let i = index">
        <x-lista-link-item (clickEvent)="clickLink(configuracao)" [attr.data-testid]="'item-configuracoes-lista-' + i" [texto]="configuracao.texto"></x-lista-link-item>
      </ng-container>`;
      const r = tagTemplate(html, ctx({ listLabels, mode: 'ref', catalog: { get: (tag) => (tag === 'x-lista-link-item' ? item : catalog.get(tag)) } }));
      expect(r.entries[0]).toMatchObject({ elemento: 'link', rotulos: ['alterar-senha', 'termos-de-uso'] });
      // Fallback nunca é o nome do tipo do elemento.
      expect(r.entries[0]!.rotulo).not.toBe('link');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    expect(tagTemplate('<x-card texto="Ver detalhes" (click)="abrir()"></x-card>', ctx()).entries[0]!.rotulo).toBe('ver-detalhes');
    // Input composto do próprio controle é o rótulo; id de teste no aria-label nunca é, e o título do header não descreve o gesto.
    const tab = tagTemplate(`<x-tab tabTitle="Atendimento" [attr.aria-label]="'tab-home-atendimento'" (click)="mudarTituloAtendimento()"></x-tab>`, ctx()).entries[0]!;
    expect(tab.rotulo).toBe('atendimento');
    expect(tab.rotulos).toBeUndefined();
    expect(tagTemplate('<x-barra headerTexto="Ajustes" (click)="salvarDados()"></x-barra>', ctx()).entries[0]!.rotulo).toBe('salvar-dados');
    expect(tagTemplate('<x-opcao labelPlacement="start" (click)="alternarAcesso()"></x-opcao>', ctx()).entries[0]!.rotulo).toBe('alternar-acesso');
    expect(tagTemplate(`<x-opcao [okText]="'Confirmar'" (click)="selecionarHora()"></x-opcao>`, ctx()).entries[0]!.rotulo).toBe('selecionar-hora');
    expect(tagTemplate('<a (click)="clickLink()" data-testid="ajuda-contato"></a>', ctx()).entries[0]!.rotulo).toBe('ajuda-contato');
    // Opções de um segment/select são o valor escolhido, nunca o rótulo do controle.
    const segment = tagTemplate('<ion-segment (ionChange)="selecionarAba($event)" value="lista"><ion-segment-button value="lista"><ion-label>Lista</ion-label></ion-segment-button><ion-segment-button value="mapa"><ion-label>Mapa</ion-label></ion-segment-button></ion-segment>', ctx());
    expect(segment.entries[0]).toMatchObject({ rotulo: 'selecionar-aba', opcao_selecionada_1: '[valor-selecionado]' });
    // Checkbox/toggle: o texto interno é o próprio rótulo do controle.
    expect(tagTemplate('<ion-checkbox (ionChange)="aceitar($event)">Aceito os termos</ion-checkbox>', ctx()).entries[0]!.rotulo).toBe('aceito-os-termos');
  });

  it('item de pessoa física: envia o descritor público provado pelo tipo, nunca o nome da pessoa', () => {
    const classText = `interface Prestador { nomePrestador: string; nomeEspecialidade: string; cpfPrestador: string; }
    class ListaComponent { @Input() itens: Prestador[] = []; @Input() semTipo = []; }`;
    const listItemFields = listItemFields_({ classText } as ComponentInfo);
    const html = (list: string) => `<bsmo-card *ngFor="let p of ${list}" (click)="selecionarProfissional(p)"><b>{{ p.nomePrestador }}</b><i>{{ p.nomeEspecialidade }}</i></bsmo-card>`;
    const typed = tagTemplate(html('itens'), ctx({ listItemFields }));
    expect(typed.html).toContain('[attr.data-at-option]="p.nomeEspecialidade"');
    expect(typed.html).not.toContain('data-at-option]="p.nomePrestador"');
    expect(typed.entries[0]?.opcao_selecionada_1).toBe('[nome-especialidade-selecionado]');
    expect(typed.diagnostics.map((d) => d.code)).not.toContain('OPTION_PUBLIC_VALUE_UNPROVEN');
    const untyped = tagTemplate(html('semTipo'), ctx({ listItemFields }));
    expect(untyped.html).not.toContain('data-at-option');
    expect(untyped.diagnostics.map((d) => d.code)).toContain('OPTION_PUBLIC_VALUE_UNPROVEN');
    // Sem identificador de pessoa física no tipo não há prova de que o nome é de outro sujeito.
    const semCpf = listItemFields_({ classText: 'interface M { nomeMedico: string; nomeEspecialidade: string; } class C { itens: M[] = []; }' } as ComponentInfo);
    expect(tagTemplate(html('itens').replace('nomePrestador', 'nomeMedico'), ctx({ listItemFields: semCpf })).html).not.toContain('data-at-option');
  });
  it('campo genérico da opção recebe o objeto do handler na planilha', () => {
    const listLabels = () => ['A', 'B'];
    const r = tagTemplate('<div *ngFor="let c of itens" [attr.aria-label]="c.name" (click)="selecionarSala(c)"></div>', ctx({ listLabels }));
    expect(r.entries[0]?.opcao_selecionada_1).toBe('[nome-sala-selecionado]');
    expect(r.html).toContain('[attr.data-at-option]="c.name"');
  });
  it('escolha de item de lista envia o campo público exibido, nunca dado pessoal ou técnico', () => {
    const option = (html: string) => {
      const r = tagTemplate(html, ctx());
      return { attr: /\[attr\.data-at-option\]="([^"]+)"/.exec(r.html)?.[1] ?? null, sheet: r.entries.find((e) => e.evento === 'click')?.opcao_selecionada_1 };
    };
    expect(option('<x-card *ngFor="let p of produtos" [titulo]="p.titulo" (click)="selecionarProduto(p)"></x-card>'))
      .toEqual({ attr: 'p.titulo', sheet: '[nome-produto-selecionado]' });
    expect(option('<x-card *ngFor="let p of produtos" [titulo]="p.titulo" (click)="abrirProduto(p)"></x-card>').attr).toBe('p.titulo');
    expect(option('<x-botao *ngFor="let botao of botoes" [title]="botao.titulo" (click)="irPara(botao.rota)"></x-botao>').sheet).toBe('[nome-botao-selecionado]');
    // Output sem prova no catálogo não gera evento: a opção também não é gravada.
    expect(option('<bsad-card *ngFor="let p of produtos" [titulo]="p.titulo" (onClick)="abrirProduto(p)"></bsad-card>').attr).toBeNull();
    expect(option('<div *ngFor="let b of especialidades" (click)="onSelecionarAutoComplete(b)">{{ b }}</div>').attr).toBe('b');
    expect(option('<ion-item *ngFor="let s of semestres" (click)="desmarcar(s); selecionarSemestre(s.rotulo)">{{ s.rotulo }}</ion-item>').attr).toBe('s.rotulo');
    expect(option('<ion-item *ngFor="let e of enderecos" (click)="selecionar(e)">{{ e.description }}</ion-item>').attr).toBeNull();
    expect(option('<ion-item *ngFor="let x of itens" (click)="selecionar(x)">{{ x.cpf }}</ion-item>').attr).toBeNull();
    expect(option('<ion-item *ngFor="let x of itens" (click)="salvar()">{{ x.titulo }}</ion-item>').attr).toBeNull();
  });
  it('aria-label dinâmico não vira rótulo: valor variável nunca é enviado, usa o nome da ação', () => {
    const result = tagTemplate('<button [attr.aria-label]="item.nome" (click)="escolher()"></button>', ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: 'escolher' });
  });
  it('documenta seleção dinâmica apenas quando há evento de mudança observável', () => {
    const selection = tagTemplate('<ion-select (ionChange)="selecionar($event)"></ion-select>', ctx());
    const action = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx());
    expect(selection.entries[0]?.opcao_selecionada_1).toBe('[valor-selecionado]');
    const nativeSelect = tagTemplate('<select (change)="selecionar($event)"><option>Primeira</option></select>', ctx());
    expect(nativeSelect.entries).toHaveLength(1);
    expect(nativeSelect.entries[0]?.opcao_selecionada_1).toBe('[valor-selecionado]');
    expect(action.entries[0]?.opcao_selecionada_1).toBeUndefined();
  });
  it('(click) nativo: id, módulo, tela, elemento e rótulo estáveis', () => {
    const r = tagTemplate('<ion-button (click)="avancar()">Avançar</ion-button>', ctx());
    expect(r.html).toBe(
      '<ion-button data-at-id="reembolso-tipo-documento-avancar" data-at-elemento="botao" data-at-rotulo="avancar" data-at-owner="mfe-exemplo" data-at-funcionalidade="reembolso" data-at-tela="tipo-documento" data-at-origin="required" (click)="avancar()">Avançar</ion-button>',
    );
    expect(r.entries[0]).toMatchObject({ evento: 'click', acao: 'clique', elemento: 'botao', rotulo: 'avancar', origem: '(click)' });
  });

  it('botão só com ícone recebe rótulo pelo handler; texto interpolado é dinâmico', () => {
    const icone = tagTemplate('<ion-button (click)="abrirFiltro()"><ion-icon name="x"></ion-icon></ion-button>', ctx());
    expect(icone.entries[0]).toMatchObject({ rotulo: 'abrir-filtro' });
    const dinamico = tagTemplate('<ion-item (click)="selecionar(item)">{{ item.nome }}</ion-item>', ctx());
    expect(dinamico.entries[0]).toMatchObject({ rotulo: 'selecionar', elemento: 'lista' });
  });

  it('rótulo ignora blocos @if/@else e URLs; id fica curto', () => {
    const r = tagTemplate('<button (click)="ok()">@if (logado) { Li e concordo com os termos de uso e a política de privacidade https://exemplo.invalid/termos }</button>', ctx());
    expect(r.entries[0]!.id).toBe('reembolso-tipo-documento-ok');
    expect(r.entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
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
      'data-at-outputs="reembolso-tipo-documento-voltar|click|#btnVoltar|voltar|voltar|botao;reembolso-tipo-documento-abrir-mapa|click|div.acao.icone|abrir-mapa|icone|botao"',
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
    expect(r.html).toContain('data-at-outputs="reembolso-tipo-documento-tocar|click|:host|tocar|tocar|lista"');
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

  it('duas saídas do mesmo gesto listam só a que o runtime envia, com id estável', () => {
    const agenda = def({ selectors: ['x-agenda'], outputs: new Map([['voltar', 'voltar'], ['abrirInfo', 'abrirInfo']]), template: '<button (click)="voltar.emit(); abrirInfo.emit()">Ações</button>' });
    const agendaCatalog: ComponentCatalog = { get: (tag) => tag === 'x-agenda' ? agenda : catalog.get(tag) };
    const html = '<x-agenda (voltar)="voltar()" (abrirInfo)="info()"></x-agenda>';
    const first = tagTemplate(html, ctx({ catalog: agendaCatalog }));
    const second = tagTemplate(first.html, ctx({ catalog: agendaCatalog, usedIds: new Set(first.entries.map((e) => e.id)) }));
    expect(first.entries.map((e) => e.id)).toEqual(['reembolso-tipo-documento-voltar']);
    expect(second.html).toBe(first.html);
    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
  });

  it('troca atributo gerenciado que é o primeiro da tag sem corromper o nome da tag', () => {
    const old = '<lib-header data-at-outputs="x|click|#btnVoltar|voltar" data-at-owner="mfe-exemplo"\n  (voltar)="voltar()"></lib-header>';
    const r = tagTemplate(old, ctx({ usedIds: new Set(['x']) }));
    expect(r.html.startsWith('<lib-header ')).toBe(true);
    expect(r.html).toContain('data-at-outputs="reembolso-tipo-documento-voltar|click|#btnVoltar|voltar|voltar|botao"');
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

  it('preserva a identidade no mesmo host quando o gesto migra de @Output para click comprovado', () => {
    const component = def({
      selectors: ['demo-button'],
      outputs: new Map([['onClick', 'onClick']]),
      template: '',
      hostListeners: [{ event: 'click', expr: 'this.onClick.emit()' }],
    });
    const selectedCatalog: ComponentCatalog = { get: (tag) => tag === 'demo-button' ? component : catalog.get(tag) };
    const before = tagTemplate('<demo-button (onClick)="salvar()">Salvar</demo-button>', ctx({ mode: 'ref', catalog: selectedCatalog }));
    const previousRef = /data-at-ref="([^"]+)"/.exec(before.html)![1]!;
    const previousId = decodeTrackingToken(previousRef)?.outputs?.[0]?.id;
    expect(previousId).toBeTruthy();
    const modified = before.html.replace('(onClick)="salvar()"', '(click)="salvar()"');
    const after = tagTemplate(modified, ctx({ mode: 'ref', catalog: selectedCatalog, usedIds: new Set([previousId!]) }));
    const nextRef = /data-at-ref="([^"]+)"/.exec(after.html)![1]!;
    expect(decodeTrackingToken(nextRef)?.click?.id).toBe(previousId);
    expect(decodeTrackingToken(nextRef)?.outputs).toBeUndefined();
    expect(tagTemplate(after.html, ctx({ mode: 'ref', catalog: selectedCatalog, usedIds: new Set([previousId!]) })).html).toBe(after.html);
  });

  it('nunca adiciona data-at-ref estático concorrendo com um binding Angular dinâmico', () => {
    const before = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx({ mode: 'ref' }));
    const token = /data-at-ref="([^"]+)"/.exec(before.html)![1]!;
    const manual = '<button [attr.data-at-ref]="x ? ' + "'" + token + "' : null" + ' (click)="salvar()">Salvar</button>';
    const generated = tagTemplate(manual, ctx({ mode: 'ref' }));
    expect(generated.html).toBe(manual);
    expect(generated.html).not.toMatch(/(?:^|\s)data-at-ref="/);
  });

  it('reconcilia token literal anterior no binding sem alterar a condição nem duplicar o evento', () => {
    const old = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx({ mode: 'ref', isScreen: true }));
    const token = /data-at-ref="([^"]+)"/.exec(old.html)![1]!;
    const input = `<button [attr.data-at-ref]="visivel ? '${token}' : null" (click)="salvar()">Salvar</button>`;
    const first = tagTemplate(input, ctx({ mode: 'ref' }));
    expect(first.diagnostics).toEqual([]);
    expect(first.html).toContain('[attr.data-at-ref]="visivel ?');
    expect(first.html).toContain(': null"');
    expect(first.html).not.toMatch(/\sdata-at-ref="/);
    expect(first.entries).toHaveLength(2); // marcador de tela e clique preservados do contrato anterior.
    expect(first.entries.every((entry) => decodeTrackingToken(entry.ref!)?.requireOrigin)).toBe(true);
    expect(tagTemplate(first.html, ctx({ mode: 'ref' })).html).toBe(first.html);
  });

  it('remove referência estática concorrente e preserva binding manual válido sem perder o evento', () => {
    const first = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx({ mode: 'ref' }));
    const ref = /data-at-ref="([^"]+)"/.exec(first.html)![1]!;
    const both = '<button data-at-ref="' + ref + '" [attr.data-at-ref]="\'' + ref + '\'" (click)="salvar()">Salvar</button>';
    const result = tagTemplate(both, ctx({ mode: 'ref' }));
    expect(result.html).not.toMatch(/\\sdata-at-ref="/);
    expect(result.html).toContain('[attr.data-at-ref]');
    expect(result.entries.filter((item) => item.evento === 'click')).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
    const again = tagTemplate(result.html, ctx({ mode: 'ref' }));
    expect(again.html).toBe(result.html);
    expect(again.entries).toEqual(result.entries);
  });

  it('alteração visual não muda o token; alteração do rótulo atualiza propriedade mantendo identidade', () => {
    const first = tagTemplate('<button (click)="salvar()">Salvar</button>', ctx({ mode: 'ref' }));
    const oldRef = /data-at-ref="([^"]+)"/.exec(first.html)![1]!;
    const visual = tagTemplate(first.html.replace('(click)=', 'class="primary" (click)='), ctx({ mode: 'ref' }));
    const visualRef = /data-at-ref="([^"]+)"/.exec(visual.html)![1]!;
    expect(visualRef).toBe(oldRef);
    const newLabel = tagTemplate(visual.html.replace('>Salvar</button>', '>Guardar</button>'), ctx({ mode: 'ref' }));
    const changedRef = /data-at-ref="([^"]+)"/.exec(newLabel.html)![1]!;
    expect(changedRef).not.toBe(oldRef);
    expect(decodeTrackingToken(changedRef)?.click?.id).toBe(decodeTrackingToken(oldRef)?.click?.id);
    expect(decodeTrackingToken(changedRef)?.click?.rotulo).toBe('guardar');
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

describe('tagger: rótulo de texto dinâmico', () => {
  const serviceButton = def({
    selectors: ['bsds-service-button'],
    outputs: new Map([['bsdsClick', 'bsdsClick']]),
    hostListeners: [{ event: 'click', expr: 'onHost()' }],
    methods: new Map([['onHost', 'this.bsdsClick.emit();']]),
  });
  const dsCatalog: ComponentCatalog = { get: (tag) => (tag === 'bsds-service-button' ? serviceButton : undefined) };
  const refCtx = () => ctx({ mode: 'ref', catalog: dsCatalog });
  const tokenOf = (html: string) => decodeTrackingToken(/data-at-ref="([^"]+)"/.exec(html)![1]!)!;

  it('texto vindo de dado do serviço é lido no clique e nunca vira nome técnico do componente', () => {
    const result = tagTemplate(`<bsds-service-button (bsdsClick)="onBtnClick(btn, vm)">{{ btn.label }}<bsds-badge slot="top">{{ btn.badge.label }}</bsds-badge></bsds-service-button>`, refCtx());
    const token = tokenOf(result.html);
    expect(token.rotuloDinamico).toEqual([token.outputs![0]!.id]);
    expect(token.outputs![0]!.label).not.toMatch(/bsds/);
    expect(result.entries.find((entry) => entry.evento === 'click')!.rotulo).toBe('[rotulo-do-botao-exibido]');
  });

  it('expressão com indício de dado pessoal mantém o rótulo semântico e não lê o DOM', () => {
    const result = tagTemplate(`<bsds-service-button (bsdsClick)="selecionarBeneficiario(b)">{{ b.nome }}</bsds-service-button>`, refCtx());
    const token = tokenOf(result.html);
    expect(token.rotuloDinamico).toBeUndefined();
    expect(token.outputs![0]!.label).toBe('selecionar-beneficiario');
  });

  it('texto estático continua no contrato e o token não muda de formato', () => {
    const result = tagTemplate(`<bsds-service-button (bsdsClick)="abrir()">Orientação do reembolso</bsds-service-button>`, refCtx());
    const token = tokenOf(result.html);
    expect(token.rotuloDinamico).toBeUndefined();
    expect(token.outputs![0]!.label).toBe('orientacao-do-reembolso');
  });
});

describe('tagger: rótulo pertence ao gesto, não ao componente', () => {
  it('voltar do header usa a ação, nunca o título da tela', () => {
    const result = tagTemplate(`<lib-header title="Alterar dados de contato" (voltar)="voltar()"></lib-header>`, ctx({ mode: 'ref' }));
    const token = decodeTrackingToken(/data-at-ref="([^"]+)"/.exec(result.html)![1]!)!;
    expect(token.outputs![0]!.label).toBe('voltar');
  });

  it('handler sem nome usa a parte fixa do data-testid concatenado', () => {
    const result = tagTemplate(`<ion-icon name="star" [attr.data-testid]="'icon-star-ranking-' + index" (click)="onCliked()"></ion-icon>`, ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: 'star-ranking' });
  });

  it('conectivo "ao" do handler não entra no rótulo', () => {
    const result = tagTemplate(`<ion-button (click)="aoClicarVoltarPaginaAnterior()"><ion-icon name="arrow-back"></ion-icon></ion-button>`, ctx());
    expect(result.entries[0]).toMatchObject({ rotulo: 'voltar-pagina-anterior' });
  });
});

describe('tagger: título do host como rótulo', () => {
  const dsButton = def({ selectors: ['bsad-button'], outputs: new Map([['onClick', 'onClick']]), template: '<button (click)="onClick.emit()"></button>' });
  const dsHeader = def({ selectors: ['bsds-header'], outputs: new Map([['bsdsBackButtonClick', 'bsdsBackButtonClick']]), hostListeners: [{ event: 'click', expr: 'onHost()' }], methods: new Map([['onHost', 'this.bsdsBackButtonClick.emit();']]) });
  const cat: ComponentCatalog = { get: (tag) => [dsButton, dsHeader].find((d) => d.selectors.includes(tag)) };
  it('botão de biblioteca com title disparado pelo <button> interno mantém o title', () => {
    const result = tagTemplate(`<bsad-button title="Confirmar" (onClick)="confirmarAgendamento()"></bsad-button>`, ctx({ catalog: cat }));
    expect(result.entries[0]).toMatchObject({ rotulo: 'confirmar' });
  });
  it('voltar do bsds-header não usa o título projetado', () => {
    const result = tagTemplate(`<bsds-header (bsdsBackButtonClick)="voltarPaginaAnterior()"><h1>Vacinas</h1></bsds-header>`, ctx({ catalog: cat }));
    expect(result.entries[0]).toMatchObject({ rotulo: 'voltar-pagina-anterior' });
  });

  it('título dinâmico do header nunca vira rótulo do voltar, nem no clique', () => {
    const result = tagTemplate(`<bsds-header (bsdsBackButtonClick)="voltar()"><h1>{{ titulo }}</h1></bsds-header>`, ctx({ catalog: cat, mode: 'ref' }));
    const token = decodeTrackingToken(/data-at-ref="([^"]+)"/.exec(result.html)![1]!)!;
    expect(token.rotuloDinamico).toBeUndefined();
    expect(result.entries[0]).toMatchObject({ rotulo: 'voltar' });
  });

  it('ações distintas do mesmo componente levam o verbo no rótulo; repetir o texto não duplica', () => {
    const acoes = def({
      selectors: ['lib-arquivo'], outputs: new Map([['acaoVisualizar', 'acaoVisualizar'], ['acaoDeletarTodos', 'acaoDeletarTodos']]),
      template: '<button class="ver" (click)="this.acaoVisualizar.emit()">A</button><button class="del" (click)="this.acaoDeletarTodos.emit()">B</button>',
    });
    const c: ComponentCatalog = { get: (tag) => tag === 'lib-arquivo' ? acoes : catalog.get(tag) };
    const multi = tagTemplate('<lib-arquivo title="Arquivo anexado" (acaoVisualizar)="v()" (acaoDeletarTodos)="d()"></lib-arquivo>', ctx({ catalog: c }));
    expect(multi.entries.map((entry) => entry.rotulo)).toEqual(['visualizar-arquivo-anexado', 'deletar-todos-arquivo-anexado']);
    expect(multi.html).toContain('visualizar-arquivo-anexado');
    const sole = tagTemplate('<lib-arquivo title="Arquivo anexado" (acaoVisualizar)="v()"></lib-arquivo>', ctx({ catalog: c }));
    expect(sole.entries.map((entry) => entry.rotulo)).toEqual(['arquivo-anexado']);
  });
});

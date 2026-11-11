/** @jest-environment jsdom */
import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import type { ComponentCatalog, ComponentDef } from '../../src/application/apply/ports/component-catalog.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const catalog: ComponentCatalog = { get: () => undefined };
const ctx = (over: Partial<TagContext> = {}): TagContext => ({
  owner: 'app', relFile: 'src/app/pedidos/anexos/anexos.page.html', funcionalidade: 'pedidos', tela: 'anexos',
  isScreen: false, catalog, usedIds: new Set(), mode: 'ref', ...over,
});
const tokenOf = (html: string) => decodeTrackingToken(/data-at-ref="([^"]+)"/.exec(html)![1]!)!;
const clicks = (html: string, over: Partial<TagContext> = {}) => tagTemplate(html, ctx(over)).entries.filter((entry) => entry.evento === 'click');

/** Componente de biblioteca que exibe o input como texto: `<lib-doc-button [textoLabel]>` → `<ion-label>{{ textoLabel }}</ion-label>`. */
const docButton = (binding: string, extra = '') => `<lib-doc-button [textoLabel]="${binding}" iconeAcao="icon-mais"${extra} (click)="selecionarTipo(doc)"></lib-doc-button>`;

describe('texto do controle vindo de input ligado a dado de runtime', () => {
  it('input composto ligado a variável é rótulo dinâmico: a planilha mostra o padrão e o runtime recebe a expressão exata', () => {
    const result = tagTemplate(docButton('doc.nomeTipoDocumento'), ctx());
    expect(result.entries.map((entry) => entry.rotulo)).toEqual(['[nome-tipo-documento]']);
    expect(result.html).toContain('[attr.data-at-label]="doc.nomeTipoDocumento"');
    expect(tokenOf(result.html).rotuloDinamico).toEqual([result.entries[0]!.id]);
    // Segunda execução não muda nada.
    expect(tagTemplate(result.html, ctx()).html).toBe(result.html);
  });

  it.each([
    ['nome de um tipo do catálogo', 'documento.nomeTipoDocumento', true],
    ['nome qualificado por coisa', 'plano.nomePlano', true],
    ['texto de botão de configuração', 'textos.BOTAO_ENVIAR', true],
    ['nome de especialidade, mesmo vindo do prestador', 'prestador.nomeEspecialidade', true],
    ['nome da pessoa', 'beneficiario.nome', false],
    ['nome da pessoa qualificado por pessoa', 'item.nomePrestador', false],
    ['nome sem qualificador e sem dono conhecido: na dúvida é pessoal', 'select.model.model.id.name', false],
    ['campo qualquer de entidade pessoa', 'usuario.apelido', false],
    ['lista de pessoas', 'beneficiarios[0].nomePlano', false],
    ['valor monetário', 'item.valor', false],
    ['arquivo enviado pela pessoa', 'anexo.nomeArquivo', false],
    ['getter de nome da pessoa', 'getNome()', false],
    ['texto de botão cujo nome contém palavra de pessoa', 'vm.buttons.alterarDadosContato.label', true],
    ['descrição de um endereço', 'endereco.descricao', false],
    ['nome do profissional', 'profissional.nomeProfissional', false],
    ['medida não é rótulo', 'estabelecimento.distanciaAproximada', false],
  ])('%s (%s): dinâmico = %s', (_case, binding, dynamic) => {
    const result = tagTemplate(docButton(binding), ctx());
    expect(/^\[[a-z0-9-]+\]$/.test(result.entries[0]!.rotulo)).toBe(dynamic);
    expect(result.html.includes('data-at-label')).toBe(dynamic);
  });

  it('input simples ligado em componente ([title]) também entrega o valor exato; campo genérico mantém o padrão na planilha', () => {
    const result = tagTemplate('<lib-card [title]="item.titulo" (click)="abrir(item)"></lib-card>', ctx());
    expect(result.html).toContain('[attr.data-at-label]="item.titulo"');
    expect(result.entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
    expect(tagTemplate('<lib-card [title]="textos.BOTAO_ENVIAR" (click)="abrir()"></lib-card>', ctx()).entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
  });

  it.each([
    ['literal é rótulo provado', docButton("'Adicionar arquivo'"), 'adicionar-arquivo'],
    ['dado pessoal nunca é lido', docButton('beneficiario.nome'), 'selecionar-tipo'],
    ['dois gestos: o input composto não nomeia um gesto só', docButton('doc.nome', ' (clickLixeira)="remover(doc)"'), 'selecionar-tipo'],
    ['literal sem texto', docButton('null'), 'selecionar-tipo'],
    ['cabeçalho descreve outro conteúdo', '<lib-doc-button [headerTexto]="doc.nome" (click)="selecionarTipo(doc)"></lib-doc-button>', 'selecionar-tipo'],
  ])('%s: sem leitura de runtime', (_case, html, rotulo) => {
    const result = tagTemplate(html, ctx());
    expect(result.entries.find((entry) => entry.evento === 'click')!.rotulo).toBe(rotulo);
    expect(result.html).not.toContain('data-at-label');
  });

  it('valor escolhido em controle de escolha é opção, nunca rótulo lido em runtime', () => {
    expect(tagTemplate('<lib-select [selectedText]="estadoSelecionado" header="UF" (onChange)="mudarEstado($event)"></lib-select>', ctx()).html).not.toContain('data-at-label');
    expect(tagTemplate('<lib-chip [selectedLabel]="x.nomeTipo" (click)="abrir()"></lib-chip>', ctx()).html).not.toContain('data-at-label');
  });

  it('ternário de literais: as alternativas são provadas, sem leitura de runtime', () => {
    const [entry] = tagTemplate(`<lib-card [title]="form.valid ? 'Avançar' : 'Aceite os termos'" (click)="abrir()"></lib-card>`, ctx()).entries;
    expect(entry!.rotulos).toEqual(['avancar', 'aceite-os-termos']);
  });

  it.each([
    ['chamada', 'buscarLabel(item)'],
    ['booleano', 'estado.isLastSlide'],
    ['item genérico', 'item'],
    ['chave de texto', 'textos.BOTAO_ENVIAR'],
  ])('planilha só nomeia o dado com caminho simples e específico (%s fica no padrão)', (_case, binding) => {
    expect(tagTemplate(`<lib-card [title]="${binding}" (click)="abrir()"></lib-card>`, ctx()).entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
  });

  it('texto interpolado no próprio elemento continua lido do DOM, sem atributo extra', () => {
    const result = tagTemplate('<button (click)="ir()">{{ apiTexto }}</button>', ctx());
    expect(result.entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
    expect(result.html).not.toContain('data-at-label');
  });

  it('atributo antigo sem prova atual é removido', () => {
    const stale = tagTemplate(docButton("'Adicionar arquivo'").replace('<lib-doc-button', '<lib-doc-button [attr.data-at-label]="doc.nome"'), ctx());
    expect(stale.html).not.toContain('data-at-label');
  });
});

describe('texto do host em componente com várias ações', () => {
  const def = (selectors: string[], outputs: string[], template: string, methods: [string, string][]): ComponentDef => ({
    source: 'design-lib', selectors, outputs: new Map(outputs.map((name) => [name, name])), inputs: new Set(['titulo']), template,
    methods: new Map(methods), hostListeners: [],
  });
  const card = def(['lib-card-doc'], ['acaoVisualizar', 'acaoDeletar'],
    '<h3>{{ titulo }}</h3><button class="ver" (click)="ver()">Ver</button><i class="lixeira" (click)="apagar()"></i>',
    [['ver', 'this.acaoVisualizar.emit();'], ['apagar', 'this.acaoDeletar.emit();']]);
  const single = def(['lib-tile'], ['tocar'], '<div class="tile" (click)="tocar.emit()">{{ titulo }}</div>', []);
  const withCatalog = (over: Partial<TagContext> = {}) => ctx({ catalog: { get: (tag) => [card, single].find((item) => item.selectors.includes(tag)) }, ...over });

  it('cada ação interna mantém o próprio nome; o título não vira rótulo de todas', () => {
    const result = tagTemplate('<lib-card-doc [titulo]="doc.nomeTipoDocumento" (acaoVisualizar)="visualizar(doc)" (acaoDeletar)="deletar(doc)"></lib-card-doc>', withCatalog());
    expect(result.entries.map((entry) => entry.rotulo).sort()).toEqual(['deletar', 'visualizar']);
    expect(result.html).not.toContain('data-at-label');
  });

  it('texto projetado nomeia a ação só quando o gatilho exibe o <ng-content>', () => {
    const button = def(['lib-new-button'], ['onClick'], '<button class="btn" (click)="onClick.emit()"><ng-content></ng-content></button>', []);
    const cardEdit = def(['lib-card-edit'], ['edit'], '<div class="card"><ng-content></ng-content><i class="editar" (click)="edit.emit()"></i></div>', []);
    const projected = (over: Partial<TagContext> = {}) => ctx({ catalog: { get: (tag) => [button, cardEdit].find((item) => item.selectors.includes(tag)) }, ...over });
    expect(tagTemplate('<lib-new-button (onClick)="enviar()"><span>{{ textos.labelBotao }}</span></lib-new-button>', projected()).entries[0]!.rotulo).toBe('[rotulo-do-botao-exibido]');
    expect(tagTemplate('<lib-card-edit (edit)="editarDados()"><p>{{ dados.motivoSolicitacao }}</p></lib-card-edit>', projected()).entries[0]!.rotulo).toBe('editar-dados');
  });

  it('única ação do elemento é nomeada pelo texto exibido, e a segunda execução não muda nada', () => {
    const result = tagTemplate('<lib-tile [titulo]="plano.nomePlano" (tocar)="abrir(plano)"></lib-tile>', withCatalog());
    expect(result.entries.map((entry) => entry.rotulo)).toEqual(['[nome-plano]']);
    expect(result.html).toContain('[attr.data-at-label]="plano.nomePlano"');
    expect(tagTemplate(result.html, withCatalog()).html).toBe(result.html);
  });
});

describe('aba do Ionic navega sem handler', () => {
  it('ion-tab-button com tab é clique com o texto da aba', () => {
    const html = `<ion-tabs><ion-tab-bar slot="top">
      <ion-tab-button tab="um"><span class="tab">1 procedimento</span></ion-tab-button>
      <ion-tab-button [tab]="aba"><span class="tab">2 ou mais<br />procedimentos</span></ion-tab-button>
    </ion-tab-bar></ion-tabs>`;
    expect(clicks(html).map((entry) => [entry.rotulo, entry.origem])).toEqual([['1-procedimento', '<ion-tab-button>'], ['2-ou-mais-procedimentos', '<ion-tab-button>']]);
  });

  it('condicional vazio dentro da aba (borda da selecionada) não tira o texto fixo; condicional com texto tira', () => {
    const tab = (extra: string) => clicks(`<ion-tab-button tab="u"><ion-label>Utilização ${extra}</ion-label></ion-tab-button>`)[0]!.rotulo;
    expect(tab('<span *ngIf="sel === \'u\'" class="borda"></span>')).toBe('utilizacao');
    expect(tab('@if (sel) { <span class="borda"></span> }')).toBe('utilizacao');
    expect(tab('<span *ngIf="novo">Novo</span>')).not.toBe('utilizacao');
  });

  it.each([
    ['ion-tab-button sem tab não navega', '<ion-tab-button><span>Início</span></ion-tab-button>'],
    ['atributo tab em outro elemento não é aba', '<div tab="um">Início</div>'],
  ])('%s', (_case, html) => {
    expect(clicks(html)).toEqual([]);
  });

  it('voltar e menu nativos do Ionic agem sem handler: clique com o texto ou com a ação do componente', () => {
    expect(clicks('<ion-buttons><ion-back-button defaultHref="/inicio"></ion-back-button></ion-buttons>').map((entry) => entry.rotulo)).toEqual(['voltar']);
    expect(clicks('<ion-back-button text="Pedidos"></ion-back-button>').map((entry) => entry.rotulo)).toEqual(['pedidos']);
    expect(clicks('<ion-menu-button></ion-menu-button>').map((entry) => entry.rotulo)).toEqual(['abrir-menu']);
    expect(clicks('<ion-menu-toggle><ion-item>Sair</ion-item></ion-menu-toggle>').map((entry) => entry.rotulo)).toEqual(['sair']);
  });

  it('aba com handler próprio gera um único evento', () => {
    expect(clicks('<ion-tab-button tab="um" (click)="trocar()">Resumo</ion-tab-button>').map((entry) => entry.rotulo)).toEqual(['resumo']);
  });
});

describe('runtime envia o valor exibido', () => {
  const run = async (body: string): Promise<TrackingEvent[]> => {
    const sent: TrackingEvent[] = [];
    const tracker = new DomEventTracker(document, { owner: 'app', product: 'loja', schema: examplePreset.schema, mode: 'ref',
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    const stop = tracker.install();
    try {
      document.body.innerHTML = `<app-root><app-page>${body}</app-page></app-root>`;
      tracker.emitScreenView('app-page');
      document.querySelector('[data-click]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return sent.filter((event) => event.name === 'click');
    } finally { stop(); }
  };
  const page = tagTemplate('<h1>Anexos</h1>', ctx({ isScreen: true })).html;
  /** O que o Angular renderiza: o binding vira atributo com o valor atual; o componente desenha o texto e outros dados. */
  const rendered = (value: string) => tagTemplate(docButton('doc.nomeTipoDocumento'), ctx()).html
    .replace('[attr.data-at-label]="doc.nomeTipoDocumento"', `data-at-label="${value}"`)
    .replace(/\s\[textoLabel\]="[^"]*"/, '')
    .replace('></lib-doc-button>', ' data-click><ion-item><ion-label>Ignorado</ion-label></ion-item><span>R$ 120,00</span></lib-doc-button>');

  it('rótulo vem do valor ligado, não do resto do texto do componente', async () => {
    const [click] = await run(page + rendered('Nota fiscal'));
    expect(click!.params['rotulo']).toBe('nota-fiscal');
  });

  it('valor vazio ou com dado pessoal não é enviado', async () => {
    expect(await run(page + rendered(''))).toEqual([]);
    expect(await run(page + rendered('fulano@exemplo.com'))).toEqual([]);
  });

  it('toque no texto da aba envia o rótulo da aba', async () => {
    const tabs = tagTemplate('<ion-tab-bar><ion-tab-button tab="um"><span class="tab">1 procedimento</span></ion-tab-button></ion-tab-bar>', ctx()).html
      .replace('<span class="tab">', '<span class="tab" data-click>');
    const [click] = await run(page + tabs);
    expect(click!.params['rotulo']).toBe('1-procedimento');
  });
});

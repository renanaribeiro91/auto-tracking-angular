import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import type { ComponentCatalog, ComponentDef } from '../../src/application/apply/ports/component-catalog.js';
import { joinLabel, labelSlug, overlayActionLabel, slug } from '../../src/domain/contract/slug.js';
import { subfuncionalidadeOf, screenPath, isStaticScreenReference } from '../../src/domain/contract/screen-binding.js';
import { productLevels } from '../../src/application/apply/pipeline.js';

const def = (over: Partial<ComponentDef> & Pick<ComponentDef, 'selectors'>): ComponentDef => ({
  source: 'projeto', outputs: new Map(), inputs: new Set(), template: '', methods: new Map(), hostListeners: [], ...over,
});

/** Botão de ajuda do projeto: só um "?" e um handler que repassa o @Output. */
const tooltip = def({
  selectors: ['app-tooltip-button'],
  outputs: new Map([['onClick', 'onClick']]),
  template: '<div class="tooltip-button" data-testid="btn-tooltip-button-info" (click)="handleClick()"><strong>?</strong></div>',
  methods: new Map([['handleClick', 'this.onClick.emit();']]),
});
/** Botão do projeto com texto próprio: o filho nomeia o gesto. */
const salvar = def({
  selectors: ['app-salvar'],
  outputs: new Map([['salvar', 'salvar']]),
  template: '<button (click)="salvar.emit()">Salvar rascunho</button>',
});
const catalog: ComponentCatalog = { get: (tag) => [tooltip, salvar].find((item) => item.selectors.includes(tag)) };

const ctx = (over: Partial<TagContext> = {}): TagContext => ({
  owner: 'app', relFile: 'src/app/reembolso/resumo/resumo.page.html', funcionalidade: 'reembolso', tela: 'solicitar:resumo',
  isScreen: false, catalog, usedIds: new Set(), mode: 'ref', ...over,
});

describe('rótulo com visão de produto: nunca termo técnico, nunca repetido', () => {
  it('glifo (X, ?) não é rótulo: o handler nomeia a ação', () => {
    expect(tagTemplate('<div class="close" (click)="fechar()">X</div>', ctx()).entries[0]!.rotulo).toBe('fechar');
  });

  it('estrutura de UI e inglês do código saem do rótulo derivado', () => {
    const rotulo = (html: string) => tagTemplate(html, ctx()).entries[0]!.rotulo;
    expect(rotulo('<ion-icon (click)="mostrarModalDadosBancarios()"></ion-icon>')).toBe('mostrar-dados-bancarios');
    expect(rotulo('<ion-icon (click)="cancelarModal()"></ion-icon>')).toBe('cancelar');
    expect(rotulo('<ion-item (click)="selectionItem(item)"></ion-item>')).toBe('selecionar');
    expect(rotulo('<ion-icon (click)="crop()"></ion-icon>')).toBe('recortar');
    expect(rotulo('<button aria-label="Botão fechar da modal" (click)="x()"></button>')).toBe('fechar');
  });

  it('navegação no começo do método é implementação; no texto visível é o que a pessoa lê', () => {
    const rotulo = (html: string) => tagTemplate(html, ctx()).entries[0]!.rotulo;
    expect(rotulo('<ion-icon (click)="rotaAnexar()"></ion-icon>')).toBe('anexar');
    expect(rotulo('<ion-icon (click)="irParaPagamento()"></ion-icon>')).toBe('pagamento');
    expect(rotulo('<ion-icon (click)="navigateToResumo()"></ion-icon>')).toBe('resumo');
    // Sem destino depois da navegação nada é cortado; no fim do método a palavra é o objeto da ação.
    expect(rotulo('<ion-icon (click)="irPara()"></ion-icon>')).toBe('ir-para');
    expect(rotulo('<ion-icon (click)="tracarRota()"></ion-icon>')).toBe('tracar-rota');
    expect(rotulo('<button (click)="abrirMapa()">Traçar rota</button>')).toBe('tracar-rota');
  });

  it('verbo que pede objeto e perdeu o objeto de UI usa a próxima fonte provada; verbo que se basta fica', () => {
    const rotulo = (html: string) => tagTemplate(html, ctx()).entries[0]!.rotulo;
    expect(rotulo('<ion-card (click)="mostraModal()" data-testid="card-adicionar-exame"><i class="icone"></i></ion-card>')).toBe('adicionar-exame');
    expect(rotulo('<ion-icon (click)="openModal()" data-testid="btn-ver-extrato"></ion-icon>')).toBe('ver-extrato');
    // Sem outra fonte o verbo é o melhor provado; com objeto de negócio o handler já diz tudo.
    expect(rotulo('<ion-icon (click)="abrirModal()"></ion-icon>')).toBe('abrir');
    expect(rotulo('<ion-icon (click)="abrirExtrato()" data-testid="btn-outro"></ion-icon>')).toBe('abrir-extrato');
    expect(rotulo('<ion-icon (click)="fecharModal()" data-testid="btn-detalhes-close"></ion-icon>')).toBe('fechar');
    // Id de teste que só repete o nome do próprio componente não é o objeto da ação.
    expect(rotulo('<ion-icon (click)="onVisualizar()" data-testid="card-resumo-lista"></ion-icon>')).toBe('visualizar');
    expect(rotulo('<ion-icon (click)="abrirModal()" data-testid="btn-resumo-confirmar-envio"></ion-icon>')).toBe('confirmar-envio');
  });

  it('sufixo de código Action no método não chega ao rótulo', () => {
    expect(tagTemplate('<div (click)="removerItemAction()"><i class="icone-lixeira"></i></div>', ctx()).entries[0]!.rotulo).toBe('remover');
  });

  it('gesto interno sem texto que só repassa @Output é um evento no uso, com o handler de negócio', () => {
    const child = tagTemplate(tooltip.template, ctx({ relFile: 'src/app/common/tooltip-button.component.html', self: tooltip }));
    expect(child.entries).toEqual([]);
    const usage = tagTemplate('<app-tooltip-button (onClick)="mostrarModalDadosBancarios()"></app-tooltip-button>', ctx());
    expect(usage.entries.map((entry) => entry.rotulo)).toEqual(['mostrar-dados-bancarios']);
  });

  it('gesto interno com texto próprio continua no filho, com o texto que a pessoa lê', () => {
    const child = tagTemplate(salvar.template, ctx({ relFile: 'src/app/common/salvar.component.html', self: salvar }));
    expect(child.entries.map((entry) => entry.rotulo)).toEqual(['salvar-rascunho']);
    expect(tagTemplate('<app-salvar (salvar)="enviar()"></app-salvar>', ctx()).entries).toEqual([]);
  });

  it('ação + título do overlay sem repetir a emenda', () => {
    expect(overlayActionLabel('excluir', 'excluir-arquivo')).toBe('excluir-arquivo');
    expect(overlayActionLabel('botao-remover-da-modal', 'remover-pais')).toBe('remover-pais');
    expect(overlayActionLabel('ok', 'desculpe')).toBe('ok-desculpe');
    expect(overlayActionLabel('ok-entendi', 'entendi-dados-bancarios')).toBe('ok-entendi-dados-bancarios');
    expect(joinLabel('cancelar', 'cancelar-solicitacao')).toBe('cancelar-solicitacao');
    expect(overlayActionLabel('cancelar-modal', '')).toBe('cancelar');
    expect(overlayActionLabel('crop', '')).toBe('recortar');
    expect(overlayActionLabel('ok-modal', 'atencao')).toBe('ok-atencao');
  });

  it('entidade HTML vira a letra e o corte por tamanho respeita a palavra', () => {
    expect(labelSlug('Remover o hor&aacute;rio')).toBe('remover-o-horario');
    expect(slug('Ver&nbsp;mais &amp; menos')).toBe('ver-mais-menos');
    expect(slug('Os beneficiários agendarão as vacinas em dias e horários diferentes')).toBe('os-beneficiarios-agendarao-as-vacinas-em-dias-e-horarios');
    expect(slug('abcdefghij', 4)).toBe('abcd');
  });
});

describe('escadinha da tela', () => {
  it('subfuncionalidade é o 2º nível; a tela leva o caminho inteiro; na raiz não há subfuncionalidade', () => {
    expect(isStaticScreenReference('reembolso:calcular-reembolso:dados-procedimento')).toBe(true);
    expect(subfuncionalidadeOf('reembolso', 'calcular-reembolso:dados-procedimento')).toBe('calcular-reembolso');
    expect(screenPath('reembolso', 'calcular-reembolso:dados-procedimento')).toBe('reembolso:calcular-reembolso:dados-procedimento');
    expect(subfuncionalidadeOf('menu', 'menu')).toBeUndefined();
    expect(screenPath('menu', 'menu')).toBe('menu');
  });
});

describe('níveis de tela com nome de produto em qualquer projeto', () => {
  // Domínios neutros: cada caso isola uma regra genérica e há casos em que a regra não pode agir.
  it.each([
    ['versão do código sai', ['pedidos', 'checkout-v2', 'pagamento'], ['pedidos', 'checkout', 'pagamento']],
    ['versão com ponto ou sublinhado sai', ['conta', 'perfil_v3'], ['conta', 'perfil']],
    ['pai repetido como prefixo sai, também em dois níveis', ['loja', 'loja-produtos', 'loja-produtos-detalhe'], ['loja', 'produtos', 'detalhe']],
    ['pai como sufixo é o objeto da ação e fica', ['pedidos', 'cancelar-pedidos'], ['pedidos', 'cancelar-pedidos']],
    ['tecnologia sai e nível igual ao pai colapsa', ['ajuda', 'iframe-ajuda'], ['ajuda']],
    ['letra solta do nome de código sai', ['agenda', 'lista-m'], ['agenda', 'lista']],
    ['"tela" no nome sai', ['busca', 'tela-mapa'], ['busca', 'mapa']],
    ['"tela" sozinha é o único nome e fica', ['busca', 'tela'], ['busca', 'tela']],
    ['nível só de estrutura de UI some', ['inicio', 'page', 'destaques'], ['inicio', 'destaques']],
    ['nome de negócio comum não é tocado', ['cadastro', 'dados-pessoais'], ['cadastro', 'dados-pessoais']],
  ])('%s: %j → %j', (_rule, segments, expected) => {
    expect(productLevels(segments)).toEqual(expected);
  });

  it('último nível distinto: o que colapsaria fica com o nome da rota, ainda sem versão; o que não colapsa não muda', () => {
    expect(productLevels(['ajuda', 'iframe-ajuda'], true)).toEqual(['ajuda', 'iframe-ajuda']);
    expect(productLevels(['ajuda', 'iframe-ajuda-v2'], true)).toEqual(['ajuda', 'iframe-ajuda']);
    expect(productLevels(['ajuda', ''], true)).toEqual(['ajuda']);
    expect(productLevels(['pedidos', 'checkout-v2'], true)).toEqual(['pedidos', 'checkout']);
  });
});

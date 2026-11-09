// T16 + T20 + T21 — marcação data-at-* de toda interação declarada no template; idempotente e preservando ajustes manuais
import { START_TAG, TemplateAnalysis } from './template-analysis.js';
import { BACKWARD_ACTION, CHANGE_CONTROL_TAGS, DOM_GESTURES, FORWARD_ACTION, TECHNICAL_EVENT, COMPONENT_NAVIGATION_OUTPUT, PERSONAL_DATA_EXPRESSION, TECHNICAL_LABEL_WORDS, ACTION_VERBS, isInputField, looksLikeIdentifier, BOUND_LABEL_ATTRIBUTES, GENERIC_ELEMENT_LABEL, LABEL_ATTRIBUTES, OPTION_CONTAINER_TAGS, COMPOUND_LABEL_INPUT, INLINE_OVERLAY_KIND, OVERLAY_NAME_NOISE } from './tagger.constants.js';
import type { ComponentCatalog, OutputTrigger } from './ports/component-catalog.js';
import { labelSlug, MAX_PROVEN_LABEL, slug } from '../../domain/contract/slug.js';
import { decodeOutputBindings, type OutputBinding } from '../../domain/contract/output-bindings.js';
import { decodeTrackingToken } from '../../domain/contract/tracking-token.js';
import { encodeTrackingToken } from '../../domain/contract/tracking-token-encoder.js';
import type { TrackingElement } from '../../domain/contract/tracking-element.js';
import type { NumericSelection } from './selection-provenance.js';
import ts from 'typescript';

export interface TagEntry {
  readonly id: string;
  readonly owner: string;
  readonly evento: 'click' | 'screen_view' | 'visualizacao';
  readonly acao: 'clique' | 'visualizacao';
  /** vazio em screen_view */
  readonly elemento: string;
  /** módulo e tela derivados da árvore de componentes do consumidor */
  readonly funcionalidade: string;
  readonly tela: string;
  /** telas (`funcionalidade:tela`) onde a interação acontece; preenchido pelo pipeline */
  readonly telas: readonly string[];
  /** Rota declarada ou tela capturada do owner no gesto/abertura da superfície. */
  readonly vinculo_tela?: 'rota' | 'origem';
  /** rótulo normalizado exatamente como enviado em runtime; vazio apenas em screen_view */
  readonly rotulo: string;
  /** Valor de escolha obtido somente em runtime, quando o gesto publica uma seleção. */
  readonly opcao_selecionada_1?: string;
  /** Rótulos possíveis provados por lista estática do componente; o enviado é o do item clicado. */
  readonly rotulos?: readonly string[];
  /** Nome exibido da aba, só nos cliques de uma tab bar. */
  readonly tab_bar?: string;
  /** binding de origem no template, por exemplo `(click)` ou `(back) em <ui-header>` */
  readonly origem: string;
  readonly arquivo: string;
  readonly linha: number;
  /** Referência do evento completo usada pelo HTML e runtime. */
  readonly ref?: string;
}

export interface TagDiagnostic {
  readonly code: string;
  readonly arquivo: string;
  readonly linha: number;
  readonly mensagem: string;
}

export interface TagContext {
  readonly owner: string;
  /** caminho relativo à raiz do consumidor, usado no relatório */
  readonly relFile: string;
  /** módulo (funcionalidade) e nome da tela/componente do template */
  readonly funcionalidade: string;
  readonly tela: string;
  readonly isScreen: boolean;
  readonly catalog: ComponentCatalog;
  readonly selectionMethods?: ReadonlyMap<string, NumericSelection>;
  /** Valores literais de `propriedade` nos itens de uma lista estática da classe do template. */
  readonly listLabels?: (list: string, property: string) => readonly string[] | null;
  /** Textos que o código comprova para uma expressão do template deste componente. */
  readonly displayTexts?: (expression: string) => readonly string[] | null;
  /** Campos do tipo declarado do item de uma lista da classe; `null` sem prova do tipo. */
  readonly listItemFields?: (list: string) => readonly string[] | null;
  /** ids já usados no projeto; recebe os novos ids gerados */
  readonly usedIds: Set<string>;
  /** Identidades já atribuídas nesta análise, distintas das reservas prévias. */
  readonly claimedIds?: Set<string>;
  /** aspas dos atributos inseridos; em template inline entre aspas duplas usa-se aspas simples */
  readonly attrQuote?: '"' | "'";
  /** linha do início do template no arquivo (template inline em .ts) */
  readonly lineOffset?: number;
  readonly mode?: 'classic' | 'ref';
  /** Componente apresentado como overlay: tipo (`modal`, `popover`) e nome derivado do seletor, sem prefixo/sufixo técnico. */
  readonly overlay?: { readonly elemento: string; readonly nome: string };
}

export interface TagResult {
  readonly html: string;
  readonly entries: TagEntry[];
  readonly diagnostics: TagDiagnostic[];
}

/** Caso de uso que reconcilia marcações e constrói o relatório de um template. */
export class TemplateTagger {
  private readonly analysis = new TemplateAnalysis();

  /** Remove somente metadados de tracking quando o componente deixa de ser alcançado. */
  untagTemplate(html: string): string {
    const removals: { at: number; length: number }[] = [];
    const masked = this.maskComments(html);
    for (const match of masked.matchAll(START_TAG)) {
      for (const name of this.analysis.parseAttrs(match[2] ?? '').keys()) {
        if (!name.startsWith('data-at-') && !name.startsWith('[attr.data-at-')) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attribute = new RegExp(`\\s+${escaped}\\s*=\\s*(["'])[^]*?\\1`).exec(match[0]);
        if (attribute) removals.push({ at: match.index! + attribute.index, length: attribute[0].length });
      }
    }
    let text = html;
    for (const removal of removals.sort((a, b) => b.at - a.at)) text = text.slice(0, removal.at) + text.slice(removal.at + removal.length);
    return text;
  }

  private createEntry(
    fields: Omit<TagEntry, 'owner' | 'funcionalidade' | 'tela' | 'telas' | 'arquivo'>,
    context: TagContext,
    funcionalidade: string,
    tela: string,
  ): TagEntry {
    return {
      ...fields,
      owner: context.owner,
      funcionalidade,
      tela,
      telas: [],
      arquivo: context.relFile,
    };
  }

  private labelBehaviorConflict(label: string, handler: string): boolean {
    const l = slug(label);
    const h = handler.toLowerCase();
    return (BACKWARD_ACTION.test(l) && FORWARD_ACTION.test(h) && !BACKWARD_ACTION.test(h)) || (FORWARD_ACTION.test(l) && BACKWARD_ACTION.test(h) && !FORWARD_ACTION.test(h));
  }

  /** Fim do bloco <ng-template> iniciado em `from`, contando aninhamento */
  private ngTemplateEnd(masked: string, from: number): number {
    const re = /<ng-template\b|<\/ng-template\s*>/g;
    re.lastIndex = from;
    let depth = 0;
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      depth += m[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return m.index + m[0].length;
    }
    return masked.length;
  }

  /** Elemento do contrato (Tagueamento.Elemento) a partir da tag e do nome da interação */
  elementoFor(tag: string, attrs: ReadonlyMap<string, string>, interaction = ''): string {
    const t = `${tag} ${interaction}`.toLowerCase();
    if (/tab-bar|tabbar|ion-tab-button/.test(t)) return 'tab-bar';
    if (/(?:^|[-\s])tabs?(?:-|\s|$)|selectedtab/.test(t)) return 'aba';
    if (tag === 'a' || tag === 'ion-anchor' || attrs.has('routerLink') || attrs.has('[routerLink]') || attrs.has('href') || /link/.test(t)) return 'link';
    if (/select|calendar|datetime|date/.test(t)) return 'dropdown';
    if (/checkbox|toggle|check/.test(t) || (tag === 'input' && attrs.get('type') === 'checkbox')) return 'checkbox';
    if (/accordion/.test(t)) return 'accordion';
    if (/overlay/.test(t)) return 'overlay';
    if (/carousel|carrossel|slide/.test(t)) return 'carrossel';
    if (/upload|arquivo|document/.test(t)) return 'arquivo';
    if (/chip|segment|filtro|filter/.test(t)) return 'filtro';
    if (tag === 'ion-item' || /-item\b|lista|-card\b|card-/.test(t)) return 'lista';
    return 'botao';
  }

  private lineOf(html: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index; i++) if (html.charCodeAt(i) === 10) line++;
    return line;
  }

  /**
   * Rótulo estático legível do elemento, na ordem: atributo acessível humano,
   * texto próprio, rótulo único de um filho e, por último, o identificador
   * técnico sem prefixos. Interpolação não vira rótulo: valores variáveis
   * (nomes, números) não são enviados e o nome da ação é usado no lugar.
   */
  private staticLabel(html: string, tag: string, tagEnd: number, attrs: ReadonlyMap<string, string>): string {
    const human = this.accessibleCandidates(attrs).find((value) => !looksLikeIdentifier(value));
    if (human) return human;
    // Texto interno de controle de escolha são as opções (valor enviado em opcao_selecionada_1), não o nome do controle.
    if (OPTION_CONTAINER_TAGS.has(tag)) return '';
    // conteúdo até o fechamento do próprio elemento, sem tags filhas (ion-label, span, ion-icon)
    const close = html.indexOf(`</${tag}`, tagEnd);
    const inner = html.slice(tagEnd, close === -1 ? html.indexOf('<', tagEnd) : close);
    // Aspas protegem '>' de expressões Angular ([enable]="n > 0") dentro das tags.
    const raw = inner.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ');
    // blocos de controle (@if, @for, @else…) e URLs não são texto visível de negócio
    const text = /\{\{|@(?:if|switch)\b|\*ngIf\b/.test(inner) ? '' : raw
      .replace(/@(else\s+if|if|for|switch|case|default|defer|empty|placeholder|loading|else)\b\s*(\([^)]*\))?/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Em componente customizado o conteúdo é projetado (modal, overlay, card):
    // só um texto curto descreve o gesto; frases longas são conteúdo.
    if (text && (!this.isCustomElement(tag) || text.split(' ').length <= 4)) return text;
    // Wrapper sem texto próprio (div com checkbox, card): rótulo de um único filho.
    const nested = new Set([...inner.matchAll(/\s(?:aria-label|label|title)\s*=\s*(["'])([^"'{}]+)\1/g)]
      .map((match) => match[2]!.trim()).filter((value) => value && !looksLikeIdentifier(value)));
    return nested.size === 1 ? [...nested][0]! : '';
  }

  /**
   * Expressão que produz o texto visível (interpolação ou [label]/[title]/[aria-label]
   * ligado a variável). `null` quando não há expressão ou quando o nome indica dado
   * pessoal/de negócio: nesse caso o texto nunca é lido e o rótulo semântico vale.
   */
  private dynamicLabelSource(html: string, tag: string, tagEnd: number, attrs: ReadonlyMap<string, string>, ctx: TagContext): string | null {
    const bound = BOUND_LABEL_ATTRIBUTES
      .map((name) => attrs.get(name)).filter((value): value is string => !!value?.trim() && this.stringLiteral(value) === undefined && !this.technicalBinding(value, ctx));
    const close = html.indexOf(`</${tag}`, tagEnd);
    const inner = close === -1 || OPTION_CONTAINER_TAGS.has(tag)
      ? '' : html.slice(tagEnd, close).replace(/<!--[\s\S]*?-->/g, ' ');
    const interpolations = [...inner.matchAll(/\{\{\s*([\s\S]+?)\s*\}\}/g)].map((match) => match[1]!.replace(/\s+/g, ' '));
    // Vários textos só em filhos são conteúdo (card, linha de lista); quem nomeia o gesto é a ação.
    if (!bound.length && interpolations.length > 1 && !this.withoutChildren(inner).includes('{{')) return null;
    const expressions = [...bound, ...interpolations];
    if (!expressions.length) return /@(?:if|switch)\b|\*ngIf\b/.test(inner) ? 'conditional-text' : null;
    if (expressions.some((expression) => PERSONAL_DATA_EXPRESSION.test(this.words(expression)))) return null;
    return expressions[0]!;
  }

  /** Escolha de um item repetido: o gesto recebe o próprio item e seu valor público é exibido. */
  private listSelection(html: string, tag: string, tagEnd: number, attrs: ReadonlyMap<string, string>, ctx: TagContext): string | null | undefined {
    const loop = /^\s*let\s+([\w$]+)\s+of\s+(?:this\.)?([\w$]+)\s*(?:[;,]|$)/.exec(attrs.get('*ngFor') ?? '');
    if (!loop) return null;
    const [, item, list] = loop;
    // Qualquer gesto (DOM ou output) que recebe o item, ou um campo dele, escolhe esse item da lista.
    const gestures = [...attrs].filter(([name]) => /^\((?!keydown|keyup|keypress|focus|blur|mouse|touch|pointer|scroll)[\w.]+\)$/.test(name));
    const receives = gestures.filter(([, expression]) => {
      const source = ts.createSourceFile('gesture.ts', expression, ts.ScriptTarget.Latest, true);
      let found = false;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.arguments.some((arg) => {
          let root: ts.Expression = arg;
          while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
          return ts.isIdentifier(root) && root.text === item;
        })) found = true;
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    });
    if (!receives.length) return null;
    const context = this.words([list!, ...receives.map(([, expression]) => this.analysis.handlerName(expression))].join('-'));
    // Plural (`enderecos`, `beneficiarios`) tem o mesmo significado pessoal do singular.
    const personal = (words: string): boolean => PERSONAL_DATA_EXPRESSION.test(words) || PERSONAL_DATA_EXPRESSION.test(words.replace(/s(?=-|$)/g, ''));
    if (personal(context)) return null;
    const close = html.indexOf(`</${tag}`, tagEnd);
    const bound = [...attrs].filter(([name]) => /^\[(?!attr\.data-|ngClass|class|style|ngStyle|id|attr\.id|attr\.data-testid)/.test(name)).map(([, value]) => value);
    const expressions = BOUND_LABEL_ATTRIBUTES.map((name) => attrs.get(name) ?? '')
      .concat(bound, [...html.slice(tagEnd, close < 0 ? tagEnd : close).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1]!));
    let unproven = false;
    for (const expression of expressions) {
      if (new RegExp(`^\\s*${item!.replace(/\$/g, '\\$')}\\s*$`).test(expression)) return item!;
      for (const match of expression.matchAll(/\b([\w$]+)\.([\w$]+)\b/g)) if (match[1] === item) {
        const field = match[2]!;
        const known = ctx.listLabels?.(list!, field);
        if (known?.length || /^(?:label|title|titulo|text|texto|rotulo|descricao|description|nome|name)$/.test(field) && !ctx.listItemFields?.(list!)?.some((name) => /(?:^|-)(?:cpf|rg|nascimento)(?:-|$)/.test(this.words(name)))
          || this.publicItemDescriptor(field, ctx.listItemFields?.(list!))
          || !personal(this.words(field)) && !/^(?:id|uuid|codigo|cod|cd|index|indice|key|chave|value|url|link|icon|icone|imagem|image|img|src|rota|route|path|tipo|type|status|ativo|selecionado|selected|disabled|checked)$/i.test(field)) return `${item}.${field}`;
        unproven = true;
      }
    }
    return unproven ? undefined : null;
  }

  /**
   * `nome<X>` do item descreve algo distinto da pessoa do item somente quando o
   * tipo declara identificador de pessoa física de outro sujeito: em
   * `{ nomePrestador, nomeEspecialidade, cpfPrestador }` só a especialidade é pública.
   */
  private publicItemDescriptor(field: string, typeFields: readonly string[] | null | undefined): boolean {
    const words = this.words(field).split('-');
    if (!typeFields || words.length < 2 || !['nome', 'name', 'descricao', 'description'].includes(words[0]!)) return false;
    const subject = words.slice(1).join('-');
    if (PERSONAL_DATA_EXPRESSION.test(subject) || /(?:^|-)(?:mae|pai|conjuge|responsavel|contato|pessoa|social|completo)(?:-|$)/.test(subject)) return false;
    const people = typeFields.map((name) => this.words(name)).filter((name) => /(?:^|-)(?:cpf|rg|nascimento)(?:-|$)/.test(name));
    return people.length > 0 && people.every((name) => !name.split('-').some((word) => subject.split('-').includes(word)));
  }

  /**
   * Significado legível do valor escolhido: campo específico nomeia a si mesmo
   * (`nomeEspecialidade`); campo genérico (`name`, `titulo`…) recebe o objeto do
   * handler de seleção (`selecionarSala` → `[nome-sala-selecionado]`).
   */
  private optionPlaceholder(field: string, click: string, item: string): string {
    if (!/^(?:name|nome|label|title|titulo|text|texto)$/i.test(field)) return `[${this.words(field)}-selecionado]`;
    // Remove prefixo de evento, o verbo e preposições: `onSelecionarSala`/`irPara` → objeto da ação, ou o próprio item.
    const words = this.words(this.analysis.handlerName(click)).split('-').filter(Boolean);
    if (/^(?:on|ao|handle)$/.test(words[0] ?? '')) words.shift();
    words.shift();
    while (/^(?:para|pra|de|do|da|dos|das|ao|a|o|em|no|na|com|to|for|of)$/.test(words[0] ?? '')) words.shift();
    const noun = words.join('-') || this.words(item);
    return `[nome${noun ? `-${noun}` : ''}-selecionado]`;
  }

  /** `bsdsClick` em <bsds-…>: o prefixo da biblioteca do componente não descreve a ação. */
  private withoutTagPrefix(output: string, tag: string): string {
    const prefix = tag.includes('-') ? tag.split('-')[0]! : '';
    return prefix && output.toLowerCase().startsWith(prefix) ? output.slice(prefix.length) : output;
  }

  /**
   * Rótulo ligado a item de lista (`[title]="botao.titulo"` em `*ngFor`/`@for`
   * sobre lista literal da classe): retorna o conjunto finito de valores
   * provados. Dado de @Input, store ou API não é provável e retorna vazio.
   */
  private provenLabels(masked: string, at: number, html: string, tag: string, tagEnd: number,
    attrs: ReadonlyMap<string, string>, ctx: TagContext): string[] {
    const close = html.indexOf(`</${tag}`, tagEnd);
    const interpolation = close === -1 ? undefined : /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(html.slice(tagEnd, close).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' '))?.[1];
    const expressions = BOUND_LABEL_ATTRIBUTES.map((name) => attrs.get(name)).concat(interpolation);
    for (const expression of expressions) {
      if (!expression) continue;
      const source = ts.createSourceFile('label.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
      const statement = source.statements[0];
      const alternatives = (node: ts.Expression): string[] | null => {
        if (ts.isParenthesizedExpression(node)) return alternatives(node.expression);
        if (ts.isStringLiteralLike(node)) return looksLikeIdentifier(node.text) ? null : [labelSlug(node.text)];
        if (!ts.isConditionalExpression(node)) {
          const root = /^[A-Za-z_$][\w$]*/.exec(node.getText())?.[0];
          // Variável declarada no template não é membro do componente.
          if (!root || new RegExp(`(?:\\blet\\s+|\\bas\\s+|@for\\s*\\(\\s*)${root.replace(/\$/g, '\\$')}\\b`).test(html)) return null;
          const texts = ctx.displayTexts?.(node.getText());
          return texts?.length && !texts.some(looksLikeIdentifier) ? texts.map((text) => labelSlug(text)) : null;
        }
        const yes = alternatives(node.whenTrue), no = alternatives(node.whenFalse);
        return yes && no && yes.length + no.length <= 64 ? [...yes, ...no] : null;
      };
      const labels = statement && ts.isExpressionStatement(statement) ? alternatives(statement.expression) : null;
      if (labels?.length && labels.every(Boolean)) return [...new Set(labels)];
    }
    if (!ctx.listLabels) return [];
    for (const expression of expressions) {
      const reference = expression && /^(?:(["'])(.*?)\1\s*\+\s*)?([A-Za-z_$][\w$]*)\??\.([A-Za-z_$][\w$]*)$/.exec(expression.trim());
      if (!reference) continue;
      const list = this.loopSource(masked.slice(0, at), attrs.get('*ngFor'), reference[3]!);
      const values = list ? ctx.listLabels(list, reference[4]!) : null;
      const labels = [...new Set((values ?? []).map((value) => labelSlug((reference[2] ?? '') + value)).filter(Boolean))];
      if (labels.length) return labels;
    }
    return [];
  }

  /** Lista iterada que declara `variable`: no próprio elemento ou no laço anterior mais próximo. */
  private loopSource(before: string, ownLoop: string | undefined, variable: string): string | null {
    const name = variable.replace(/\$/g, '\\$');
    const own = ownLoop && new RegExp(`^\\s*let\\s+${name}\\s+of\\s+(?:this\\.)?([A-Za-z_$][\\w$]*)\\s*(?:[;,]|$)`).exec(ownLoop);
    if (own) return own[1]!;
    const loops = [...before.matchAll(new RegExp(`(?:\\*ngFor\\s*=\\s*["']\\s*let\\s+${name}\\s+of\\s+|@for\\s*\\(\\s*${name}\\s+of\\s+)(?:this\\.)?([A-Za-z_$][\\w$]*)\\s*[;,"')]`, 'g'))];
    return loops.at(-1)?.[1] ?? null;
  }

  private viewContract(value: string): { id: string; elemento: string; rotulo: string } {
    const [id = '', elemento = '', ...rotulo] = value.split('|');
    return { id, elemento, rotulo: rotulo.join('|') };
  }

  /** Primeiro título do template (h1–h6, ion-title) com texto estático; título interpolado não é provável. */
  private templateTitle(masked: string, from = 0, to = masked.length): string {
    const heading = /<(h[1-6]|ion-title)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(masked.slice(from, to));
    if (!heading || /\{\{|@(?:if|for|switch)\b/.test(heading[2]!)) return '';
    return labelSlug(heading[2]!.replace(/<[^>]*>/g, ' '));
  }

  /** Nome do overlay inline: `header` estático, título do conteúdo ou o gatilho/estado que o abre, sem palavras técnicas. */
  private inlineOverlayName(masked: string, tag: string, tagEnd: number, attrs: ReadonlyMap<string, string>): string {
    const header = attrs.get('header') ?? this.stringLiteral(attrs.get('[header]') ?? '') ?? attrs.get('aria-label');
    if (header?.trim()) return labelSlug(header);
    const close = masked.indexOf(`</${tag}`, tagEnd);
    const title = this.templateTitle(masked, tagEnd, close < 0 ? masked.length : close);
    if (title) return title;
    const source = attrs.get('trigger') ?? attrs.get('[trigger]') ?? attrs.get('[isOpen]') ?? attrs.get('[is-open]') ?? '';
    return this.words(source).split('-').filter((word) => word && !OVERLAY_NAME_NOISE.has(word)).join('-');
  }

  /** aria-label, label e title estáticos ou ligados a literal, na ordem de prioridade. */
  private accessibleCandidates(attrs: ReadonlyMap<string, string>): string[] {
    const literal = (name: string): string | undefined => {
      const bound = attrs.get(`[attr.${name}]`) ?? attrs.get(`[${name}]`);
      return bound === undefined ? undefined : this.stringLiteral(bound);
    };
    const singleGesture = [...attrs.keys()].filter((name) => name.startsWith('(') && !TECHNICAL_EVENT.test(name)).length === 1;
    const compound = !singleGesture ? [] : [...attrs].filter(([name]) => COMPOUND_LABEL_INPUT.test(name.replace(/^\[|\]$/g, '')))
      .map(([name, value]) => (name.startsWith('[') ? this.stringLiteral(value) : value));
    return [...LABEL_ATTRIBUTES.flatMap((name) => [literal(name), attrs.get(name)]), ...compound]
      .filter((value): value is string => !!value?.trim());
  }

  /** `'icon-star-ranking-' + index` → 'icon-star-ranking-': a parte fixa identifica o elemento repetido. */
  private literalPrefix(expression: string): string | undefined {
    const source = ts.createSourceFile('prefix.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
    const statement = source.statements[0];
    let node = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : undefined;
    while (node && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) node = node.left;
    if (node && ts.isStringLiteralLike(node)) return node.text;
    return node && ts.isTemplateExpression(node) ? node.head.text || undefined : undefined;
  }

  private stringLiteral(expression: string): string | undefined {
    const source = ts.createSourceFile('label.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
    const statement = source.statements[0];
    const value = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : undefined;
    return value && ts.isStringLiteralLike(value) ? value.text : undefined;
  }

  /** Identificador sem palavras de código: btnProtocoloCompartilhar → protocolo-compartilhar */
  private semanticWords(value: string): string {
    return this.words(value).split('-').filter((word) => word && !TECHNICAL_LABEL_WORDS.has(word)).join('-');
  }

  /** Conteúdo direto do elemento, sem os filhos e o que há dentro deles. */
  private withoutChildren(inner: string): string {
    const pair = /<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*(?:\/>|>(?:(?!<[a-zA-Z/])[\s\S])*<\/\1\s*>)/g;
    let current = inner;
    for (let previous = ''; previous !== current;) {
      previous = current;
      current = current.replace(pair, ' ');
    }
    return current;
  }

  /** Ligação que só produz identificador de teste (`ids.BTN_X`, `'btn-x-' + i`) não é texto para a pessoa. */
  private technicalBinding(expression: string, ctx: TagContext): boolean {
    const prefix = this.literalPrefix(expression);
    return (!!prefix && looksLikeIdentifier(prefix)) || !!ctx.displayTexts?.(expression)?.every(looksLikeIdentifier);
  }

  /** Método em inglês vira o verbo do negócio; `toggleChange` não repete o `change` técnico. */
  private businessWords(handler: string): string {
    return this.semanticWords(handler).split('-').filter((word, index) => !index || word !== 'change')
      .map((word, index) => (index ? word : ACTION_VERBS.get(word) ?? word)).join('-');
  }

  /** Texto do botão que envia o formulário: é o que a pessoa toca. */
  private submitLabel(html: string, tagEnd: number): string {
    const close = html.indexOf('</form', tagEnd);
    for (const match of html.slice(tagEnd, close === -1 ? undefined : close).matchAll(START_TAG)) {
      const attrs = this.analysis.parseAttrs(match[2] ?? '');
      if (attrs.get('type') !== 'submit' && attrs.get('[type]') !== "'submit'") continue;
      return this.staticLabel(html, match[1]!.toLowerCase(), tagEnd + match.index! + match[0].length, attrs);
    }
    return '';
  }

  /** Nome da ação quando não há texto: handler, depois data-testid e output, sem ruído técnico. */
  private actionName(handler: string, expression: string, ...alternatives: (string | undefined)[]): string {
    const verb = this.businessWords(handler);
    const argument = this.literalArg(expression);
    // editarLocal('local') não repete a palavra já presente no handler.
    const fromHandler = argument && `-${verb}-`.includes(`-${argument}-`) ? verb
      : [verb, argument].filter(Boolean).join('-');
    if (fromHandler && !GENERIC_ELEMENT_LABEL.test(fromHandler)) return fromHandler;
    for (const alternative of alternatives) {
      const name = alternative ? this.semanticWords(alternative) : '';
      if (name && !GENERIC_ELEMENT_LABEL.test(name)) return name;
    }
    return fromHandler;
  }

  /** Identificador técnico já presente no elemento (aria-label de teste ou data-testid). */
  private testId(attrs: ReadonlyMap<string, string>): string | undefined {
    const bound = attrs.get('[attr.data-testid]');
    return this.accessibleCandidates(attrs).find(looksLikeIdentifier)
      ?? attrs.get('data-testid') ?? (bound === undefined ? undefined : this.stringLiteral(bound) ?? this.literalPrefix(bound));
  }

  /** camelCase vira palavras: abrirHistoricoDetalhe → abrir-historico-detalhe */
  words(value: string): string {
    return slug(value.replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
  }

  /** Nome curto e legível para o ID; as primeiras palavras bastam para identificar. */
  private shortName(value: string): string {
    return value.split('-').slice(0, 6).join('-');
  }

  /** Primeiro argumento literal do handler distingue usos do mesmo método. */
  private literalArg(expression: string): string {
    const literal = /\(\s*['"]([^'"]{1,40})['"]/.exec(expression)?.[1] ?? '';
    // URL não é nome de ação: redireciona('http://…') vira apenas "redireciona".
    return /^[a-z][\w+.-]*:\/\//i.test(literal) ? '' : this.words(literal);
  }

  /** Prefixo do ID sem repetir a funcionalidade quando o nome da tela já a contém. */
  private idPrefix(funcionalidade: string, tela: string): string {
    return tela === funcionalidade || tela.startsWith(`${funcionalidade}-`) ? tela : `${funcionalidade}-${tela}`;
  }

  private uniqueId(base: string, used: Set<string>): string {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  }

  private claimId(existing: string | undefined, base: string, ctx: TagContext, claimed: Set<string>): string {
    const id = existing && !claimed.has(existing) ? existing : this.uniqueId(existing || base, ctx.usedIds);
    ctx.usedIds.add(id);
    claimed.add(id);
    return id;
  }

  private maskComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  }

  private isNavigation(attrs: ReadonlyMap<string, string>): boolean {
    const href = attrs.get('href');
    return attrs.has('routerLink') || attrs.has('[routerLink]') || (href !== undefined && href !== '' && href !== '#' && !href.startsWith('javascript:'));
  }

  private isCustomElement(tag: string): boolean {
    return tag.includes('-') && !tag.startsWith('ion-') && !tag.startsWith('ng-');
  }

  /** Campos de digitação não são ações de analytics, mesmo com (click), (change) ou @Output. */
  private isInputField(tag: string): boolean {
    return isInputField(tag);
  }

  /** Codifica os seletores de gesto reconhecidos no elemento host. */
  encodeOutputs(list: readonly { id: string; rotulo: string; output: string; elemento?: string; trigger: OutputTrigger }[]): string {
    return list.map((item) => `${item.id}|${item.trigger.event}|${item.trigger.selector}|${item.rotulo}|${item.output}${item.elemento ? `|${item.elemento}` : ''}`).join(';');
  }

  private asOutputBindings(list: readonly { id: string; rotulo: string; output: string; elemento?: string; trigger: OutputTrigger }[]): OutputBinding[] {
    return list.map((item) => ({ id: item.id, event: item.trigger.event, selector: item.trigger.selector, label: item.rotulo, output: item.output, ...(item.elemento ? { elemento: item.elemento } : {}) }));
  }

  private decodeOutputIds(value: string | undefined): Map<string, string> {
    // Migra v1/v2 preservando sempre o ID publicado do output.
    const map = new Map<string, string>();
    for (const binding of decodeOutputBindings(value)) {
      if (binding.output) map.set(binding.output, binding.id);
    }
    return map;
  }

  tagTemplate(html: string, ctx: TagContext): TagResult {
    const masked = this.maskComments(html);
    const entries: TagEntry[] = [];
    const diagnostics: TagDiagnostic[] = [];
    const inserts: { at: number; text: string }[] = [];
    const removals: { at: number; length: number }[] = [];
    const replacements: { at: number; length: number; text: string }[] = [];
    let screenPlaced = !ctx.isScreen;
    let skipScreenUntil = -1;
    let viewPlaced = !ctx.overlay;
    let skipViewUntil = -1;
    const q = ctx.attrQuote ?? '"';
    const claimed = ctx.claimedIds ?? new Set<string>();
    // O conteúdo projetado é transferido para o ion-modal. O anchor permanece
    // naquele DOM e vincula o clique físico ao owner original, sem adivinhação.
    const portalAnchors = new Map<number, { id: string; rotulo: string; output: string; elemento?: string; trigger: OutputTrigger }[]>();

    for (const m of masked.matchAll(START_TAG)) {
      const tag = m[1]!.toLowerCase();
      const originalAttrs = this.analysis.parseAttrs(m[2] ?? '');
      const attrs = new Map(originalAttrs);
      const dynamicRef = originalAttrs.get('[attr.data-at-ref]');
      // Angular controla integralmente o atributo quando existe binding.
      // Nunca acrescentar uma segunda origem estática: ela pode ser removida
      // ou sobrescrita na detecção de mudanças e criar eventos concorrentes.
      if (ctx.mode === 'ref' && dynamicRef !== undefined) {
        const staticRef = originalAttrs.get('data-at-ref');
        if (staticRef !== undefined) {
          const found = /\s+data-at-ref\s*=\s*(["'])[^"']*\1/.exec(m[0]);
          if (found) removals.push({ at: m.index! + found.index, length: found[0].length });
        }
        // A expressão é código do consumidor: apenas tokens literais podem
        // ser comprovados estaticamente. Não substituir condições de negócio.
        const literals = [...dynamicRef.matchAll(/['"](v1\.[A-Za-z0-9_-]+)['"]/g)].map((item) => item[1]!);
        const contracts = literals.map((literal) => {
          const decoded = decodeTrackingToken(literal);
          const value = decoded && decoded.owner === ctx.owner && !ctx.isScreen ? { ...decoded, requireOrigin: true } : decoded;
          return { literal, token: value ? encodeTrackingToken(value) : literal, value };
        });
        if (contracts.length === 0) {
          // O consumidor controla o valor em runtime, sem token literal que o
          // analisador possa provar. Não inventar evento nem considerar erro.
          continue;
        }
        if (contracts.some(({ value }) => !value || value.owner !== ctx.owner)) {
          diagnostics.push({ code: 'TRACKING_DYNAMIC_REFERENCE_UNVERIFIED', arquivo: ctx.relFile,
            linha: this.lineOf(html, m.index!), mensagem: 'token literal inválido ou de outro owner em binding dinâmico' });
        } else {
          const dynamicAt = m[0].indexOf(dynamicRef, m[0].indexOf('[attr.data-at-ref]'));
          if (dynamicAt >= 0) {
            const updated = new Map(contracts.map(({ literal, token }) => [literal, token]));
            for (const match of dynamicRef.matchAll(/v1\.[A-Za-z0-9_-]+/g)) {
              const token = updated.get(match[0]);
              if (token && token !== match[0]) replacements.push({ at: m.index! + dynamicAt + match.index!, length: match[0].length, text: token });
            }
          }
          const seen = new Map<string, string>();
          for (const { token, value } of contracts) {
            if (!value) continue;
            const line = this.lineOf(html, m.index!) + (ctx.lineOffset ?? 1) - 1;
            const register = (id: string, kind: 'screen_view' | 'click', elemento: string, rotulo: string): void => {
              const semantic = JSON.stringify([value.owner, value.funcionalidade, value.tela, kind, elemento, rotulo]);
              const previous = seen.get(id);
              if (previous !== undefined) {
                if (previous !== semantic) diagnostics.push({ code: 'TRACKING_DYNAMIC_REFERENCE_CONFLICT',
                  arquivo: ctx.relFile, linha: line, mensagem: `mesmo ID '${id}' com contratos dinâmicos incompatíveis` });
                return;
              }
              seen.set(id, semantic);
              if (claimed.has(id)) {
                diagnostics.push({ code: 'TRACKING_DUPLICATE_EVENT_ID', arquivo: ctx.relFile, linha: line,
                  mensagem: `ID '${id}' reutilizado por elementos distintos` });
                return;
              }
              claimed.add(id);
              ctx.usedIds.add(id);
              entries.push(this.createEntry({ id, evento: kind,
                acao: kind === 'screen_view' ? 'visualizacao' : 'clique', elemento, rotulo,
                origem: '[attr.data-at-ref]', linha: line, ref: token },
              ctx, value.funcionalidade, value.tela));
            };
            if (value.screenId) {
              screenPlaced = true;
              register(value.screenId, 'screen_view', '', '');
            }
            if (value.click) register(value.click.id, 'click', value.click.elemento, value.click.rotulo);
            for (const output of [...(value.outputs ?? []), ...(value.overlayOutputs ?? [])]) {
              register(output.id, 'click', output.elemento ?? this.elementoFor(tag, originalAttrs, output.output), output.label);
            }
          }
        }
        continue;
      }
      const priorRef = originalAttrs.get('data-at-ref');
      const prior = ctx.mode === 'ref' && priorRef ? decodeTrackingToken(priorRef) : null;
      if (priorRef && !prior) {
        diagnostics.push({ code: 'TRACKING_REFERENCE_UNKNOWN', arquivo: ctx.relFile, linha: this.lineOf(html, m.index!), mensagem: `data-at-ref ilegível para a lib instalada (outra versão ou edição manual): execute npm install e repita` });
        continue;
      }
      const provenOutputs = prior?.outputs ?? decodeOutputBindings(originalAttrs.get('data-at-outputs'));
      if (provenOutputs.length && this.isCustomElement(tag) && !isInputField(tag) && !ctx.catalog.get(tag)) {
        // Sem a definição não há prova nova nem contrária (instalação incompleta): retirar apagaria eventos já comprovados.
        const linha = this.lineOf(html, m.index!) + (ctx.lineOffset ?? 1) - 1;
        const funcionalidade = prior?.funcionalidade ?? originalAttrs.get('data-at-funcionalidade') ?? ctx.funcionalidade;
        const tela = prior?.tela ?? originalAttrs.get('data-at-tela') ?? ctx.tela;
        diagnostics.push({ code: 'COMPONENT_DEFINITION_MISSING', arquivo: ctx.relFile, linha,
          mensagem: `<${tag}> não foi encontrado nas dependências instaladas; marcação preservada. Confira a instalação (npm ci)` });
        const screenId = prior?.screenId ?? originalAttrs.get('data-at-screen');
        if (screenId) {
          screenPlaced = true;
          entries.push(this.createEntry({ id: this.claimId(screenId, screenId, ctx, claimed), evento: 'screen_view', acao: 'visualizacao', elemento: '', rotulo: '', origem: 'rota', linha, ...(priorRef ? { ref: priorRef } : {}) }, ctx, funcionalidade, tela));
        }
        for (const output of provenOutputs) {
          entries.push(this.createEntry({ id: this.claimId(output.id, output.id, ctx, claimed), evento: 'click', acao: 'clique', elemento: output.elemento ?? this.elementoFor(tag, originalAttrs, output.output),
            rotulo: output.label, ...(prior?.rotulos?.length ? { rotulos: prior.rotulos } : {}), origem: `(${output.output}) em <${tag}>`, linha, ...(priorRef ? { ref: priorRef } : {}) }, ctx, funcionalidade, tela));
        }
        continue;
      }
      // Reconstituir atributos semânticos apenas em memória; o HTML permanece compacto.
      if (prior) {
        attrs.set('data-at-owner', prior.owner);
        attrs.set('data-at-funcionalidade', prior.funcionalidade);
        attrs.set('data-at-tela', prior.tela);
        if (prior.screenId) attrs.set('data-at-screen', prior.screenId);
        if (prior.view) attrs.set('data-at-view', `${prior.view.id}|${prior.view.elemento}|${prior.view.rotulo}`);
        if (prior.click) {
          attrs.set('data-at-id', prior.click.id);
          attrs.set('data-at-event', prior.click.event);
          attrs.set('data-at-elemento', prior.click.elemento);
          attrs.set('data-at-rotulo', prior.click.rotulo);
          if (prior.click.opcaoPermitida) attrs.set('data-at-option-allowed', prior.click.opcaoPermitida);
        }
      }
      // Em componentes compartilhados, atributos já instrumentados são o
      // contrato de identidade existente: não o reescrever por inferências
      // de layout. Para telas roteadas, o resolver usa o código da rota.
      const hasTracking = attrs.has('data-at-id') || attrs.has('data-at-outputs')
        || attrs.has('data-at-overlay-outputs') || attrs.has('data-at-output-ref') || attrs.has('data-at-overlay-ref') || attrs.has('data-at-view') || !!prior;
      const funcionalidade = !ctx.isScreen && hasTracking
        ? attrs.get('data-at-funcionalidade') || ctx.funcionalidade : ctx.funcionalidade;
      const tela = !ctx.isScreen && hasTracking
        ? attrs.get('data-at-tela') || ctx.tela : ctx.tela;
      const prefix = this.idPrefix(funcionalidade, tela);
      const insertAt = m.index! + 1 + m[1]!.length;
      const linha = this.lineOf(html, m.index!) + (ctx.lineOffset ?? 1) - 1;
      const tagEnd = m.index! + m[0].length;
      const desired = new Map<string, string>();
      const entryStart = entries.length;
      /** atributos derivados por inteiro do código: sempre regravados quando divergem */
      const derived = new Set<string>();
      const portalAnchor = portalAnchors.get(m.index!);
      if (portalAnchor?.length) {
        const bindings = this.asOutputBindings(portalAnchor);
        desired.set('data-at-overlay-outputs', this.encodeOutputs(portalAnchor));
        derived.add('data-at-overlay-outputs');
      }

      // ng-container não gera nó; ng-template só renderiza via outlet: o marcador vai no primeiro elemento real sob o host
      if (!screenPlaced && tag === 'ng-template' && !m[0].endsWith('/>')) skipScreenUntil = this.ngTemplateEnd(masked, m.index!);
      if (!screenPlaced && tag !== 'ng-container' && tag !== 'ng-template' && m.index! >= skipScreenUntil) {
        screenPlaced = true;
        const screenId = this.claimId(attrs.get('data-at-screen'), `${prefix}-tela`, ctx, claimed);
        desired.set('data-at-screen', screenId);
        derived.add('data-at-screen');
        entries.push(this.createEntry({ id: screenId, evento: 'screen_view', acao: 'visualizacao', elemento: '', rotulo: '', origem: 'rota', linha }, ctx, funcionalidade, tela));
      }

      // Abertura de overlay: overlay inline do template ou raiz do componente apresentado por código.
      if (!viewPlaced && tag === 'ng-template' && !m[0].endsWith('/>')) skipViewUntil = this.ngTemplateEnd(masked, m.index!);
      const inlineOverlay = INLINE_OVERLAY_KIND[tag];
      const overlayRoot = !viewPlaced && tag !== 'ng-container' && tag !== 'ng-template' && m.index! >= skipViewUntil;
      if (overlayRoot) viewPlaced = true;
      if (inlineOverlay || overlayRoot) {
        const elemento = inlineOverlay ?? ctx.overlay!.elemento;
        const rotulo = (inlineOverlay ? this.inlineOverlayName(masked, tag, tagEnd, attrs) : this.templateTitle(masked)) || ctx.overlay?.nome || '';
        if (!rotulo) {
          // Só o tipo ("modal") não identifica o overlay no painel: sem nome provado não há visualização.
          diagnostics.push({ code: 'OVERLAY_NAME_UNPROVEN', arquivo: ctx.relFile, linha,
            mensagem: `<${tag}> sem header, título estático ou gatilho nomeado: visualizacao não instrumentada; adicione header ou aria-label` });
        } else {
          const viewId = this.claimId(attrs.get('data-at-view')?.split('|')[0], `${prefix}-${this.shortName(rotulo)}-visualizacao`, ctx, claimed);
          desired.set('data-at-view', `${viewId}|${elemento}|${rotulo}`);
          derived.add('data-at-view');
          entries.push(this.createEntry({ id: viewId, evento: 'visualizacao', acao: 'visualizacao', elemento, rotulo,
            origem: inlineOverlay ? `<${tag}>` : 'abertura do overlay', linha }, ctx, funcionalidade, tela));
        }
      }

      const visibleLabel = tag === 'form' && (attrs.has('(ngSubmit)') || attrs.has('(submit)'))
        ? this.submitLabel(html, tagEnd)
        : this.staticLabel(html, tag, tagEnd, attrs);
      const proven = visibleLabel ? [] : this.provenLabels(masked, m.index!, html, tag, tagEnd, attrs, ctx);
      const label = visibleLabel || (proven.length === 1 ? proven[0]! : '');
      const rotulos = proven.length > 1 ? proven : [];
      // Texto de menu/serviço muda sem novo build: o runtime lê o valor visível no clique.
      const boundLabel = BOUND_LABEL_ATTRIBUTES
        .some((name) => attrs.has(name) && this.stringLiteral(attrs.get(name)!) === undefined && !this.technicalBinding(attrs.get(name)!, ctx));
      const dynamicSource = (label && !boundLabel) || proven.length || tag === 'form' ? null : this.dynamicLabelSource(html, tag, tagEnd, attrs, ctx);
      const dynamicIds: string[] = [];
      const selectionSource = this.listSelection(html, tag, tagEnd, attrs, ctx);
      if (selectionSource === undefined) diagnostics.push({ code: 'OPTION_PUBLIC_VALUE_UNPROVEN', arquivo: ctx.relFile, linha,
        mensagem: 'gesto recebe item de lista, mas não há um único rótulo público comprovado; exponha label/title/text no contrato público ou configure a integração do controle' });
      if (selectionSource) {
        desired.set('[attr.data-at-option]', selectionSource);
        derived.add('[attr.data-at-option]');
        const list = /^\s*let\s+[\w$]+\s+of\s+(?:this\.)?([\w$]+)/.exec(attrs.get('*ngFor') ?? '')?.[1];
        const field = selectionSource.split('.')[1];
        const values = list && field ? ctx.listLabels?.(list, field) : null;
        if (values?.length) { desired.set('data-at-option-allowed', values.join('|')); derived.add('data-at-option-allowed'); }
      }
      // Campo público comprovado nomeia o valor; sem ele, o significado genérico.
      const optionSheet = selectionSource ? this.optionPlaceholder(selectionSource.split('.')[1] ?? 'nome', [...attrs].find(([name]) => name.startsWith('('))?.[1] ?? '', selectionSource.split('.')[0]!) : '[valor-selecionado]';
      // Planilha registra o significado do valor dinâmico, nunca a expressão de código.
      const sheetLabel = (rotulo: string, dynamic: boolean): string => dynamic ? '[rotulo-do-botao-exibido]' : rotulo;
      if (rotulos.length && ctx.mode !== 'ref') {
        desired.set('data-at-rotulos', rotulos.join('|'));
        derived.add('data-at-rotulos');
      }
      // Uma tag cujo nome contém 'input' pode ser um controle de digitação
      // ou um componente composto (ex.: chip com ação de remover). Só libera
      // o segundo caso com @Output público e clique DOM comprovado no filho.
      const provenCompositeAction = this.isInputField(tag) && [...attrs].some(([key]) => {
        const name = /^\(([\w.$]+)\)$/.exec(key)?.[1];
        if (!name) return false;
        const component = ctx.catalog.get(tag, name);
        return !!component?.outputs.has(name) && this.analysis.outputTriggers(component, name, ctx.catalog)
          .some((trigger) => trigger.event === 'click' && !trigger.coveredByChild);
      });
      const trackable = !this.isInputField(tag) || provenCompositeAction
        || (tag === 'input' && ['checkbox', 'radio'].includes(attrs.get('type') ?? ''));
      const domBinding = trackable ? DOM_GESTURES.find((b) => attrs.has(b) && (!['(ngSubmit)', '(submit)'].includes(b) || tag === 'form')) : undefined;
      const navigation = trackable && !domBinding && this.isNavigation(attrs);
      if (domBinding || navigation) {
        const expr = domBinding ? attrs.get(domBinding)! : '';
        const handler = domBinding ? this.analysis.handlerName(expr) : 'navegar';
        const selectionInput = domBinding === '(click)' ? ctx.selectionMethods?.get(handler) : undefined;
        if (label && this.labelBehaviorConflict(label, handler)) {
          diagnostics.push({ code: 'VISIBLE_LABEL_BEHAVIOR_CONFLICT', arquivo: ctx.relFile, linha, mensagem: `texto '${label}' contradiz o handler '${handler}'; ação não reclassificada pelo texto` });
        }
        const event = domBinding === '(ngSubmit)' || domBinding === '(submit)' ? 'submit' : domBinding === '(change)' ? 'change' : domBinding === '(ionChange)' || CHANGE_CONTROL_TAGS.has(tag) ? 'ionChange' : 'click';
        const name = this.shortName(slug(label) || this.actionName(handler, expr, this.testId(attrs))) || this.elementoFor(tag, attrs);
        // Mesmo host e mesma ação comprovada podem migrar do @Output do
        // componente para o evento DOM sem criar uma nova identidade "-2".
        const solePriorOutput = prior?.outputs?.length === 1 && !prior.click ? prior.outputs[0] : undefined;
        // Preservar identidade somente com mesma ação E mesmo gesto físico no
        // host. Rótulo igual com seletor interno diferente não prova equivalência.
        const migratedId = solePriorOutput?.event === event && solePriorOutput.selector === ':host' &&
          solePriorOutput.label === (slug(label) || name) ? solePriorOutput.id : undefined;
        const id = this.claimId(attrs.get('data-at-id') ?? migratedId, `${prefix}-${name}`, ctx, claimed);
        const elemento = this.elementoFor(tag, attrs);
        // Ajuste manual de rótulo (modo classic) é preservado só quando legível;
        // valores técnicos gerados antes (on-cliked, btn-…) são regenerados.
        const manual = ctx.mode === 'ref' ? undefined : attrs.get('data-at-rotulo');
        const keepManual = !!manual && this.semanticWords(manual) === manual;
        const rotulo = keepManual ? manual! : slug(label) || name;
        desired.set('data-at-id', id);
        derived.add('data-at-id');
        desired.set('data-at-elemento', elemento);
        desired.set('data-at-rotulo', rotulo);
        if (!keepManual) derived.add('data-at-rotulo');
        if (selectionInput) {
          if (ctx.mode !== 'ref') {
            desired.set('data-at-option', `{{${selectionInput.input}}}`);
            derived.add('data-at-option');
          }
          // O índice dinâmico deve estar observável no aria-label acessível:
          // não inserir interpolações de tracking no HTML do consumidor.
          if (ctx.mode === 'ref' && !attrs.has('[attr.aria-label]')) {
            diagnostics.push({ code: 'OPTION_ACCESSIBLE_SOURCE_MISSING', arquivo: ctx.relFile, linha, mensagem: `ação ${handler} possui opção dinâmica mas não expõe [attr.aria-label] no elemento` });
          }
          desired.set('data-at-option-allowed', selectionInput.allowed.join('|'));
          derived.add('data-at-option-allowed');
        }
        if (event !== 'click') {
          desired.set('data-at-event', event);
          derived.add('data-at-event');
        }
        entries.push(this.createEntry({ id, evento: 'click', acao: 'clique', elemento: attrs.get('data-at-elemento') ?? elemento, rotulo: sheetLabel(rotulo, !!dynamicSource), ...(rotulos.length ? { rotulos } : {}), ...(elemento === 'tab-bar' && label ? { tab_bar: label } : {}), ...(selectionSource || selectionInput || event === 'change' || event === 'ionChange' ? { opcao_selecionada_1: optionSheet } : {}), origem: domBinding ?? 'routerLink', linha }, ctx, funcionalidade, tela));
      }

      // saídas de componentes: (onClick), (voltar), (onChange)... mapeadas até o gesto DOM que as dispara
      if (trackable && this.isCustomElement(tag)) {
        const previous = prior?.outputs;
        const known = this.decodeOutputIds(attrs.get('data-at-outputs'));
        for (const binding of previous ?? []) if (binding.output) known.set(binding.output, binding.id);
        const outputs: { id: string; rotulo: string; output: string; elemento?: string; trigger: OutputTrigger }[] = [];
        for (const [key, expr] of attrs) {
          const output = /^\(([\w.$]+)\)$/.exec(key)?.[1];
          if (!output || (DOM_GESTURES as readonly string[]).includes(key) || TECHNICAL_EVENT.test(output)) continue;
          const def = ctx.catalog.get(tag, output);
          // two-way binding [(x)] gera a saída xChange: sincroniza estado, não é gesto
          if (output.endsWith('Change') && (def?.inputs.has(output.slice(0, -6)) || attrs.has(`[(${output.slice(0, -6)})]`))) continue;
          // Opt-in por evidência: bindings sem @Output público comprovado não
          // representam um gesto suportado. Não gerar evento nem diagnóstico.
          if (!def?.outputs.has(output)) continue;
          if (this.analysis.formValueOutput(def, output, attrs)) continue;
          const all = this.analysis.outputTriggers(def, output, ctx.catalog);
          // No projeto, gestos internos já são marcados no próprio template do filho.
          const triggers: OutputTrigger[] = all.filter((trigger) => !trigger.coveredByChild);
          const overlay = triggers.length === 0 ? this.analysis.modalCloseTrigger(def, output, ctx.catalog) : null;
          if (overlay) triggers.push(overlay);
          if (def.source === 'projeto' && all.length > 0 && triggers.length === 0) continue;
          // @Output declarado não basta: se nenhum gesto DOM foi comprovado,
          // esta interação está fora do suporte comprovado e é ignorada.
          if (triggers.length === 0) continue;
          // Abrir/fechar o mesmo painel é um único gesto de alternância:
          // nunca gerar duas emissões de click no mesmo header.
          const uniqueTriggers = triggers.filter((t) => t.selector !== 'mat-expansion-panel-header'
            || !outputs.some((existing) => existing.trigger.event === t.event && existing.trigger.selector === t.selector));
          if (uniqueTriggers.length === 0) continue;
          // O conteúdo do ng-template deve ter raiz DOM explícita: ela será
          // projetada na modal e servirá de vínculo com este componente/owner.
          const portal = uniqueTriggers.find((trigger) => trigger.portal);
          const projected = portal && /^\s*<([a-z][\w-]*)\b/.exec(masked.slice(tagEnd));
          const anchor = projected ? tagEnd + projected[0].lastIndexOf('<') : -1;
          if (portal && (!projected || ['ng-container', 'ng-template'].includes(projected[1]!)
            || ![...masked.matchAll(START_TAG)].some((node) => node.index === anchor))) {
            // Sem vínculo observável com o overlay, não há tagueamento seguro.
            continue;
          }
          const handler = this.analysis.handlerName(expr);
          // Título/texto do host descreve o conteúdo, não a navegação do próprio
          // componente: voltar/fechar do header usa a ação, nunca o título da tela.
          const navigation = COMPONENT_NAVIGATION_OUTPUT.test(this.words(this.withoutTagPrefix(output, tag)));
          const ownLabel = navigation ? '' : label;
          const dynamicLabel = !!dynamicSource && !navigation;
          const name = this.shortName(slug(ownLabel) || this.actionName(handler, expr, this.testId(attrs), this.withoutTagPrefix(output, tag))) || this.elementoFor(tag, attrs, output);
          const activeOutputs = [...attrs.keys()].filter((attribute) => /^\(([\w.$]+)\)$/.test(attribute) &&
            !(DOM_GESTURES as readonly string[]).includes(attribute) && !TECHNICAL_EVENT.test(attribute));
          // Ações distintas do mesmo componente (ver, excluir) não podem chegar iguais ao Firebase.
          const verb = activeOutputs.length > 1 && ownLabel && !dynamicLabel && !rotulos.length
            ? slug(this.words(this.withoutTagPrefix(output, tag)).replace(/^(?:acao|action|on|handle)-/, '').replace(/^click$/, '').replace(/^[a-z]+/, (word) => ACTION_VERBS.get(word) ?? word)) : '';
          const rotulo = verb && !slug(ownLabel).includes(verb) ? slug(`${verb}-${ownLabel}`, MAX_PROVEN_LABEL) : slug(ownLabel) || name;
          const solePriorOutput = previous?.length === 1 && !prior?.click ? previous[0] : undefined;
          const migratedId = !known.has(output) && activeOutputs.length === 1 &&
            solePriorOutput?.label === rotulo ? solePriorOutput.id : undefined;
          const id = this.claimId(known.get(output) ?? migratedId, `${prefix}-${name}`, ctx, claimed);
          const elemento = this.elementoFor(tag, attrs, output);
          for (const trigger of uniqueTriggers) outputs.push({ id, rotulo, output, elemento, trigger });
          if (portal) {
            const anchored = portalAnchors.get(anchor) ?? [];
            anchored.push({ id, rotulo, output, elemento, trigger: portal });
            portalAnchors.set(anchor, anchored);
          }
          if (dynamicLabel && !dynamicIds.includes(id)) dynamicIds.push(id);
          entries.push(this.createEntry({ id, evento: 'click', acao: 'clique', elemento, rotulo: sheetLabel(rotulo, dynamicLabel), ...(rotulos.length ? { rotulos } : {}), ...(elemento === 'tab-bar' && ownLabel ? { tab_bar: ownLabel } : {}), ...(selectionSource && !navigation || triggers.some((trigger) => trigger.event === 'change' || trigger.event === 'ionChange') ? { opcao_selecionada_1: optionSheet } : {}), origem: `(${output}) em <${tag}>`, linha }, ctx, funcionalidade, tela));
          if (ownLabel && this.labelBehaviorConflict(ownLabel, handler)) {
            diagnostics.push({ code: 'VISIBLE_LABEL_BEHAVIOR_CONFLICT', arquivo: ctx.relFile, linha, mensagem: `texto '${ownLabel}' contradiz o handler '${handler}'; ação não reclassificada pelo texto` });
          }
        }
        // O runtime envia só a primeira saída de cada gesto: saída sem gesto próprio nunca dispara e não pode constar na evidência.
        const firesFirst = (item: { id: string; trigger: OutputTrigger }): boolean => outputs.find((other) => other.trigger.event === item.trigger.event
          && (other.trigger.selector === item.trigger.selector || other.trigger.selector === ':host'))?.id === item.id;
        const silent = new Set(outputs.filter((item) => !outputs.some((other) => other.id === item.id && firesFirst(other))
          && ![...portalAnchors.values()].flat().some((anchored) => anchored.id === item.id)).map((item) => item.id));
        if (silent.size) {
          outputs.splice(0, outputs.length, ...outputs.filter((item) => !silent.has(item.id)));
          entries.splice(0, entries.length, ...entries.filter((item) => !silent.has(item.id)));
        }
        if (outputs.length) {
          desired.set('data-at-outputs', this.encodeOutputs(outputs));
          derived.add('data-at-outputs');
        }
      }

      if (dynamicSource && desired.has('data-at-id')) dynamicIds.unshift(desired.get('data-at-id')!);
      if (dynamicIds.length && ctx.mode !== 'ref') {
        desired.set('data-at-rotulo-dinamico', dynamicIds.join('|'));
        derived.add('data-at-rotulo-dinamico');
      }
      if (desired.size > 0) {
        desired.set('data-at-owner', ctx.owner);
        desired.set('data-at-funcionalidade', funcionalidade);
        desired.set('data-at-tela', tela);
        // Owner, módulo e tela vêm da configuração/estrutura atuais e são reconciliados em cada execução.
        derived.add('data-at-owner');
        derived.add('data-at-funcionalidade');
        derived.add('data-at-tela');
        if (!ctx.isScreen) {
          desired.set('data-at-origin', 'required');
          derived.add('data-at-origin');
        }
      }
      if (ctx.mode === 'ref' && desired.size > 0) {
        const bindings = decodeOutputBindings(desired.get('data-at-outputs'));
        const overlay = decodeOutputBindings(desired.get('data-at-overlay-outputs'));
        const screenId = desired.get('data-at-screen');
        const clickId = desired.get('data-at-id');
        const clickEvent = desired.get('data-at-event') ?? 'click';
        const element: TrackingElement = {
          owner: ctx.owner, funcionalidade, tela,
          ...(!ctx.isScreen ? { requireOrigin: true } : {}),
          ...(screenId ? { screenId } : {}),
          ...(clickId ? { click: { id: clickId, event: clickEvent,
            elemento: desired.get('data-at-elemento') ?? 'botao',
            rotulo: desired.get('data-at-rotulo') ?? '',
            ...(desired.get('data-at-option-allowed') ? { opcaoPermitida: desired.get('data-at-option-allowed')! } : {}),
            ...(selectionSource ? { opcaoFonte: 'public-label' } : desired.get('data-at-option-allowed') && attrs.has('[attr.aria-label]') ? { opcaoFonte: 'aria-label-numero' as const } : {})
          } } : {}),
          ...(bindings.length ? { outputs: bindings } : {}),
          ...(overlay.length ? { overlayOutputs: overlay } : {}),
          ...(rotulos.length && (clickId || bindings.length || overlay.length) ? { rotulos } : {}),
          ...(dynamicIds.length ? { rotuloDinamico: dynamicIds } : {}),
          ...(desired.get('data-at-view') ? { view: this.viewContract(desired.get('data-at-view')!) } : {}),
        };
        const ref = encodeTrackingToken(element);
        for (let index = entryStart; index < entries.length; index++) entries[index] = { ...entries[index]!, ref };
        desired.clear();
        desired.set('data-at-ref', ref);
        derived.clear();
        derived.add('data-at-ref');
        if (selectionSource) { desired.set('[attr.data-at-option]', selectionSource); derived.add('[attr.data-at-option]'); }
      }
      // Opção sem evento comprovado no próprio elemento seria um atributo órfão.
      if (!entries.slice(entryStart).some((entry) => entry.evento === 'click')) {
        for (const name of ['[attr.data-at-option]', 'data-at-option-allowed']) { desired.delete(name); derived.delete(name); }
      }
      // Substitui o output no mesmo lugar: a compactação não deve reordenar
      // os outros atributos da tag nem produzir diffs sem significado.
      const outputReplaced = new Set<string>();
      for (const name of ['data-at-outputs', 'data-at-overlay-outputs', 'data-at-output-ref', 'data-at-overlay-ref', 'data-at-ref']) {
        if (!originalAttrs.has(name) || !desired.has(name) || originalAttrs.get(name) === desired.get(name)) continue;
        const oldAttribute = new RegExp(`(\\s+${name}\\s*=\\s*)(["'])([^"']*)\\2`).exec(m[0]);
        if (!oldAttribute) continue;
        const replacement = `${oldAttribute[1]}${oldAttribute[2]}${desired.get(name)}${oldAttribute[2]}`;
        replacements.push({ at: m.index! + oldAttribute.index, length: oldAttribute[0].length, text: replacement });
        outputReplaced.add(name);
      }
      // obsoleto (sem prova atual) ou derivado divergente: atributos restantes
      // são reconciliados normalmente, preservando valores manuais.
      for (const k of originalAttrs.keys()) {
        if (outputReplaced.has(k)) continue;
        if (!k.startsWith('data-at-') && k !== '[attr.data-at-option]') continue;
        const stale = !desired.has(k) || (derived.has(k) && originalAttrs.get(k) !== desired.get(k));
        if (!stale) continue;
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = new RegExp(`\\s+${escaped}\\s*=\\s*(["'])[^"']*\\1`).exec(m[0]);
        if (found) removals.push({ at: m.index! + found.index, length: found[0].length });
      }
      if (desired.size === 0) continue;
      // valores existentes (inclusive ajustes manuais) são preservados; ausentes e derivados divergentes são gravados
      const missing = [...desired].filter(([k, v]) => !outputReplaced.has(k) && (!originalAttrs.has(k) || (derived.has(k) && originalAttrs.get(k) !== v))).map(([k, v]) => `${k}=${q}${v}${q}`);
      if (missing.length) inserts.push({ at: insertAt, text: ' ' + missing.join(' ') });
    }

    if (!screenPlaced) {
      diagnostics.push({ code: 'SCREEN_MARKER_NOT_PLACEABLE', arquivo: ctx.relFile, linha: ctx.lineOffset ?? 1, mensagem: 'componente roteado sem elemento renderizado fora de <ng-template>; screen_view sem marcador' });
    }

    const edits = [...replacements.map((r) => ({ at: r.at, del: r.length, text: r.text })), ...inserts.map((i) => ({ at: i.at, del: 0, text: i.text })), ...removals.map((r) => ({ at: r.at, del: r.length, text: '' }))]
      // do fim para o início; na mesma posição a remoção vem antes, senão apagaria o texto recém-inserido
      .sort((x, y) => y.at - x.at || y.del - x.del);
    let out = html;
    for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.del);
    return { html: out, entries, diagnostics };
  }
}

const defaultTagger = new TemplateTagger();

/** Entry points mantidos para consumidores existentes; a implementação pertence a TemplateTagger. */
export const elementoFor = (tag: string, attrs: ReadonlyMap<string, string>, interaction = ''): string => defaultTagger.elementoFor(tag, attrs, interaction);
export const words = (value: string): string => defaultTagger.words(value);
export const encodeOutputs = (list: readonly { id: string; rotulo: string; output: string; elemento?: string; trigger: OutputTrigger }[]): string =>
  defaultTagger.encodeOutputs(list);
export const tagTemplate = (html: string, ctx: TagContext): TagResult => defaultTagger.tagTemplate(html, ctx);

// T16 + T20 + T21 — marcação data-at-* de toda interação declarada no template; idempotente e preservando ajustes manuais
import { START_TAG, TemplateAnalysis } from './template-analysis.js';
import { BACKWARD_ACTION, CHANGE_CONTROL_TAGS, DOM_GESTURES, FORWARD_ACTION, TECHNICAL_EVENT, isInputField } from './tagger.constants.js';
import type { ComponentCatalog, OutputTrigger } from './ports/component-catalog.js';
import { slug } from '../../domain/contract/slug.js';
import { decodeOutputBindings, type OutputBinding } from '../../domain/contract/output-bindings.js';
import { encodeTrackingToken, decodeTrackingToken } from '../../domain/contract/tracking-token.js';
import type { TrackingElement } from '../../domain/contract/tracking-element.js';
import type { NumericSelection } from './selection-provenance.js';
import ts from 'typescript';

export interface TagEntry {
  readonly id: string;
  readonly owner: string;
  readonly evento: 'click' | 'screen_view';
  readonly acao: 'clique' | 'visualizacao';
  /** vazio em screen_view */
  readonly elemento: string;
  /** módulo e tela derivados da árvore de componentes do consumidor */
  readonly funcionalidade: string;
  readonly tela: string;
  /** telas (`funcionalidade:tela`) onde a interação acontece; preenchido pelo pipeline */
  readonly telas: readonly string[];
  /** texto estático normalizado, como enviado; vazio quando o texto é dinâmico ou inexistente */
  readonly rotulo: string;
  readonly rotuloDinamico: boolean;
  /** Valor de escolha obtido somente em runtime, quando o gesto publica uma seleção. */
  readonly opcao_selecionada_1?: string;
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
  /** ids já usados no projeto; recebe os novos ids gerados */
  readonly usedIds: Set<string>;
  /** Identidades já atribuídas nesta análise, distintas das reservas prévias. */
  readonly claimedIds?: Set<string>;
  /** aspas dos atributos inseridos; em template inline entre aspas duplas usa-se aspas simples */
  readonly attrQuote?: '"' | "'";
  /** linha do início do template no arquivo (template inline em .ts) */
  readonly lineOffset?: number;
  readonly mode?: 'classic' | 'ref';
}

export interface TagResult {
  readonly html: string;
  readonly entries: TagEntry[];
  readonly diagnostics: TagDiagnostic[];
}

/** Caso de uso que reconcilia marcações e constrói o relatório de um template. */
export class TemplateTagger {
  private readonly analysis = new TemplateAnalysis();

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
    if (tag === 'a' || tag === 'ion-anchor' || attrs.has('routerLink') || attrs.has('[routerLink]') || attrs.has('href') || /link/.test(t)) return 'link';
    if (/select|calendar|datetime|date/.test(t)) return 'dropdown';
    if (/checkbox|toggle|check/.test(t) || (tag === 'input' && attrs.get('type') === 'checkbox')) return 'checkbox';
    if (/accordion/.test(t)) return 'accordion';
    if (/overlay/.test(t)) return 'overlay';
    if (/carousel|carrossel|slide/.test(t)) return 'carrossel';
    if (/upload|arquivo|document/.test(t)) return 'arquivo';
    if (/chip|segment|filtro|filter|tab-bar/.test(t)) return 'filtro';
    if (tag === 'ion-item' || /-item\b|lista|-card\b|card-/.test(t)) return 'lista';
    return 'botao';
  }

  private lineOf(html: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index; i++) if (html.charCodeAt(i) === 10) line++;
    return line;
  }

  /** Texto visível estático do elemento; `dinamico` quando vem de interpolação */
  private staticLabel(html: string, tag: string, tagEnd: number, attrs: ReadonlyMap<string, string>): { text: string; dinamico: boolean } {
    const boundAria = attrs.get('[attr.aria-label]');
    if (boundAria !== undefined) {
      const source = ts.createSourceFile('label.ts', `(${boundAria})`, ts.ScriptTarget.Latest, true);
      const statement = source.statements[0];
      const expression = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : undefined;
      return expression && ts.isStringLiteralLike(expression) ? { text: expression.text, dinamico: false } : { text: '', dinamico: true };
    }
    const aria = attrs.get('aria-label') ?? attrs.get('label') ?? attrs.get('title');
    if (aria) return { text: aria, dinamico: false };
    if (attrs.has('[attr.aria-label]') || attrs.has('[label]') || attrs.has('[title]')) return { text: '', dinamico: true };
    // conteúdo até o fechamento do próprio elemento, sem tags filhas (ion-label, span, ion-icon)
    const close = html.indexOf(`</${tag}`, tagEnd);
    const inner = html.slice(tagEnd, close === -1 ? html.indexOf('<', tagEnd) : close);
    const raw = inner.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');
    if (/\{\{/.test(raw)) return { text: '', dinamico: true };
    // blocos de controle (@if, @for, @else…) e URLs não são texto visível de negócio
    const text = raw
      .replace(/@(else\s+if|if|for|switch|case|default|defer|empty|placeholder|loading|else)\b\s*(\([^)]*\))?/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, dinamico: false };
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
    return this.words(/\(\s*['"]([^'"]{1,40})['"]/.exec(expression)?.[1] ?? '');
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
  encodeOutputs(list: readonly { id: string; rotulo: string; output: string; trigger: OutputTrigger }[]): string {
    return list.map((item) => `${item.id}|${item.trigger.event}|${item.trigger.selector}|${item.rotulo}|${item.output}`).join(';');
  }

  private asOutputBindings(list: readonly { id: string; rotulo: string; output: string; trigger: OutputTrigger }[]): OutputBinding[] {
    return list.map((item) => ({ id: item.id, event: item.trigger.event, selector: item.trigger.selector, label: item.rotulo, output: item.output }));
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
    const q = ctx.attrQuote ?? '"';
    const claimed = ctx.claimedIds ?? new Set<string>();
    // O conteúdo projetado é transferido para o ion-modal. O anchor permanece
    // naquele DOM e vincula o clique físico ao owner original, sem adivinhação.
    const portalAnchors = new Map<number, { id: string; rotulo: string; output: string; trigger: OutputTrigger }[]>();

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
        const contracts = literals.map((token) => ({ token, value: decodeTrackingToken(token) }));
        if (contracts.length === 0) {
          // O consumidor controla o valor em runtime, sem token literal que o
          // analisador possa provar. Não inventar evento nem considerar erro.
          continue;
        }
        if (contracts.some(({ value }) => !value || value.owner !== ctx.owner)) {
          diagnostics.push({ code: 'TRACKING_DYNAMIC_REFERENCE_UNVERIFIED', arquivo: ctx.relFile,
            linha: this.lineOf(html, m.index!), mensagem: 'token literal inválido ou de outro owner em binding dinâmico' });
        } else {
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
                rotuloDinamico: kind === 'click', origem: '[attr.data-at-ref]', linha: line, ref: token },
              ctx, value.funcionalidade, value.tela));
            };
            if (value.screenId) {
              screenPlaced = true;
              register(value.screenId, 'screen_view', '', '');
            }
            if (value.click) register(value.click.id, 'click', value.click.elemento, value.click.rotulo);
            for (const output of [...(value.outputs ?? []), ...(value.overlayOutputs ?? [])]) {
              register(output.id, 'click', this.elementoFor(tag, originalAttrs, output.output), output.label);
            }
          }
        }
        continue;
      }
      const priorRef = originalAttrs.get('data-at-ref');
      const prior = ctx.mode === 'ref' && priorRef ? decodeTrackingToken(priorRef) : null;
      if (priorRef && !prior) {
        diagnostics.push({ code: 'TRACKING_REFERENCE_UNKNOWN', arquivo: ctx.relFile, linha: this.lineOf(html, m.index!), mensagem: `data-at-ref não é um token autocontido válido para o modo escolhido` });
        continue;
      }
      // Reconstituir atributos semânticos apenas em memória; o HTML permanece compacto.
      if (prior) {
        attrs.set('data-at-owner', prior.owner);
        attrs.set('data-at-funcionalidade', prior.funcionalidade);
        attrs.set('data-at-tela', prior.tela);
        if (prior.screenId) attrs.set('data-at-screen', prior.screenId);
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
        || attrs.has('data-at-overlay-outputs') || attrs.has('data-at-output-ref') || attrs.has('data-at-overlay-ref') || !!prior;
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
        entries.push(this.createEntry({ id: screenId, evento: 'screen_view', acao: 'visualizacao', elemento: '', rotulo: '', rotuloDinamico: false, origem: 'rota', linha }, ctx, funcionalidade, tela));
      }

      const label = tag === 'form' && (attrs.has('(ngSubmit)') || attrs.has('(submit)'))
        ? { text: '', dinamico: false }
        : this.staticLabel(html, tag, tagEnd, attrs);
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
      const trackable = !this.isInputField(tag) || provenCompositeAction;
      const domBinding = trackable ? DOM_GESTURES.find((b) => attrs.has(b) && (!['(ngSubmit)', '(submit)'].includes(b) || tag === 'form')) : undefined;
      const navigation = trackable && !domBinding && this.isNavigation(attrs);
      if (domBinding || navigation) {
        const expr = domBinding ? attrs.get(domBinding)! : '';
        const handler = domBinding ? this.analysis.handlerName(expr) : 'navegar';
        const selectionInput = domBinding === '(click)' ? ctx.selectionMethods?.get(handler) : undefined;
        if (label.text && this.labelBehaviorConflict(label.text, handler)) {
          diagnostics.push({ code: 'VISIBLE_LABEL_BEHAVIOR_CONFLICT', arquivo: ctx.relFile, linha, mensagem: `texto '${label.text}' contradiz o handler '${handler}'; ação não reclassificada pelo texto` });
        }
        const event = domBinding === '(ngSubmit)' || domBinding === '(submit)' ? 'submit' : domBinding === '(change)' ? 'change' : domBinding === '(ionChange)' || CHANGE_CONTROL_TAGS.has(tag) ? 'ionChange' : 'click';
        const name = this.shortName(slug(label.text) || [this.words(handler), this.literalArg(expr)].filter(Boolean).join('-')) || tag;
        // Mesmo host e mesma ação comprovada podem migrar do @Output do
        // componente para o evento DOM sem criar uma nova identidade "-2".
        const solePriorOutput = prior?.outputs?.length === 1 && !prior.click ? prior.outputs[0] : undefined;
        // Preservar identidade somente com mesma ação E mesmo gesto físico no
        // host. Rótulo igual com seletor interno diferente não prova equivalência.
        const migratedId = solePriorOutput?.event === event && solePriorOutput.selector === ':host' &&
          solePriorOutput.label === (slug(label.text) || name) ? solePriorOutput.id : undefined;
        const id = this.claimId(attrs.get('data-at-id') ?? migratedId, `${prefix}-${name}`, ctx, claimed);
        const elemento = this.elementoFor(tag, attrs);
        // clique sempre leva rótulo: texto visível no instante do gesto, senão este nome estável
        const rotulo = slug(label.text) || name;
        desired.set('data-at-id', id);
        derived.add('data-at-id');
        desired.set('data-at-elemento', elemento);
        desired.set('data-at-rotulo', rotulo);
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
        entries.push(this.createEntry({ id, evento: 'click', acao: 'clique', elemento: attrs.get('data-at-elemento') ?? elemento, rotulo: label.dinamico ? '' : attrs.has('[attr.aria-label]') ? slug(label.text) || rotulo : attrs.get('data-at-rotulo') ?? rotulo, rotuloDinamico: label.dinamico, ...(selectionInput || event === 'change' || event === 'ionChange' ? { opcao_selecionada_1: 'dinâmica (opção selecionada)' } : {}), origem: domBinding ?? 'routerLink', linha }, ctx, funcionalidade, tela));
      }

      // saídas de componentes: (onClick), (voltar), (onChange)... mapeadas até o gesto DOM que as dispara
      if (trackable && this.isCustomElement(tag)) {
        const previous = prior?.outputs;
        const known = this.decodeOutputIds(attrs.get('data-at-outputs'));
        for (const binding of previous ?? []) if (binding.output) known.set(binding.output, binding.id);
        const outputs: { id: string; rotulo: string; output: string; trigger: OutputTrigger }[] = [];
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
          const name = this.shortName(slug(label.text) || [this.words(handler), this.literalArg(expr)].filter(Boolean).join('-')) || this.words(output);
          const rotulo = slug(label.text) || name;
          const solePriorOutput = previous?.length === 1 && !prior?.click ? previous[0] : undefined;
          const activeOutputs = [...attrs.keys()].filter((attribute) => /^\(([\w.$]+)\)$/.test(attribute) &&
            !(DOM_GESTURES as readonly string[]).includes(attribute) && !TECHNICAL_EVENT.test(attribute));
          const migratedId = !known.has(output) && activeOutputs.length === 1 &&
            solePriorOutput?.label === rotulo ? solePriorOutput.id : undefined;
          const id = this.claimId(known.get(output) ?? migratedId, `${prefix}-${name}`, ctx, claimed);
          for (const trigger of uniqueTriggers) outputs.push({ id, rotulo, output, trigger });
          if (portal) {
            const anchored = portalAnchors.get(anchor) ?? [];
            anchored.push({ id, rotulo, output, trigger: portal });
            portalAnchors.set(anchor, anchored);
          }
          const elemento = this.elementoFor(tag, attrs, output);
          entries.push(this.createEntry({ id, evento: 'click', acao: 'clique', elemento, rotulo: label.dinamico ? '' : rotulo, rotuloDinamico: label.dinamico, ...(triggers.some((trigger) => trigger.event === 'change' || trigger.event === 'ionChange') ? { opcao_selecionada_1: 'dinâmica (opção selecionada)' } : {}), origem: `(${output}) em <${tag}>`, linha }, ctx, funcionalidade, tela));
          if (label.text && this.labelBehaviorConflict(label.text, handler)) {
            diagnostics.push({ code: 'VISIBLE_LABEL_BEHAVIOR_CONFLICT', arquivo: ctx.relFile, linha, mensagem: `texto '${label.text}' contradiz o handler '${handler}'; ação não reclassificada pelo texto` });
          }
        }
        if (outputs.length) {
          desired.set('data-at-outputs', this.encodeOutputs(outputs));
          derived.add('data-at-outputs');
        }
      }

      if (desired.size > 0) {
        desired.set('data-at-owner', ctx.owner);
        desired.set('data-at-funcionalidade', funcionalidade);
        desired.set('data-at-tela', tela);
        // Owner, módulo e tela vêm da configuração/estrutura atuais e são reconciliados em cada execução.
        derived.add('data-at-owner');
        derived.add('data-at-funcionalidade');
        derived.add('data-at-tela');
      }
      if (ctx.mode === 'ref' && desired.size > 0) {
        const bindings = decodeOutputBindings(desired.get('data-at-outputs'));
        const overlay = decodeOutputBindings(desired.get('data-at-overlay-outputs'));
        const screenId = desired.get('data-at-screen');
        const clickId = desired.get('data-at-id');
        const clickEvent = desired.get('data-at-event') ?? 'click';
        const element: TrackingElement = {
          owner: ctx.owner, funcionalidade, tela,
          ...(screenId ? { screenId } : {}),
          ...(clickId ? { click: { id: clickId, event: clickEvent,
            elemento: desired.get('data-at-elemento') ?? 'botao',
            rotulo: label.dinamico ? (attrs.get('data-at-rotulo') ?? desired.get('data-at-rotulo') ?? '') :
              (desired.get('data-at-rotulo') ?? ''),
            ...(desired.get('data-at-option-allowed') ? { opcaoPermitida: desired.get('data-at-option-allowed')! } : {}),
            ...(desired.get('data-at-option-allowed') && attrs.has('[attr.aria-label]') ? { opcaoFonte: 'aria-label-numero' as const } : {})
          } } : {}),
          ...(bindings.length ? { outputs: bindings } : {}),
          ...(overlay.length ? { overlayOutputs: overlay } : {}),
        };
        const ref = encodeTrackingToken(element);
        for (let index = entryStart; index < entries.length; index++) entries[index] = { ...entries[index]!, ref };
        desired.clear();
        desired.set('data-at-ref', ref);
        derived.clear();
        derived.add('data-at-ref');
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
        if (!k.startsWith('data-at-')) continue;
        const stale = !desired.has(k) || (derived.has(k) && originalAttrs.get(k) !== desired.get(k));
        if (!stale) continue;
        const found = new RegExp(`\\s+${k}\\s*=\\s*(["'])[^"']*\\1`).exec(m[0]);
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
export const encodeOutputs = (list: readonly { id: string; rotulo: string; output: string; trigger: OutputTrigger }[]): string =>
  defaultTagger.encodeOutputs(list);
export const tagTemplate = (html: string, ctx: TagContext): TagResult => defaultTagger.tagTemplate(html, ctx);

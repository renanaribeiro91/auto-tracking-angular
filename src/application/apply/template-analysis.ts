import ts from 'typescript';
import type { ComponentCatalog, ComponentDef, ObservableEvent, OutputTrigger } from './ports/component-catalog.js';
import { ATTRIBUTE_PATTERN, OBSERVABLE_EVENTS, START_TAG_PATTERN } from './template-analysis.constants.js';
import { isInputField } from './tagger.constants.js';

export { START_TAG_PATTERN as START_TAG } from './template-analysis.constants.js';

/** Interpreta declarações Angular do template para produzir evidência de interação. */
export class TemplateAnalysis {
  parseAttrs(raw: string): Map<string, string> {
    const attributes = new Map<string, string>();
    for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) attributes.set(match[1]!, match[2] ?? match[3] ?? match[4] ?? '');
    return attributes;
  }

  /** Nome do handler para compor o ID: primeira chamada direta, senão a expressão original. */
  handlerName(expression: string): string {
    const direct = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/.exec(expression)?.[1];
    return direct && direct !== '$any' ? direct : expression.trim();
  }

  /** Localiza emissões que acontecem exclusivamente dentro de callbacks de estado externo. */
  nonGestureReason(component: ComponentDef, publicName: string): 'state' | 'inactive' | null {
    const property = component.outputs.get(publicName);
    if (!property) return null;
    let emitted = 0;
    let withoutStateProof = 0;
    for (const body of component.methods.values()) {
      const source = ts.createSourceFile('emission.ts', `function check() ${body}`, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && (node.expression.name.text === 'emit' || node.expression.name.text === 'next')
          && ts.isPropertyAccessExpression(node.expression.expression)
          && node.expression.expression.name.text === property
          && node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          emitted++;
          if (!this.hasStateOrigin(node)) withoutStateProof++;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (emitted > 0 && withoutStateProof === 0) return 'state';

    // Emissor sem chamada no template ativo, host ou demais métodos não cria
    // uma segunda interação. Referências indiretas mantêm a pendência.
    const live = component.template.replace(/<!--[\s\S]*?-->/g, '');
    const producers = [...component.methods].filter(([, body]) =>
      body.includes(`this.${property}.emit(`) || body.includes(`this.${property}.next(`));
    if (producers.length > 0 && producers.every(([method]) => {
      if (method === 'constructor' || /^ng[A-Z]/.test(method)) return false;
      const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const invocation = new RegExp(`(?:^|[^\\w$])(?:this\\.)?${escaped}\\s*\\(`);
      const reference = new RegExp(`\\b${escaped}\\b`);
      return !invocation.test(live)
        && !component.hostListeners.some(({ expr }) => reference.test(expr))
        && [...component.methods].every(([other, body]) => other === method || !reference.test(body));
    })) return 'inactive';

    // Um evento público de transição não é um clique: o carrossel pode avançar
    // por swipe/autoplay e ion-tabs também muda por navegação programática.
    const stateSources = new Map<string, string[]>([
      ['ion-tabs', ['ionTabsDidChange']],
      ['swiper-container', ['swiperslidechange']],
    ]);
    const escaped = property.replace(/\$/g, '\\$');
    const emitterPattern = new RegExp(`\\b${escaped}\\s*\\.\\s*(emit|next)\\s*\\(`);
    const methods = this.findEmittingMethods(component, emitterPattern);
    let stateBinding = false;
    for (const match of component.template.replace(/<!--[\s\S]*?-->/g, '').matchAll(START_TAG_PATTERN)) {
      const sourceTag = match[1]!.toLowerCase();
      const bindings = this.parseAttrs(match[2] ?? '');
      for (const [key, expression] of bindings) {
        if (!this.expressionEmitsOutput(expression, emitterPattern, methods)) continue;
        const event = /^\((.+)\)$/.exec(key)?.[1];
        if (!event || !stateSources.get(sourceTag)?.includes(event)) return null;
        stateBinding = true;
      }
    }
    return stateBinding ? 'state' : null;
  }

  /** Um @Output não é gesto quando só nasce de store, formulário ou canal externo. */
  private hasStateOrigin(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((!ts.isArrowFunction(parent) && !ts.isFunctionExpression(parent))
        || !ts.isCallExpression(parent.parent)) continue;
      const invocation = parent.parent;
      if (!invocation.arguments.includes(parent) || !ts.isPropertyAccessExpression(invocation.expression)) continue;
      const callee = invocation.expression;
      const origin = callee.expression;
      if (callee.name.text === 'subscribe') {
        if (ts.isPropertyAccessExpression(origin) && origin.name.text === 'valueChanges') return true;
        if (ts.isCallExpression(origin) && ts.isPropertyAccessExpression(origin.expression)
          && origin.expression.name.text === 'select') return true;
      }
      if (callee.name.text === 'bind' && ts.isPropertyAccessExpression(origin)
        && origin.name.text === 'channel' && invocation.arguments[0]
        && ts.isStringLiteralLike(invocation.arguments[0])) return true;
    }
    return false;
  }

  /** Descobre um fechamento de overlay quando a cadeia wrapper → componente →
   *  gesto DOM é verificável; nomes e seletores pertencem ao projeto analisado. */
  modalCloseTrigger(component: ComponentDef, output: string, catalog: ComponentCatalog): OutputTrigger | null {
    const property = component.outputs.get(output);
    if (!property) return null;
    for (const body of component.methods.values()) {
      const componentName = /\bcomponent\s*:\s*([A-Z][\w]*Component)\b/.exec(body)?.[1];
      if (!componentName || !/\.create\s*\(/.test(body) || !/componentProps\s*:/.test(body)
        || !body.includes(`this.${property}.emit(`)
        || !body.includes(`componentProps.${output}.pipe(`)) continue;
      // Nome da classe usado apenas como candidato; o catálogo e a prova do
      // emissor/gesto são obrigatórios para habilitar o rastreamento.
      const selector = componentName.replace(/Component$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      const target = catalog.get(selector, output);
      if (!target?.outputs.has(output)) continue;
      const triggers = this.outputTriggers(target, output, catalog)
        .filter((trigger) => !trigger.coveredByChild && trigger.event === 'click' && trigger.selector !== ':host');
      // Um modal pode emitir o mesmo output por vários botões. Só associar
      // um gesto ao wrapper quando houver um alvo estável e inequívoco,
      // obtido dos atributos públicos do template (id, class, data-testid).
      // Não associar uma tag genérica como <a> a qualquer clique do overlay.
      const stable = triggers.filter((trigger) =>
        /^#[\w-]+$|\[data-testid=[\w-]+\]|^[\w-]+\.[\w.-]+$/.test(trigger.selector));
      if (stable.length !== 1) continue;
      return { ...stable[0]!, portal: 'ion-modal' };
    }
    return null;
  }

  /** Saída de sincronização de um campo de formulário, não ação adicional de negócio. */
  formValueOutput(component: ComponentDef, output: string, attrs: ReadonlyMap<string, string>): boolean {
    const property = component.outputs.get(output);
    if (!property || !attrs.has('formControlName')) return false;
    return [...component.methods.values()].some((body) => {
      if (body.includes('this.modalController.create(')
        && body.includes(`${property}: this.${property}`)
        && body.includes('this.setValue(')) return true;
      if (!body.includes('onWillDismiss(')) return false;
      // Controle que só notifica o valor a partir de setters: o clique abre
      // o editor, mas a emissão do output acontece depois da confirmação.
      const setterMethods = new Set(['setValue', 'adjustValue', 'writeValue']);
      const producers = [...component.methods].filter(([, code]) =>
        code.includes(`this.${property}.emit(`) || code.includes(`this.${property}.next(`));
      if (body.includes('this.setValue(') && producers.length > 0
        && producers.every(([name]) => setterMethods.has(name))) return true;
      const source = ts.createSourceFile('form-value.ts', `function check() ${body}`, ts.ScriptTarget.Latest, true);
      const updates = new Set<string>();
      const emissions = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const call = node.expression;
          const argument = node.arguments[0]?.getText(source);
          if (argument && ts.isIdentifier(node.arguments[0]!)) {
            if (call.name.text === 'setValue' && call.expression.kind === ts.SyntaxKind.ThisKeyword) updates.add(argument);
            if ((call.name.text === 'emit' || call.name.text === 'next')
              && ts.isPropertyAccessExpression(call.expression)
              && call.expression.name.text === property
              && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) emissions.add(argument);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      // Só o mesmo valor confirmado e propagado ao form control é estado.
      return [...updates].some((value) => emissions.has(value));
    });
  }

  /** Resolve gestos DOM que emitem o output, incluindo métodos e componentes aninhados. */
  outputTriggers(component: ComponentDef, publicName: string, catalog: ComponentCatalog, depth = 0): OutputTrigger[] {
    const property = component.outputs.get(publicName) ?? publicName;
    const escapedProperty = property.replace(/\$/g, '\\$');
    const emitPattern = new RegExp(`\\b${escapedProperty}\\s*\\.\\s*(emit|next)\\s*\\(`);
    const emittingMethods = this.findEmittingMethods(component, emitPattern);
    const triggers: OutputTrigger[] = [];

    for (const listener of component.hostListeners) {
      if (!this.expressionEmitsOutput(listener.expr, emitPattern, emittingMethods)) continue;
      this.addTrigger(triggers, listener.event, ':host');
    }

    const template = component.template.replace(/<!--[\s\S]*?-->/g, '');
    for (const match of template.matchAll(START_TAG_PATTERN)) {
      const tag = match[1]!.toLowerCase();
      if (isInputField(tag)) continue;
      const attrs = this.parseAttrs(match[2] ?? '');
      for (const [key, expression] of attrs) {
        const event = /^\((.+)\)$/.exec(key)?.[1];
        if (!event || !this.expressionEmitsOutput(expression, emitPattern, emittingMethods)) continue;
        const sameGesture = (attributes: ReadonlyMap<string, string>) => {
          const handler = attributes.get(`(${event})`);
          return handler !== undefined && this.expressionEmitsOutput(handler, emitPattern, emittingMethods);
        };

        const nested = catalog.get(tag, event);
        if (tag === 'pagination-template' && event === 'pageChange') {
          // ngx-pagination: a mudança pode ocorrer por correção de limites,
          // mas p.previous/next/setCurrent só é gesto quando chamado por (click).
          const apiRef = [...attrs].find(([key, value]) => key.startsWith('#') && value === 'paginationApi')?.[0].slice(1);
          const pageClicks = apiRef && [...template.matchAll(START_TAG_PATTERN)]
            .filter((node) => node[1]!.toLowerCase() === 'a')
            .map((node) => this.parseAttrs(node[2] ?? '').get('(click)') ?? '')
            .filter((handler) => ['previous', 'next', 'setCurrent'].some((method) => handler.includes(`${apiRef}.${method}(`)));
          // Só incluir links ativos: a classe do item de reticências é
          // descoberta no próprio [ngClass] do pacote, não assumida pelo motor.
          const liClasses = [...template.matchAll(START_TAG_PATTERN)]
            .filter((node) => node[1]!.toLowerCase() === 'li')
            .map((node) => this.parseAttrs(node[2] ?? '').get('[ngClass]') ?? '');
          const ellipsisClass = liClasses.map((expr) =>
            /['"]([\w-]+)['"]\s*:\s*page\.label\s*===\s*['"]\.\.\.['"]/.exec(expr)?.[1])
            .find((name) => !!name);
          if (pageClicks && pageClicks.length >= 2 && ellipsisClass) {
            this.addTrigger(triggers, 'click', `li:not(.${ellipsisClass}) > a[tabindex=0]`);
          }
          continue;
        }
        if (tag === 'mat-expansion-panel' && (event === 'opened' || event === 'closed')
          && /<mat-expansion-panel-header\b/.test(template)) {
          // O output do Material é estado, mas o header é o alvo público do clique.
          // Nunca escutar 'opened' como DOM Event: observar apenas o gesto no header.
          this.addTrigger(triggers, 'click', 'mat-expansion-panel-header');
          continue;
        }
        if (tag === 'mat-tab-group' && event === 'selectedTabChange') {
          // As tabs do Material publicam a ação via elementos acessíveis role=tab.
          this.addTrigger(triggers, 'click', 'mat-tab-header [role=tab]');
          continue;
        }
        if (!nested || nested === component || !nested.outputs.has(event) || depth >= 3) {
          // Sem produtor público rastreável, um @Output Angular arbitrário não é
          // um evento DOM. Somente gestos nativos/Ionic conhecidos são prova física.
          const local = component.source === 'projeto';
          const selector = local ? tag : this.stableSelector(tag, attrs, template, match.index!, sameGesture);
          if (selector && OBSERVABLE_EVENTS.has(event) && (event !== 'ngSubmit' || tag === 'form')) this.addTrigger(triggers, event, selector, local);
          continue;
        }

        for (const trigger of this.outputTriggers(nested, event, catalog, depth + 1)) {
          if (component.source === 'projeto') {
            this.addTrigger(triggers, trigger.event, tag, true);
            continue;
          }
          const host = this.stableSelector(tag, attrs, template, match.index!, sameGesture);
          if (host) this.addTrigger(triggers, trigger.event, trigger.selector === ':host' ? host
            : trigger.selector.startsWith(':scope > ') ? `${host} > ${trigger.selector.slice(9)}` : `${host} ${trigger.selector}`);
        }
      }
    }

    return triggers;
  }

  private findEmittingMethods(component: ComponentDef, emitPattern: RegExp): Set<string> {
    const emitting = new Set<string>();
    for (const [name, body] of component.methods) if (emitPattern.test(body)) emitting.add(name);

    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, body] of component.methods) {
        if (emitting.has(name)) continue;
        const callsEmitter = [...emitting].some((emitter) =>
          new RegExp(`\\bthis\\.${emitter.replace(/\$/g, '\\$')}\\s*\\(`).test(body),
        );
        if (!callsEmitter) continue;
        emitting.add(name);
        changed = true;
      }
    }
    return emitting;
  }

  private expressionEmitsOutput(expression: string, emitPattern: RegExp, methods: ReadonlySet<string>): boolean {
    if (emitPattern.test(expression)) return true;
    for (const method of methods) {
      const call = new RegExp(`(^|[^.\\w$])(this\\.)?${method.replace(/\$/g, '\\$')}\\s*\\(`);
      if (call.test(expression)) return true;
    }
    return false;
  }

  private addTrigger(triggers: OutputTrigger[], event: string, selector: string, coveredByChild = false): void {
    if (event === 'ngSubmit') event = 'submit';
    if (!/^[A-Za-z][\w:-]*$/.test(event) || triggers.some((item) => item.event === event && item.selector === selector)) return;
    triggers.push({ event: event as ObservableEvent, selector, ...(coveredByChild ? { coveredByChild: true } : {}) });
  }

  /** Seletor CSS estável de um elemento interno: id, classes ou data-testid estáticos. */
  private stableSelector(tag: string, attrs: ReadonlyMap<string, string>, template: string, offset: number, sameGesture: (attributes: ReadonlyMap<string, string>) => boolean): string | null {
    const elements = [...template.matchAll(START_TAG_PATTERN)];
    const sameTag = elements.filter((node) => node[1]!.toLowerCase() === tag);
    const matching = (test: (attributes: ReadonlyMap<string, string>) => boolean) => {
      const matches = sameTag.map((node) => this.parseAttrs(node[2] ?? '')).filter(test);
      return matches.length > 0 && matches.every(sameGesture);
    };
    const id = attrs.get('id');
    if (id && /^[A-Za-z][\w-]*$/.test(id) && elements.filter((node) => this.parseAttrs(node[2] ?? '').get('id') === id).length === 1) return `#${id}`;

    const classes = (attrs.get('class') ?? '').split(/\s+/).filter((name) => /^[A-Za-z_-][\w-]*$/.test(name));
    if (classes.length > 0 && matching((a) => classes.every((name) => (a.get('class') ?? '').split(/\s+/).includes(name)))) return `${tag}.${classes.join('.')}`;

    const testId = attrs.get('data-testid');
    if (testId && /^[\w-]+$/.test(testId) && matching((a) => a.get('data-testid') === testId)) return `${tag}[data-testid=${testId}]`;
    if (matching(() => true)) return tag;
    // Um handler no elemento raiz não deve coincidir com descendentes da mesma
    // tag, inclusive conteúdo dinâmico. A relação com o host é verificável.
    const tokens = [
      ...elements.map((node) => ({ at: node.index!, tag: node[1]!.toLowerCase(), close: false, raw: node[0] })),
      ...[...template.matchAll(/<\/([a-zA-Z][\w-]*)\s*>/g)].map((node) => ({ at: node.index!, tag: node[1]!.toLowerCase(), close: true, raw: node[0] })),
    ].sort((a, b) => a.at - b.at);
    const stack: string[] = [];
    const roots = new Set<number>();
    for (const token of tokens) {
      if (token.close) {
        if (stack[stack.length - 1] !== token.tag) { roots.clear(); break; }
        stack.pop();
      } else {
        if (stack.length === 0) roots.add(token.at);
        if (!/\/>$/.test(token.raw) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(token.tag)) stack.push(token.tag);
      }
    }
    const rootPeers = sameTag.filter((node) => roots.has(node.index!));
    if (stack.length === 0 && roots.has(offset) && rootPeers.every((node) => sameGesture(this.parseAttrs(node[2] ?? '')))) return `:scope > ${tag}`;
    // Posição só é prova quando todos os elementos são irmãos estáticos.
    // Em árvores condicionais/repetidas, nunca escolher o primeiro botão por acaso.
    const flat = !/\*|@(?:if|for|switch|defer)|\{\{|\[/.test(template) && elements.every((node, i) => {
      const end = node.index! + node[0].length;
      const rest = template.slice(end, elements[i + 1]?.index ?? template.length);
      return new RegExp(`^[^<]*</${node[1]}\\s*>\\s*$`).test(rest);
    });
    if (!flat) return null;
    return `${tag}:nth-of-type(${sameTag.findIndex((node) => node.index === offset) + 1})`;
  }
}

// T09–T14 — emissão runtime: gesto DOM → elemento marcado → owner → tela atual → schema → send
import { validateEvent, type TrackingSchema } from '../../domain/contract/schema.js';
import { labelSlug, slug } from '../../domain/contract/slug.js';
import { decodeOutputBindings, type OutputBinding } from '../../domain/contract/output-bindings.js';
import type { TrackingElement } from '../../domain/contract/tracking-element.js';
import { TrackingTokenCache } from '../../domain/contract/tracking-token.js';
import type { TrackingMode } from '../../config.js';
import type { TrackingEvent } from '../../config.js';
import { CURRENT_SCREEN_ATTRIBUTE, INTERACTIVE_ELEMENT_SELECTOR, TRACKED_DOM_EVENTS } from './dom-tracker.constants.js';
import { DomDiscoveryScheduler } from './dom-discovery-scheduler.js';

export interface DomTrackerDeps {
  /** Host Angular opcional; limita a varredura inicial sem restringir overlays. */
  readonly root?: string;
  readonly owner: string;
  readonly product: string;
  readonly schema: TrackingSchema;
  readonly mode?: TrackingMode;
  resolveEnvironment(): Promise<string | null>;
  send(event: TrackingEvent): void | Promise<void>;
  warn(message: string): void;
}

type Params = Record<string, string>;
interface Screen {
  readonly funcionalidade: string;
  readonly tela: string;
}
interface Hit {
  readonly id: string;
  /** elemento cujo texto vira o rótulo */
  readonly labelSource: Element;
  /** rótulo estável gravado pelo CLI, usado quando o elemento não tem texto visível */
  readonly fallbackLabel: string;
  readonly host: Element;
  readonly descriptor?: TrackingElement;
}

/** Mantém a emissão de gestos vinculada ao documento e ao owner durante seu lifecycle. */
export class DomEventTracker {
  private static readonly tokens = new TrackingTokenCache();
  private active = true;
  constructor(private readonly document: Document, private readonly deps: DomTrackerDeps) {}

  /** Falhas são observáveis, mas nunca podem interromper o gesto de negócio. */
  private warnSafely(message: string): void {
    try { this.deps.warn(message); }
    catch (error) {
      // Se o callback de diagnóstico falhar, preservar o erro no console.
      // Não transformar erro de logging em erro do fluxo da aplicação.
      try { console.error('[auto-tracking] reporter de erro falhou:', message, error); }
      catch { /* console indisponível no host; sem exceção no evento de negócio. */ }
    }
  }

  install(): () => void {
    // Angular Universal/SSR pode injetar um Document sem árvore renderizada.
    // Não existe DOM para observar nem eventos de usuário a interceptar.
    const documentRoot = this.document.documentElement;
    if (!documentRoot) return () => {};
    const handled = new WeakSet<Event>();
    const onEvent = (event: Event): void => {
      try {
        if (handled.has(event)) return;
        const hit = DomEventTracker.resolveHit(event, this.deps.mode ?? 'classic');
        if (!hit || (hit.descriptor?.owner ?? hit.host.getAttribute('data-at-owner')) !== this.deps.owner) return;
        handled.add(event);
        this.emitClick(event, hit);
      } catch (error) {
        this.warnSafely(`[auto-tracking] evento ignorado com segurança: ${String(error)}`);
      }
    };

    const registered = new Set<string>();
    const listen = (name: string): void => {
      if (!/^[A-Za-z][\w:-]*$/.test(name) || registered.has(name)) return;
      this.document.addEventListener(name, onEvent, true);
      registered.add(name);
    };
    const discover = (element: Element): void => {
      const mode = this.deps.mode ?? 'classic';
      // Em um documento grande, a grande maioria dos elementos não participa
      // do tracking. Não tentar descompactar tokens nesses elementos.
      if (mode === 'ref') {
        if (!element.hasAttribute('data-at-ref')) return;
      } else if (!element.hasAttribute('data-at-event') && !element.hasAttribute('data-at-outputs') &&
        !element.hasAttribute('data-at-overlay-outputs') && !element.hasAttribute('data-at-output-ref')) return;
      const descriptor = DomEventTracker.descriptorOf(element, mode);
      if ((descriptor?.owner ?? element.getAttribute('data-at-owner')) !== this.deps.owner) return;
      const current = mode !== 'ref' ? element.getAttribute('data-at-event') : null;
      if (current) listen(current);
      if (descriptor?.click) listen(descriptor.click.event);
      for (const output of DomEventTracker.outputsFor(element, mode)) listen(output.event);
    };

    const scheduler = new DomDiscoveryScheduler(this.document, discover,
      (error) => this.warnSafely(`[auto-tracking] descoberta de marcador falhou: ${String(error)}`));
    const Observer = this.document.defaultView?.MutationObserver;
    const observer = Observer ? new Observer((records) => {
      try {
        for (const record of records) {
          if (record.type === 'attributes' && DomEventTracker.isElement(record.target)) {
            scheduler.changed(record.target);
          }
          for (const node of Array.from(record.addedNodes)) {
            if (DomEventTracker.isElement(node)) scheduler.added(node);
          }
        }
      } catch (error) {
        this.warnSafely(`[auto-tracking] observação de DOM falhou: ${String(error)}`);
      }
    }) : null;
    const stop = (): void => {
      this.active = false;
      observer?.disconnect();
      scheduler.stop();
      for (const eventName of registered) this.document.removeEventListener(eventName, onEvent, true);
      registered.clear();
    };
    try {
      // Gestos DOM principais precisam funcionar imediatamente; descoberta
      // de CustomEvents é incremental, não uma varredura bloqueante.
      TRACKED_DOM_EVENTS.forEach(listen);
      let initialRoot = documentRoot;
      if (this.deps.root) {
        try { initialRoot = this.document.querySelector(this.deps.root) ?? documentRoot; }
        catch (error) { this.warnSafely(`[auto-tracking] seletor raiz inválido: ${String(error)}`); }
      }
      scheduler.start(initialRoot);
      // Observação global continua necessária para overlays teleportados.
      observer?.observe(documentRoot, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-at-event', 'data-at-outputs', 'data-at-overlay-outputs',
          'data-at-output-ref', 'data-at-ref', 'data-at-owner'],
      });
    } catch (error) {
      stop();
      this.warnSafely(`[auto-tracking] instalação falhou: ${String(error)}`);
    }
    return stop;
  }

  /** Registra a tela atual e emite screen_view se o marcador pertence a este owner. */
  emitScreenView(hostSelector: string): boolean {
    if (!this.active) return false;
    const marker = DomEventTracker.findScreenMarker(this.document, hostSelector, this.deps.mode ?? 'classic');
    if (!marker) return false;

    const descriptor = DomEventTracker.descriptorOf(marker, this.deps.mode ?? 'classic');
    const screen = descriptor ? { funcionalidade: descriptor.funcionalidade, tela: descriptor.tela } : DomEventTracker.markerScreen(marker);
    if (!screen || (descriptor?.owner ?? marker.getAttribute('data-at-owner')) !== this.deps.owner) return true;
    this.document.documentElement.setAttribute(CURRENT_SCREEN_ATTRIBUTE, `${screen.funcionalidade}|${screen.tela}`);

    const screenId = descriptor?.screenId ?? marker.getAttribute('data-at-screen')!;
    void this.dispatch('screen_view', (environment, product) => DomEventTracker.baseParams(screen, environment, product), screenId)
      .catch((error) => this.warnSafely(`[auto-tracking] falha no envio: ${String(error)}`));
    return true;
  }

  /** Primeiro elemento marcado no caminho do evento, por ID ou output mapeado. */
  private static descriptorOf(element: Element, mode: TrackingMode): TrackingElement | undefined {
    if (mode !== 'ref') return undefined;
    const ref = element.getAttribute('data-at-ref');
    return ref ? this.tokens.resolve(ref) ?? undefined : undefined;
  }

  private static outputsFor(element: Element, mode: TrackingMode): OutputBinding[] {
    const descriptor = this.descriptorOf(element, mode);
    if (descriptor) return [...(descriptor.outputs ?? []), ...(descriptor.overlayOutputs ?? [])];
    return mode === 'classic' ? decodeOutputBindings(element.getAttribute('data-at-outputs') ?? element.getAttribute('data-at-overlay-outputs')) : [];
  }

  static resolveHit(event: Event, mode: TrackingMode = 'classic'): Hit | null {
    const eventPath = this.elementsOf(event);
    for (let index = 0; index < eventPath.length; index++) {
      const element = eventPath[index]!;
      const descriptor = this.descriptorOf(element, mode);
      const bindings = this.outputsFor(element, mode);
      if (bindings.length > 0) {
        const innerElements = eventPath.slice(0, index);
        const hit = this.resolveOutputHit(element, innerElements, bindings, event.type);
        if (hit) return descriptor ? { ...hit, descriptor } : hit;
        if (!descriptor?.click && !(mode === 'classic' && element.hasAttribute('data-at-id'))) return null;
      }
      if (descriptor?.click) {
        if (descriptor.click.event !== event.type) return null;
        return { id: descriptor.click.id, labelSource: element, fallbackLabel: descriptor.click.rotulo, host: element, descriptor };
      }

      if (mode !== 'classic' || !element.hasAttribute('data-at-id')) continue;
      if ((element.getAttribute('data-at-event') ?? 'click') !== event.type) return null;
      return {
        id: element.getAttribute('data-at-id')!,
        labelSource: element,
        fallbackLabel: element.getAttribute('data-at-rotulo') ?? '',
        host: element,
      };
    }
    // O header do ion-modal é irmão do conteúdo projetado, não descendente
    // do wrapper original. A âncora projetada vincula o owner e o gesto.
    if (event.type === 'click') {
      const modal = eventPath.find((element) => element.localName === 'ion-modal');
      if (modal) {
        const anchors = Array.from(modal.querySelectorAll(mode === 'ref' ? '[data-at-ref]' : '[data-at-overlay-outputs][data-at-owner]')).filter(
          (anchor) => mode === 'ref' ? !!this.descriptorOf(anchor, mode)?.overlayOutputs?.length : anchor.hasAttribute('data-at-overlay-outputs'));
        if (anchors.length === 1) {
          const anchor = anchors[0]!;
          const hit = this.resolveOutputHit(anchor, eventPath, this.outputsFor(anchor, mode), event.type);
          if (hit) {
            const descriptor = this.descriptorOf(anchor, mode);
            return descriptor ? { ...hit, descriptor } : hit;
          }
        }
      }
    }
    return null;
  }

  /** Tela onde o gesto ocorreu; para overlays, usa a tela exibida por último. */
  static screenOf(event: Event, document: Document, mode: TrackingMode = 'classic'): Screen | null {
    for (const element of this.elementsOf(event)) {
      const marker = Array.from(element.children).find((child) => mode === 'ref' ? !!this.descriptorOf(child, mode)?.screenId : child.hasAttribute('data-at-screen'));
      if (marker) {
        const descriptor = this.descriptorOf(marker, mode);
        if (descriptor?.screenId) return { funcionalidade: descriptor.funcionalidade, tela: descriptor.tela };
        return this.markerScreen(marker);
      }
    }

    const current = document.documentElement.getAttribute(CURRENT_SCREEN_ATTRIBUTE);
    if (!current) return null;
    const [funcionalidade, tela] = current.split('|');
    return funcionalidade && tela ? { funcionalidade, tela } : null;
  }

  /** Marcador de tela do componente roteado: primeiro filho do host com data-at-screen. */
  static findScreenMarker(document: Document, hostSelector: string, mode: TrackingMode = 'classic'): Element | null {
    for (const host of Array.from(document.querySelectorAll(hostSelector))) {
      const marker = Array.from(host.children).find((child) => mode === 'ref' ? !!this.descriptorOf(child, mode)?.screenId : child.hasAttribute('data-at-screen'));
      if (marker) return marker;
    }
    return null;
  }

  private emitClick(event: Event, hit: Hit): void {
    // Lê tudo antes de qualquer await: o DOM pode mudar em seguida.
    // Overlays ficam fora da rota que os abriu: a última tela global pode
    // pertencer a outro MFE. Neles, somente a origem marcada é prova da tela.
    const overlay = DomEventTracker.elementsOf(event).some((element) =>
      element.matches('ion-modal, ion-popover, ion-alert, dialog, [role=dialog], [aria-modal=true]')
      || element.localName.endsWith('-modal'));
    const ownScreen = hit.descriptor ? { funcionalidade: hit.descriptor.funcionalidade, tela: hit.descriptor.tela } : DomEventTracker.markerScreen(hit.host);
    const screen = overlay || hit.host.hasAttribute('data-at-overlay-outputs') || !!hit.descriptor?.overlayOutputs?.length
      ? ownScreen
      : DomEventTracker.screenOf(event, this.document, this.deps.mode ?? 'classic') ?? ownScreen;
    if (!screen) {
      this.warnSafely(`[auto-tracking] click '${hit.id}' sem tela identificável`);
      return;
    }

    // O rótulo do contrato é o mesmo da planilha; texto do DOM pode trazer dados
    // pessoais. O DOM só é lido para item de lista com valores provados pelo CLI
    // ou para marcador legado sem rótulo.
    const submitter = event.type === 'submit' ? (event as SubmitEvent).submitter : null;
    // Nunca usar todo o conteúdo do formulário como rótulo da submissão.
    const labelSource = event.type === 'submit' ? submitter : hit.labelSource;
    const proven = DomEventTracker.provenLabel(hit);
    const label = proven || slug(hit.fallbackLabel) || (labelSource ? slug(DomEventTracker.visibleLabel(labelSource)) : '') || slug(hit.id);
    const candidate = hit.host.getAttribute('data-at-option');
    const allowed = hit.descriptor?.click?.opcaoPermitida ?? hit.host.getAttribute('data-at-option-allowed');
    // shortcut: marcadores legados não têm lista de valores; regerar tracking aplica a validação.
    const accessibleNumber = hit.descriptor?.click?.opcaoFonte === 'aria-label-numero'
      ? DomEventTracker.accessibleNumericOption(hit.host, allowed)
      : null;
    const option = event.type === 'click'
      ? accessibleNumber ?? (candidate && (allowed === null || allowed.split('|').includes(candidate)) ? candidate : null)
      : event.type === 'submit' ? null : DomEventTracker.selectedOption(hit.host, event);
    if (event.type === 'click' && candidate && allowed !== null && !option) {
      this.warnSafely(`[auto-tracking] opção de '${hit.id}' fora dos valores comprovados; parâmetro não enviado`);
    }
    const element = hit.descriptor?.click?.elemento ?? hit.host.getAttribute('data-at-elemento') ?? 'botao';
    const build = (environment: string, product: string): Params => {
      const base = DomEventTracker.baseParams(screen, environment, product);
      const params: Params = { ...base, categoria: base['tela']!, elemento: element, rotulo: label, acao: 'clique' };
      const selected = option ? slug(option) : '';
      if (selected) params['opcao_selecionada_1'] = selected;
      return params;
    };
    void this.dispatch('click', build, hit.id).catch((error) => this.warnSafely(`[auto-tracking] falha no envio: ${String(error)}`));
  }

  /** Item de lista estática: o rótulo visível só é enviado se for um dos valores provados pelo CLI. */
  private static provenLabel(hit: Hit): string {
    const allowed = hit.descriptor?.rotulos ?? hit.host.getAttribute('data-at-rotulos')?.split('|').filter(Boolean);
    if (!allowed?.length) return '';
    for (const element of [hit.labelSource, hit.host]) {
      const exact = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('label')]
        .map((value) => labelSlug(value)).find((value) => allowed.includes(value));
      if (exact) return exact;
    }
    // Texto renderizado pode trazer descrição junto do título. Só um valor
    // inequívoco é enviado; "welcome" contido em "welcome-home" não conta.
    // textContent cola nós vizinhos ("Salas VIP" + "Acesso"): normalizar cada texto.
    const parts: string[] = [];
    const walker = hit.host.ownerDocument.createTreeWalker(hit.host, 4 /* SHOW_TEXT */);
    for (let node = walker.nextNode(); node && parts.length < 200; node = walker.nextNode()) {
      const part = labelSlug(node.nodeValue);
      if (part) parts.push(part);
    }
    const text = `-${parts.join('-')}-`;
    const found = allowed.filter((value) => text.includes(`-${value}-`));
    const distinct = found.filter((value) => !found.some((other) => other !== value && other.includes(value)));
    return distinct.length === 1 ? distinct[0]! : '';
  }

  private static accessibleNumericOption(element: Element, allowed: string | null): string | null {
    if (!allowed) return null;
    const label = element.getAttribute('aria-label') ?? '';
    const possible = [...label.matchAll(/(^|[^\d])(\d+)(?=[^\d]|$)/g)].map((match) => match[2]!);
    const matches = possible.filter((value) => allowed.split('|').includes(value));
    return matches.length === 1 ? matches[0]! : null;
  }

  private static resolveOutputHit(host: Element, inner: readonly Element[], outputs: readonly OutputBinding[], eventName: string): Hit | null {
    for (const { id, event, selector, label: fallbackLabel } of outputs) {
      if (event !== eventName) continue;
      if (selector === ':host') return { id, labelSource: host, fallbackLabel, host };

      const match = inner.find((element) => {
        if (selector === '*') return element.matches(INTERACTIVE_ELEMENT_SELECTOR);
        if (selector.startsWith(':scope > ')) {
          // :scope > é uma relação entre dois nós do composedPath. Consultar
          // toda a árvore do host a cada clique é desnecessário e caro.
          const root = element.getRootNode();
          const direct = element.parentElement === host ||
            (root.nodeType === 11 && 'host' in root && root.host === host && element.parentNode === (root as Node));
          return direct && element.matches(selector.slice(9));
        }
        return element.matches(selector);
      });
      if (match) return { id, labelSource: match, fallbackLabel, host };
    }
    return null;
  }

  private async dispatch(name: string, build: (environment: string, product: string) => Params, origin: string): Promise<void> {
    if (!this.active) return;
    const environment = await this.deps.resolveEnvironment();
    if (!this.active) return; // Navegação/destruição durante resolução assíncrona.
    if (!environment) {
      this.warnSafely(`[auto-tracking] ${name} '${origin}' não enviado: ambiente não resolvido (app nativo fora do preset ou tema não mapeado)`);
      return;
    }

    const event: TrackingEvent = { name, params: build(environment, this.deps.product) };
    const validation = validateEvent(event, this.deps.schema);
    if (validation.kind !== 'valid') {
      this.warnSafely(`[auto-tracking] ${name} '${origin}' rejeitado pelo schema: ${validation.kind} ${validation.params.join(',')}`);
      return;
    }
    await this.deps.send(event);
  }

  private static isElement(node: unknown): node is Element {
    // nodeType é consistente entre janelas/iframes; instanceof Element não é.
    return !!node && typeof node === 'object' && (node as Node).nodeType === 1;
  }

  private static elementsOf(event: Event): Element[] {
    return event.composedPath().filter(this.isElement);
  }

  private static visibleLabel(element: Element): string {
    return element.getAttribute('aria-label') ?? element.getAttribute('label') ?? element.getAttribute('title') ?? element.getAttribute('placeholder') ?? element.textContent ?? '';
  }

  private static markerScreen(marker: Element): Screen | null {
    const funcionalidade = marker.getAttribute('data-at-funcionalidade');
    const tela = marker.getAttribute('data-at-tela');
    return funcionalidade && tela ? { funcionalidade, tela } : null;
  }

  private static selectedOption(element: Element, event: Event): string | null {
    const detail = (event as CustomEvent<{ value?: unknown; checked?: boolean }>).detail;
    if (detail && typeof detail.checked === 'boolean') return String(detail.checked);
    const target = event.target as (EventTarget & { value?: unknown }) | null;
    const value = detail?.value ?? (target && 'value' in target ? target.value : undefined);
    if (value === undefined || value === null || value === '') return null;

    const values = Array.isArray(value) ? value : [value];
    const labels = values.map((item) => {
        const option = Array.from(element.querySelectorAll('ion-select-option, option, ion-segment-button, ion-radio')).find(
          (candidate) => (candidate as Element & { value?: unknown }).value === item,
        );
        const text = option?.textContent?.trim();
        if (text) return text;
        return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item) : null;
      });
    return labels.every((label): label is string => label !== null) ? labels.join(',') : null;
  }

  private static baseParams(screen: Screen, environment: string, product: string): Params {
    return { ambiente: environment, produto: product, funcionalidade: screen.funcionalidade, tela: `${environment}:${product}:${screen.tela}` };
  }
}

export const resolveHit = (event: Event, mode: TrackingMode = 'classic'): Hit | null => DomEventTracker.resolveHit(event, mode);
export const screenOf = (event: Event, document: Document): Screen | null => DomEventTracker.screenOf(event, document);
export const findScreenMarker = (document: Document, selector: string): Element | null => DomEventTracker.findScreenMarker(document, selector);
export const installDomTracker = (document: Document, deps: DomTrackerDeps): (() => void) => new DomEventTracker(document, deps).install();
export const emitScreenView = (document: Document, selector: string, deps: DomTrackerDeps): boolean =>
  new DomEventTracker(document, deps).emitScreenView(selector);

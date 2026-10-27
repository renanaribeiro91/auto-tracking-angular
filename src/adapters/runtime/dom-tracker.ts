// T09–T14 — emissão runtime: gesto DOM → elemento marcado → owner → tela atual → schema → send
import { validateEvent, type TrackingSchema } from '../../domain/contract/schema.js';
import { slug } from '../../domain/contract/slug.js';
import type { TrackingEvent } from '../../config.js';
import { CURRENT_SCREEN_ATTRIBUTE, INTERACTIVE_ELEMENT_SELECTOR, TRACKED_DOM_EVENTS } from './dom-tracker.constants.js';

export interface DomTrackerDeps {
  readonly owner: string;
  readonly product: string;
  readonly schema: TrackingSchema;
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
}

/** Mantém a emissão de gestos vinculada ao documento e ao owner durante seu lifecycle. */
export class DomEventTracker {
  constructor(private readonly document: Document, private readonly deps: DomTrackerDeps) {}

  install(): () => void {
    const handled = new WeakSet<Event>();
    const onEvent = (event: Event): void => {
      if (handled.has(event)) return;
      const hit = DomEventTracker.resolveHit(event);
      if (!hit || hit.host.getAttribute('data-at-owner') !== this.deps.owner) return;
      handled.add(event);
      this.emitClick(event, hit);
    };

    const registered = new Set<string>();
    const listen = (name: string): void => {
      if (!/^[A-Za-z][\w:-]*$/.test(name) || registered.has(name)) return;
      this.document.addEventListener(name, onEvent, true);
      registered.add(name);
    };
    const discover = (element: Element): void => {
      const current = element.getAttribute('data-at-event');
      if (current) listen(current);
      for (const output of (element.getAttribute('data-at-outputs') ?? '').split(';')) {
        const eventName = output.split('|')[1];
        if (eventName) listen(eventName);
      }
    };
    const discoverTree = (root: Element): void => {
      discover(root);
      root.querySelectorAll('[data-at-event], [data-at-outputs]').forEach(discover);
    };

    TRACKED_DOM_EVENTS.forEach(listen);
    discoverTree(this.document.documentElement);
    // Angular monta componentes lazy e modais depois do bootstrap; seus CustomEvents
    // devem entrar no catálogo de listeners sem reinstalar o provider.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) discover(record.target);
        for (const node of Array.from(record.addedNodes)) if (node instanceof Element) discoverTree(node);
      }
    });
    observer.observe(this.document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['data-at-event', 'data-at-outputs'],
    });
    return () => {
      observer.disconnect();
      for (const eventName of registered) this.document.removeEventListener(eventName, onEvent, true);
    };
  }

  /** Registra a tela atual e emite screen_view se o marcador pertence a este owner. */
  emitScreenView(hostSelector: string): boolean {
    const marker = DomEventTracker.findScreenMarker(this.document, hostSelector);
    if (!marker) return false;

    const screen = DomEventTracker.markerScreen(marker);
    if (screen) this.document.documentElement.setAttribute(CURRENT_SCREEN_ATTRIBUTE, `${screen.funcionalidade}|${screen.tela}`);
    if (!screen || marker.getAttribute('data-at-owner') !== this.deps.owner) return true;

    const screenId = marker.getAttribute('data-at-screen')!;
    void this.dispatch('screen_view', (environment, product) => DomEventTracker.baseParams(screen, environment, product), screenId)
      .catch((error) => this.deps.warn(`[auto-tracking] falha no envio: ${String(error)}`));
    return true;
  }

  /** Primeiro elemento marcado no caminho do evento, por ID ou output mapeado. */
  static resolveHit(event: Event): Hit | null {
    const eventPath = this.elementsOf(event);
    for (let index = 0; index < eventPath.length; index++) {
      const element = eventPath[index]!;
      const outputs = element.getAttribute('data-at-outputs');
      if (outputs) {
        const innerElements = eventPath.slice(0, index);
        const hit = this.resolveOutputHit(element, innerElements, outputs, event.type);
        if (hit) return hit;
        if (!element.hasAttribute('data-at-id')) return null;
      }

      if (!element.hasAttribute('data-at-id')) continue;
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
        const anchors = modal.querySelectorAll('[data-at-overlay-outputs][data-at-owner]');
        if (anchors.length === 1) {
          const anchor = anchors[0]!;
          const output = anchor.getAttribute('data-at-overlay-outputs')!;
          const hit = this.resolveOutputHit(anchor, eventPath, output, event.type);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  /** Tela onde o gesto ocorreu; para overlays, usa a tela exibida por último. */
  static screenOf(event: Event, document: Document): Screen | null {
    for (const element of this.elementsOf(event)) {
      const marker = Array.from(element.children).find((child) => child.hasAttribute('data-at-screen'));
      if (marker) return this.markerScreen(marker);
    }

    const current = document.documentElement.getAttribute(CURRENT_SCREEN_ATTRIBUTE);
    if (!current) return null;
    const [funcionalidade, tela] = current.split('|');
    return funcionalidade && tela ? { funcionalidade, tela } : null;
  }

  /** Marcador de tela do componente roteado: primeiro filho do host com data-at-screen. */
  static findScreenMarker(document: Document, hostSelector: string): Element | null {
    for (const host of Array.from(document.querySelectorAll(hostSelector))) {
      const marker = Array.from(host.children).find((child) => child.hasAttribute('data-at-screen'));
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
    const screen = overlay || hit.host.hasAttribute('data-at-overlay-outputs')
      ? DomEventTracker.markerScreen(hit.host)
      : DomEventTracker.screenOf(event, this.document) ?? DomEventTracker.markerScreen(hit.host);
    if (!screen) {
      this.deps.warn(`[auto-tracking] click '${hit.id}' sem tela identificável`);
      return;
    }

    const submitter = event.type === 'submit' ? (event as SubmitEvent).submitter : null;
    // Nunca usar todo o conteúdo do formulário como rótulo da submissão.
    const labelSource = event.type === 'submit' ? submitter : hit.labelSource;
    const label = (labelSource ? slug(DomEventTracker.visibleLabel(labelSource)) : '') || hit.fallbackLabel;
    const candidate = hit.host.getAttribute('data-at-option');
    const allowed = hit.host.getAttribute('data-at-option-allowed');
    // shortcut: marcadores legados não têm lista de valores; regerar tracking aplica a validação.
    const option = event.type === 'click' ? candidate && (allowed === null || allowed.split('|').includes(candidate)) ? candidate : null : event.type === 'submit' ? null : DomEventTracker.selectedOption(hit.host, event);
    if (event.type === 'click' && candidate && allowed !== null && !option) {
      this.deps.warn(`[auto-tracking] opção de '${hit.id}' fora dos valores comprovados; parâmetro não enviado`);
    }
    const element = hit.host.getAttribute('data-at-elemento') ?? 'botao';
    const build = (environment: string, product: string): Params => {
      const base = DomEventTracker.baseParams(screen, environment, product);
      const params: Params = { ...base, categoria: base['tela']!, elemento: element, rotulo: label, acao: 'clique' };
      if (option) params['opcao_selecionada_1'] = slug(option);
      return params;
    };
    void this.dispatch('click', build, hit.id).catch((error) => this.deps.warn(`[auto-tracking] falha no envio: ${String(error)}`));
  }

  private static resolveOutputHit(host: Element, inner: readonly Element[], outputs: string, eventName: string): Hit | null {
    for (const part of outputs.split(';')) {
      const [id, event, selector, fallbackLabel = ''] = part.split('|');
      if (!id || event !== eventName || !selector) continue;
      if (selector === ':host') return { id, labelSource: host, fallbackLabel, host };

      const match = inner.find((element) => {
        if (selector === '*') return element.matches(INTERACTIVE_ELEMENT_SELECTOR);
        if (selector.startsWith(':scope > ')) {
          if (Array.from(host.querySelectorAll(selector)).includes(element)) return true;
          const root = element.getRootNode();
          const direct = element.parentElement === host || (root instanceof ShadowRoot && root.host === host && element.parentNode === root);
          return direct && element.matches(selector.slice(9));
        }
        return element.matches(selector);
      });
      if (match) return { id, labelSource: match, fallbackLabel, host };
    }
    return null;
  }

  private async dispatch(name: string, build: (environment: string, product: string) => Params, origin: string): Promise<void> {
    const environment = await this.deps.resolveEnvironment();
    if (!environment) {
      this.deps.warn(`[auto-tracking] ${name} '${origin}' não enviado: ambiente não resolvido (app nativo fora do preset ou tema não mapeado)`);
      return;
    }

    const event: TrackingEvent = { name, params: build(environment, this.deps.product) };
    const validation = validateEvent(event, this.deps.schema);
    if (validation.kind !== 'valid') {
      this.deps.warn(`[auto-tracking] ${name} '${origin}' rejeitado pelo schema: ${validation.kind} ${validation.params.join(',')}`);
      return;
    }
    await this.deps.send(event);
  }

  private static elementsOf(event: Event): Element[] {
    return event.composedPath().filter((target): target is Element => target instanceof Element);
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

export const resolveHit = (event: Event): Hit | null => DomEventTracker.resolveHit(event);
export const screenOf = (event: Event, document: Document): Screen | null => DomEventTracker.screenOf(event, document);
export const findScreenMarker = (document: Document, selector: string): Element | null => DomEventTracker.findScreenMarker(document, selector);
export const installDomTracker = (document: Document, deps: DomTrackerDeps): (() => void) => new DomEventTracker(document, deps).install();
export const emitScreenView = (document: Document, selector: string, deps: DomTrackerDeps): boolean =>
  new DomEventTracker(document, deps).emitScreenView(selector);

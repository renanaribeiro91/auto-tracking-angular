// T09–T14 — emissão runtime: gesto DOM → elemento marcado → owner → tela atual → schema → send
import { validateEvent, type TrackingSchema } from '../../domain/contract/schema.js';
import { labelSlug, overlayActionLabel, overlayComponentName, slug } from '../../domain/contract/slug.js';
import { decodeOutputBindings, type OutputBinding } from '../../domain/contract/output-bindings.js';
import type { TrackingElement } from '../../domain/contract/tracking-element.js';
import { TrackingTokenCache } from '../../domain/contract/tracking-token.js';
import type { TrackingSurfaceDefinition } from '../../domain/contract/tracking-surface.js';
import { trackingSurfaceContract } from '../../domain/contract/tracking-surface.js';
import type { TrackingMode } from '../../config.js';
import type { TrackingEvent } from '../../config.js';
import { CURRENT_SCREEN_ATTRIBUTE, INTERACTIVE_ELEMENT_SELECTOR, OVERLAY_ACTION_SELECTOR, OVERLAY_DISMISS_EVENTS, OVERLAY_KIND, OVERLAY_PRESENT_EVENTS, IONIC_OVERLAY_SELECTOR, NATIVE_DIALOG_SELECTOR, OVERLAY_SELECTOR, OVERLAY_TITLE_SELECTOR, SELECT_OVERLAY_SELECTOR, TRACKED_DOM_EVENTS } from './dom-tracker.constants.js';
import { DomDiscoveryScheduler } from './dom-discovery-scheduler.js';
import { screenPath, subfuncionalidadeOf } from '../../domain/contract/screen-binding.js';

export interface DomTrackerDeps {
  /** Host Angular opcional; limita a varredura inicial sem restringir overlays. */
  readonly root?: string;
  readonly owner: string;
  readonly product: string;
  readonly schema: TrackingSchema;
  readonly mode?: TrackingMode;
  readonly surfaces?: AutoTrackingSurfaces;
  resolveEnvironment(): Promise<string | null>;
  send(event: TrackingEvent): void | Promise<void>;
  warn(message: string): void;
}

type Params = Record<string, string>;
/** Hierarquia que a lib sempre conhece, mas que nem todo schema de consumidor aceita. */
const OPTIONAL_PARAMS = ['subfuncionalidade'] as const;
export interface TrackingScreen {
  readonly funcionalidade: string;
  readonly tela: string;
}
type Screen = TrackingScreen;
interface Hit {
  readonly id: string;
  /** elemento cujo texto vira o rótulo */
  readonly labelSource: Element;
  /** rótulo estável gravado pelo CLI, usado quando o elemento não tem texto visível */
  readonly fallbackLabel: string;
  readonly host: Element;
  readonly descriptor?: TrackingElement;
  readonly owner?: string;
  readonly screen?: Screen;
  readonly option?: string | null;
  readonly elemento?: string;
  readonly event?: string;
}

export interface TrackingSurfaceAction {
  readonly event?: 'click' | 'change' | 'ionChange' | 'submit';
  /** Seletor CSS dentro da superfície, associado ao gesto físico. */
  readonly selector: string;
  readonly id: string;
  readonly elemento: string;
  readonly rotulo: string;
  readonly rotulos?: readonly string[];
  readonly optionAttribute?: string;
  readonly labelAttribute?: string;
  /** Mapeia a opção escolhida a um rótulo semântico; nunca retornar dados pessoais. */
  readonly optionOf?: (element: Element) => string | null;
  /** Valores públicos permitidos para a opção escolhida. */
  readonly allowedOptions?: readonly string[];
}

export interface TrackingSurface {
  readonly screen: Readonly<TrackingScreen>;
  readonly actions: readonly TrackingSurfaceAction[];
}

/** Vínculo explícito entre um portal/modal imperativo, seus gestos e a tela que o abriu. */
export class AutoTrackingSurfaces {
  private static readonly tokens = new TrackingTokenCache();
  private static readonly active = new WeakMap<Document, Map<string, AutoTrackingSurfaces>>();
  private readonly registered = new WeakMap<Element, TrackingSurface>();
  constructor(private readonly owner: string, private readonly origin?: () => TrackingScreen | null) {}

  /** Expõe o owner ativo ao código imperativo que roda em services da raiz do host. */
  static activate(document: Document, surfaces: AutoTrackingSurfaces): () => void {
    const owners = this.active.get(document) ?? new Map<string, AutoTrackingSurfaces>();
    owners.set(surfaces.owner, surfaces);
    this.active.set(document, owners);
    return () => {
      if (owners.get(surfaces.owner) === surfaces) owners.delete(surfaces.owner);
      if (!owners.size) this.active.delete(document);
    };
  }

  static forDefinition(document: Document, definition: TrackingSurfaceDefinition): AutoTrackingSurfaces | null {
    const owner = definition.ref ? this.tokens.resolve(definition.ref)?.owner : null;
    return owner ? this.active.get(document)?.get(owner) ?? null : null;
  }

  /** Capturar antes de qualquer await que abra o portal. */
  capture(owner = this.owner): TrackingScreen | null {
    if (owner !== this.owner) return null;
    const screen = this.origin?.();
    return screen ? { ...screen } : null;
  }

  /** A mesma ref gravada pelo CLI liga a evidência estática ao DOM do portal. */
  attach(root: Element, definition: TrackingSurfaceDefinition, screen: TrackingScreen | null): () => void {
    // Service da raiz do host recebe a instância de outro owner (ou a padrão): a ref decide o owner e sua origem.
    const target = root?.ownerDocument ? AutoTrackingSurfaces.forDefinition(root.ownerDocument, definition) : null;
    if (target && target !== this) return target.attach(root, definition, target.capture());
    try { return this.attachChecked(root, definition, screen ?? this.capture()); }
    catch (error) {
      try { console.warn(`[auto-tracking] superfície não vinculada: ${String(error)}`); } catch { /* preservar o fluxo do modal */ }
      return () => {};
    }
  }

  private attachChecked(root: Element, definition: TrackingSurfaceDefinition, screen: TrackingScreen | null): () => void {
    const descriptor = definition.ref ? AutoTrackingSurfaces.tokens.resolve(definition.ref) : null;
    if (!screen || !descriptor || descriptor.owner !== this.owner || !descriptor.outputs
      || descriptor.outputs.length !== definition.actions.length) {
      throw new Error('[auto-tracking] superfície sem origem ou ref válida; execute auto-tracking apply');
    }
    if (descriptor.surfaceContract !== trackingSurfaceContract(definition)) {
      throw new Error('[auto-tracking] declaração de superfície alterada; execute auto-tracking apply');
    }
    const actions = definition.actions.map((action, index) => {
      const output = descriptor.outputs![index]!;
      if (output.id !== `${slug(definition.id)}-${slug(action.id)}` || output.event !== (action.event ?? 'click')
        || output.selector !== action.selector || output.label !== slug(action.rotulo) || output.elemento !== action.elemento
        || action.rotulos?.some((label) => !descriptor.rotulos?.includes(slug(label)))) {
        throw new Error('[auto-tracking] declaração de superfície alterada; execute auto-tracking apply');
      }
      return { ...action, id: output.id, ...(action.optionAttribute ? {
        optionOf: (element: Element) => element.getAttribute(action.optionAttribute!),
      } : {}) };
    });
    const previous = root.getAttribute('data-at-ref');
    if (previous && previous !== definition.ref) throw new Error('[auto-tracking] raiz já possui outra ref');
    const stop = this.register(root, { screen, actions });
    root.setAttribute('data-at-ref', definition.ref!);
    return () => {
      stop();
      if (root.getAttribute('data-at-ref') === definition.ref && previous === null) root.removeAttribute('data-at-ref');
    };
  }

  register(root: Element, surface: TrackingSurface): () => void {
    if (!root || !surface.screen.funcionalidade || !surface.screen.tela
      || surface.actions.some((action) => !action.id || !action.elemento || !action.rotulo || !action.selector
        || (action.optionOf && !action.allowedOptions?.length && !action.optionAttribute))) {
      throw new Error('[auto-tracking] superfície incompleta');
    }
    if (this.registered.has(root)) throw new Error('[auto-tracking] superfície já registrada');
    // Validar os seletores antes de instalar o vínculo; erro de integração não pode afetar cliques futuros.
    for (const action of surface.actions) root.matches(action.selector);
    const captured = { screen: { ...surface.screen }, actions: surface.actions.map((action) => ({
      ...action, ...(action.rotulos ? { rotulos: [...action.rotulos] } : {}), ...(action.allowedOptions ? { allowedOptions: [...action.allowedOptions] } : {}),
    })) };
    this.registered.set(root, captured);
    return () => { if (this.registered.get(root) === captured) this.registered.delete(root); };
  }

  resolve(event: Event, owner: string): Hit | null {
    const path = event.composedPath().filter((node): node is Element =>
      !!node && typeof node === 'object' && (node as Node).nodeType === 1);
    for (let index = 0; index < path.length; index++) {
      const root = path[index]!;
      const surface = this.registered.get(root);
      if (!surface || this.owner !== owner) continue;
      const screen = this.origin ? this.capture(owner) : surface.screen;
      if (!screen) throw new Error('[auto-tracking] superfície sem tela visível do owner');
      for (const action of surface.actions) {
        let target: Element | undefined;
        for (let candidateIndex = 0; candidateIndex <= index; candidateIndex++) {
          const candidate = path[candidateIndex]!;
          if (candidate.matches(action.selector)) { target = candidate; break; }
        }
        if (!target) continue;
        const expected = action.event ?? 'click';
        const opening = event.type === 'click' && ['change', 'ionChange'].includes(expected)
          && DomEventTracker.isSelectOpeningGesture(target, path.slice(0, path.indexOf(target)));
        if (event.type !== expected && !opening) continue;
        const candidate = opening ? null : action.optionOf?.(target);
        if (!opening && action.optionOf && (!candidate || (action.allowedOptions && !action.allowedOptions.includes(candidate))
          || /@|\d(?:[.\-\/ ]?\d){5,}/.test(candidate))) {
          throw new Error(`opção de '${action.id}' fora dos valores comprovados`);
        }
        const label = action.labelAttribute ? target.getAttribute(action.labelAttribute) : action.rotulo;
        if (!label?.trim() || /@|\d(?:[.\-\/ ]?\d){5,}/.test(label)) throw new Error(`rótulo público de '${action.id}' indisponível`);
        return { id: action.id, host: target, labelSource: target, fallbackLabel: label, event: expected,
          ...(action.rotulos ? { descriptor: { owner, ...screen, rotulos: action.rotulos.map((label) => slug(label)) } } : {}),
          elemento: action.elemento, owner, screen,
          ...(candidate ? { option: candidate } : {}) };
      }
      return null;
    }
    return null;
  }

  screenFor(event: Event, owner: string): Screen | null {
    if (this.owner !== owner) return null;
    for (const node of event.composedPath()) {
      if ((node as Node).nodeType !== 1) continue;
      const surface = this.registered.get(node as Element);
      if (surface) return this.origin ? this.capture(owner) : surface.screen;
    }
    return null;
  }
}

/** Mantém a emissão de gestos vinculada ao documento e ao owner durante seu lifecycle. */
export class DomEventTracker {
  private static readonly tokens = new TrackingTokenCache();
  private active = true;
  /** Escolha aberta em overlay próprio do componente (sheet/modal/popover): o valor muda sem ionChange. */
  private pendingChoice: { readonly id: string; readonly finish: () => boolean; readonly expires: number } | null = null;
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
        const hit = this.deps.surfaces?.resolve(event, this.deps.owner)
          ?? DomEventTracker.resolveHit(event, this.deps.mode ?? 'classic');
        if (!hit) {
          if (event.type === 'click' && this.emitOverlayAction(event)) handled.add(event);
          return;
        }
        if ((hit.owner ?? hit.descriptor?.owner ?? hit.host.getAttribute('data-at-owner')) !== this.deps.owner) return;
        handled.add(event);
        this.emitClick(event, hit);
      } catch (error) {
        this.warnSafely(`[auto-tracking] evento ignorado com segurança: ${String(error)}`);
      }
    };

    const onDismiss = (): void => this.settleChoice();
    const viewed = new WeakSet<Element>();
    const showOverlay = (overlay: unknown): void => {
      try { if (DomEventTracker.isElement(overlay)) this.emitOverlayView(overlay); }
      catch (error) { this.warnSafely(`[auto-tracking] visualização ignorada com segurança: ${String(error)}`); }
    };
    const onPresent = (event: Event): void => showOverlay(event.target);
    // Diálogo fora do Ionic: uma visualização por instância aberta (o mesmo <dialog> reaberto conta de novo).
    const showDialogs = (node: Element): void => {
      const dialogs = node.matches(NATIVE_DIALOG_SELECTOR) ? [node] : Array.from(node.querySelectorAll(NATIVE_DIALOG_SELECTOR));
      for (const dialog of dialogs) {
        if (viewed.has(dialog) || dialog.closest(IONIC_OVERLAY_SELECTOR) || dialog.parentElement?.closest(NATIVE_DIALOG_SELECTOR)) continue;
        viewed.add(dialog);
        showOverlay(dialog);
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
            if (record.attributeName === 'open') {
              if (record.target.hasAttribute('open')) showDialogs(record.target); else viewed.delete(record.target);
            } else scheduler.changed(record.target);
          }
          for (const node of Array.from(record.addedNodes)) {
            if (!DomEventTracker.isElement(node)) continue;
            scheduler.added(node);
            showDialogs(node);
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
      for (const name of OVERLAY_DISMISS_EVENTS) this.document.removeEventListener(name, onDismiss, true);
      for (const name of OVERLAY_PRESENT_EVENTS) this.document.removeEventListener(name, onPresent, true);
      this.pendingChoice = null;
      registered.clear();
    };
    try {
      // Gestos DOM principais precisam funcionar imediatamente; descoberta
      // de CustomEvents é incremental, não uma varredura bloqueante.
      TRACKED_DOM_EVENTS.forEach(listen);
      for (const name of OVERLAY_DISMISS_EVENTS) this.document.addEventListener(name, onDismiss, true);
      for (const name of OVERLAY_PRESENT_EVENTS) this.document.addEventListener(name, onPresent, true);
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
          'data-at-output-ref', 'data-at-ref', 'data-at-owner', 'open'],
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

  private static isSelectOpener(element: Element): boolean {
    return element.localName === 'select' || element.localName.endsWith('-select')
      || element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox';
  }

  static isSelectOpeningGesture(element: Element, innerElements: readonly Element[]): boolean {
    return this.isSelectOpener(element) && !innerElements.some((target) =>
      target.matches('button, a, input, option, ion-select-option, ion-radio, [role="option"], [role="button"], [role="checkbox"], [role="radio"]'));
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
        if (descriptor.click.event !== event.type && !(event.type === 'click'
          && (descriptor.click.event === 'ionChange' || descriptor.click.event === 'change')
          && this.isSelectOpeningGesture(element, eventPath.slice(0, index)))) return null;
        return { id: descriptor.click.id, labelSource: element, fallbackLabel: descriptor.click.rotulo, host: element, descriptor };
      }

      if (mode !== 'classic' || !element.hasAttribute('data-at-id')) continue;
      const expected = element.getAttribute('data-at-event') ?? 'click';
      if (expected !== event.type && !(event.type === 'click' && (expected === 'ionChange' || expected === 'change')
        && this.isSelectOpeningGesture(element, eventPath.slice(0, index)))) return null;
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

  /** Tela no caminho do gesto; quando há owner, nunca consulta a tela global de outro MFE. */
  static screenOf(event: Event, document: Document, mode: TrackingMode = 'classic', owner?: string): Screen | null {
    for (const element of this.elementsOf(event)) {
      for (let marker = element.firstElementChild; marker; marker = marker.nextElementSibling) {
        if (mode === 'ref' ? !this.descriptorOf(marker, mode)?.screenId : !marker.hasAttribute('data-at-screen')) continue;
        const descriptor = this.descriptorOf(marker, mode);
        if (owner && (descriptor?.owner ?? marker.getAttribute('data-at-owner')) !== owner) continue;
        if (descriptor?.screenId) return { funcionalidade: descriptor.funcionalidade, tela: descriptor.tela };
        return this.markerScreen(marker);
      }
    }

    if (owner) return null;
    const current = document.documentElement.getAttribute(CURRENT_SCREEN_ATTRIBUTE);
    if (!current) return null;
    const [funcionalidade, tela] = current.split('|');
    return funcionalidade && tela ? { funcionalidade, tela } : null;
  }

  /** Marcador de tela do componente roteado: primeiro filho do host com data-at-screen. */
  static findScreenMarker(document: Document, hostSelector: string, mode: TrackingMode = 'classic', owner?: string): Element | null {
    const hosts = Array.from(document.querySelectorAll(hostSelector)).filter((host) => !host.closest('[hidden], .ion-page-hidden'));
    // Overlay aberto aplica aria-hidden/inert na página de baixo, que segue sendo a tela; só vale sem instância visível.
    const covered = (host: Element): boolean => !!host.closest('[inert], [aria-hidden="true"]');
    const visible = hosts.filter((host) => !covered(host));
    for (const host of visible.length ? visible : hosts) {
      const marker = Array.from(host.children).find((child) => {
        const descriptor = this.descriptorOf(child, mode);
        return (!owner || (descriptor?.owner ?? child.getAttribute('data-at-owner')) === owner)
          && (mode === 'ref' ? !!descriptor?.screenId : child.hasAttribute('data-at-screen'));
      });
      if (marker) return marker;
    }
    return null;
  }

  static screenForHost(document: Document, selector: string, mode: TrackingMode, owner: string): TrackingScreen | null {
    const marker = this.findScreenMarker(document, selector, mode, owner);
    if (!marker) return null;
    const descriptor = this.descriptorOf(marker, mode);
    return descriptor ? { funcionalidade: descriptor.funcionalidade, tela: descriptor.tela } : this.markerScreen(marker);
  }

  private emitClick(event: Event, hit: Hit): void {
    // Lê tudo antes de qualquer await: o DOM pode mudar em seguida.
    // Overlays ficam fora da rota que os abriu: a última tela global pode
    // pertencer a outro MFE. Neles, somente a origem marcada é prova da tela.
    const overlay = DomEventTracker.elementsOf(event).some((element) =>
      element.matches('ion-modal, ion-popover, ion-alert, dialog, [role=dialog], [aria-modal=true]')
      || element.localName.endsWith('-modal'));
    const ownScreen = hit.descriptor ? { funcionalidade: hit.descriptor.funcionalidade, tela: hit.descriptor.tela } : DomEventTracker.markerScreen(hit.host);
    const captured = hit.screen ?? this.deps.surfaces?.screenFor(event, this.deps.owner);
    const portal = overlay || hit.host.hasAttribute('data-at-overlay-outputs') || !!hit.descriptor?.overlayOutputs?.length;
    const ancestor = DomEventTracker.screenOf(event, this.document, this.deps.mode ?? 'classic', this.deps.owner);
    const registeredScreen = captured ? ancestor ?? captured : null;
    const screen = hit.descriptor?.requireOrigin
      ? registeredScreen ?? (portal ? null : ancestor ?? this.deps.surfaces?.capture(this.deps.owner))
      : registeredScreen ?? (portal ? ownScreen : ancestor ?? ownScreen);
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
    const provenOptions = hit.descriptor?.rotulos ?? hit.host.getAttribute('data-at-rotulos')?.split('|').filter(Boolean);
    if (provenOptions?.length && !proven) {
      this.warnSafely(`[auto-tracking] rótulo de '${hit.id}' fora das alternativas comprovadas; evento não enviado`);
      return;
    }
    // Rótulo dinâmico comprovado pelo CLI: o texto atual vence o fallback gravado no build.
    const dynamic = (hit.descriptor?.rotuloDinamico ?? hit.host.getAttribute('data-at-rotulo-dinamico')?.split('|'))?.includes(hit.id) ?? false;
    const current = dynamic && labelSource ? DomEventTracker.currentLabel(labelSource) : '';
    if (dynamic && !proven && !current) {
      this.warnSafely(`[auto-tracking] rótulo público de '${hit.id}' indisponível; evento não enviado`);
      return;
    }
    const label = proven || current || slug(hit.fallbackLabel) || (labelSource ? slug(DomEventTracker.visibleLabel(labelSource)) : '') || slug(hit.id);
    const candidate = hit.host.getAttribute('data-at-option');
    if (candidate && /@|\d(?:[.\-\/ ]?\d){5,}/.test(candidate)
      || hit.descriptor?.click?.opcaoFonte === 'public-label' && !candidate?.trim()) {
      this.warnSafely(`[auto-tracking] opção pública de '${hit.id}' indisponível; evento não enviado`);
      return;
    }
    const allowed = hit.descriptor?.click?.opcaoPermitida ?? hit.host.getAttribute('data-at-option-allowed');
    // shortcut: marcadores legados não têm lista de valores; regerar tracking aplica a validação.
    const accessibleNumber = hit.descriptor?.click?.opcaoFonte === 'aria-label-numero'
      ? DomEventTracker.accessibleNumericOption(hit.host, allowed)
      : null;
    // Gatilho de clique de um output de mudança (seta, campo, botão interno) também abre a escolha.
    const changeOutput = DomEventTracker.outputsFor(hit.host, this.deps.mode ?? 'classic')
      .some((binding) => binding.id === hit.id && (binding.event === 'ionChange' || binding.event === 'change'));
    const opening = event.type === 'click' && (changeOutput || ['change', 'ionChange'].includes(hit.event ?? '') || hit.descriptor?.click?.event === 'ionChange'
      || hit.descriptor?.click?.event === 'change' || ['ionChange', 'change'].includes(hit.host.getAttribute('data-at-event') ?? ''));
    const option = event.type === 'click'
      ? opening ? null : hit.option ?? accessibleNumber ?? (candidate && (allowed === null || allowed.split('|').includes(candidate)) ? candidate : null)
      : event.type === 'submit' ? null : hit.option ?? DomEventTracker.selectedOption(hit.host, event);
    if (['change', 'ionChange'].includes(event.type) && !option) {
      this.warnSafely(`[auto-tracking] opção pública de '${hit.id}' indisponível; evento não enviado`);
      return;
    }
    if (event.type === 'click' && candidate && allowed !== null && !option) {
      this.warnSafely(`[auto-tracking] opção de '${hit.id}' fora dos valores comprovados; parâmetro não enviado`);
    }
    const element = hit.elemento ?? hit.descriptor?.click?.elemento ?? hit.host.getAttribute('data-at-elemento') ?? 'botao';
    const build = (environment: string, product: string): Params => {
      const base = DomEventTracker.baseParams(screen, environment, product);
      const params: Params = { ...base, categoria: base['tela']!, elemento: element, rotulo: label, acao: 'clique' };
      const selected = option ? slug(option) : '';
      if (selected) params['opcao_selecionada_1'] = selected;
      return params;
    };
    void this.dispatch('click', build, hit.id).catch((error) => this.warnSafely(`[auto-tracking] falha no envio: ${String(error)}`));
    if (event.type !== 'click' && this.pendingChoice?.id === hit.id) this.pendingChoice = null;
    if (opening) this.armChoice(event, hit);
  }

  /**
   * Overlay criado por código (modal/alert/action-sheet/popover) sem marcação: o gesto acionável usa a
   * tela visível do owner que o apresentou e o rótulo exibido. Só o owner dono da página emite.
   */
  private emitOverlayAction(event: Event): boolean {
    if (this.pendingChoice) return false; // escolha de select em curso: o próprio controle reporta o valor
    const path = DomEventTracker.elementsOf(event);
    const overlayIndex = path.findIndex((element) => element.matches(OVERLAY_SELECTOR));
    if (overlayIndex < 0) return false;
    const inner = path.slice(0, overlayIndex);
    // Overlay ou conteúdo com contrato da lib (ref, marcador ou superfície) segue esse contrato; aqui só o que nenhum cobre.
    if (path.slice(0, overlayIndex + 1).some((element) => element.hasAttribute('data-at-ref') || element.hasAttribute('data-at-id')
      || element.hasAttribute('data-at-outputs') || element.hasAttribute('data-at-overlay-outputs'))) return false;
    const actions = inner.filter((element) => element.matches(OVERLAY_ACTION_SELECTOR));
    // Parte interna de shadow DOM (ex.: <button> nativo do ion-button) só tem <slot>; o texto projetado está no host.
    const target = actions.find((element) => !(element.getRootNode() as { host?: Element }).host) ?? actions[0];
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return false;
    const screen = this.deps.surfaces?.capture(this.deps.owner);
    if (!screen) return false;
    const action = slug(DomEventTracker.currentLabel(target));
    const context = action ? DomEventTracker.overlayContext(path[overlayIndex]!, target) : '';
    const label = overlayActionLabel(action, context);
    if (!label) {
      this.warnSafely('[auto-tracking] ação de overlay sem rótulo público; evento não enviado');
      return true;
    }
    // O elemento clicado é o próprio overlay: diz ao produto em que tipo de janela a ação aconteceu.
    const elemento = DomEventTracker.overlayKind(path[overlayIndex]!);
    const build = (environment: string, product: string): Params => {
      const base = DomEventTracker.baseParams(screen, environment, product);
      return { ...base, categoria: base['tela']!, elemento, rotulo: label, acao: 'clique' };
    };
    void this.dispatch('click', build, `overlay-${label}`).catch((error) => this.warnSafely(`[auto-tracking] falha no envio: ${String(error)}`));
    return true;
  }

  /**
   * Abertura de overlay: `visualizacao` na tela visível do owner que o apresentou. Com contrato do CLI
   * (overlay inline ou raiz do componente apresentado), rótulo e tipo são os da planilha; sem ele, o nome público
   * do overlay. Overlay interno de um select já é o clique de abertura do controle.
   */
  private emitOverlayView(overlay: Element): void {
    if (!overlay.matches(`${OVERLAY_SELECTOR}, ${NATIVE_DIALOG_SELECTOR}`) || overlay.matches(SELECT_OVERLAY_SELECTOR) || this.pendingChoice) return;
    const mode = this.deps.mode ?? 'classic';
    const contract = [overlay, ...Array.from(overlay.querySelectorAll('[data-at-ref], [data-at-view]'))]
      .map((element) => DomEventTracker.viewOf(element, mode)).find((view) => view !== null);
    if (contract && contract.owner !== this.deps.owner) return;
    const screen = this.deps.surfaces?.capture(this.deps.owner) ?? (contract && !contract.requireOrigin ? contract.screen : null);
    if (!screen) {
      if (contract) this.warnSafely(`[auto-tracking] visualizacao '${contract.id}' não enviada: tela de origem não capturada`);
      return;
    }
    const elemento = contract?.elemento ?? DomEventTracker.overlayKind(overlay);
    const label = contract?.rotulo ?? DomEventTracker.overlayName(overlay);
    if (!label) {
      // Só o tipo ("modal") não diz ao produto qual overlay abriu: sem nome público não há visualização.
      this.warnSafely(`[auto-tracking] visualizacao de ${elemento} sem título nem componente identificável; evento não enviado`);
      return;
    }
    const build = (environment: string, product: string): Params => {
      const base = DomEventTracker.baseParams(screen, environment, product);
      return { ...base, categoria: base['tela']!, elemento, rotulo: label, acao: 'visualizacao' };
    };
    void this.dispatch('visualizacao', build, contract?.id ?? `overlay-${label}`).catch((error) => this.warnSafely(`[auto-tracking] falha no envio: ${String(error)}`));
  }

  /** Contrato de visualização gravado pelo CLI no elemento (token `ref` ou `data-at-view` no modo classic). */
  private static viewOf(element: Element, mode: TrackingMode): { owner: string; id: string; elemento: string; rotulo: string; screen: Screen | null; requireOrigin: boolean } | null {
    const descriptor = this.descriptorOf(element, mode);
    if (descriptor) return descriptor.view ? { owner: descriptor.owner, ...descriptor.view,
      screen: { funcionalidade: descriptor.funcionalidade, tela: descriptor.tela }, requireOrigin: !!descriptor.requireOrigin } : null;
    const [id, elemento, ...rotulo] = mode === 'ref' ? [] : (element.getAttribute('data-at-view') ?? '').split('|');
    const owner = element.getAttribute('data-at-owner');
    return id && elemento && rotulo.length && owner ? { owner, id, elemento, rotulo: rotulo.join('|'),
      screen: this.markerScreen(element), requireOrigin: element.getAttribute('data-at-origin') === 'required' } : null;
  }

  /**
   * Controle de escolha que abre seu próprio overlay atualiza o valor por código ao fechar:
   * o Ionic não emite ionChange nesse caso. A escolha é lida do valor exibido pelo controle.
   */
  private armChoice(event: Event, hit: Hit): void {
    const control = DomEventTracker.choiceControl(hit.host);
    if (!control) return;
    const before = (control as Element & { value?: unknown }).value;
    const path = event.composedPath();
    const type = hit.event === 'change' || hit.descriptor?.click?.event === 'change' ? 'change' : 'ionChange';
    this.pendingChoice = { id: hit.id, expires: Date.now() + 120_000, finish: () => {
      const after = (control as Element & { value?: unknown }).value;
      if (DomEventTracker.sameValue(before, after) || after === undefined || after === null || after === '') return false;
      // Evento interno: nunca é despachado no DOM, então não aciona handlers do aplicativo.
      const choice = { type, target: control, detail: { value: after }, composedPath: () => path } as unknown as Event;
      this.emitClick(choice, hit);
      return true;
    } };
  }

  /** Overlay fechado: o componente aplica o valor no mesmo ciclo; a leitura ocorre logo depois. */
  private settleChoice(): void {
    const pending = this.pendingChoice;
    if (!pending) return;
    if (Date.now() > pending.expires) { this.pendingChoice = null; return; }
    // Componentes abrem mais de um overlay (alert nativo + sheet próprio): fechamento sem mudança mantém a escolha pendente.
    const timer = setTimeout(() => {
      if (this.pendingChoice !== pending) return;
      try { if (pending.finish()) this.pendingChoice = null; } catch (error) { this.warnSafely(`[auto-tracking] escolha ignorada com segurança: ${String(error)}`); }
    }, 120);
    (timer as { unref?: () => void }).unref?.();
  }

  private static choiceControl(host: Element): Element | null {
    const selector = 'ion-select, select, ion-radio-group, ion-segment, ion-datetime';
    return host.matches(selector) ? host : host.querySelector(selector);
  }

  private static sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
    return a === b;
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
    for (const { id, event, selector, label: fallbackLabel, elemento } of outputs) {
      if (event !== eventName) continue;
      if (selector === ':host') return { id, labelSource: host, fallbackLabel, host, ...(elemento ? { elemento } : {}) };

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
      if (match) return { id, labelSource: match, fallbackLabel, host, ...(elemento ? { elemento } : {}) };
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

    const event: TrackingEvent = { name, params: DomEventTracker.fitSchema(name, build(environment, this.deps.product), this.deps.schema) };
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

  /**
   * Texto exibido no momento do clique: atributo acessível ou primeiro texto, sem
   * slots nomeados (badge, ícone) nem conteúdo oculto. Número longo (CPF, cartão,
   * protocolo) ou e-mail nunca é enviado: devolve vazio e o fallback semântico vale.
   */
  private static currentLabel(element: Element): string {
    let text = ['aria-label', 'label', 'title'].map((name) => element.getAttribute(name)).find((value) => !!value?.trim()) ?? '';
    if (!text) {
      const decorative = (node: Node): boolean => {
        for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement) {
          if (parent.hasAttribute('slot') || parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true'
            || ['script', 'style', 'option', 'ion-select-option'].includes(parent.localName)) return true;
        }
        return false;
      };
      // O rótulo pode ser composto de vários spans; opções/slots não fazem parte dele.
      const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */,
        { acceptNode: (node) => decorative(node) || !node.nodeValue?.trim() ? 3 /* FILTER_SKIP */ : 1 /* FILTER_ACCEPT */ });
      const parts: string[] = [];
      for (let node = walker.nextNode(); node && parts.length < 200; node = walker.nextNode()) parts.push(node.nodeValue!.trim());
      text = parts.join(' ');
    }
    return /@|\d(?:[.\-\/ ]?\d){5,}/.test(text) ? '' : labelSlug(text);
  }

  /** Título público do overlay (aria-labelledby, aria-label ou cabeçalho visível); sem título, o tipo do overlay. */
  private static overlayContext(overlay: Element, target: Element): string {
    return DomEventTracker.overlayTitle(overlay, target) || DomEventTracker.overlayKind(overlay);
  }

  private static overlayTitle(overlay: Element, target?: Element): string {
    const labelledBy = overlay.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => overlay.ownerDocument.getElementById(id))
      .find((element): element is HTMLElement => !!element);
    const heading = labelledBy ?? (overlay.hasAttribute('aria-label') ? overlay
      : Array.from(overlay.querySelectorAll(OVERLAY_TITLE_SELECTOR)).find((element) => !target || (!target.contains(element) && !element.contains(target))));
    return heading ? DomEventTracker.currentLabel(heading) : '';
  }

  /**
   * Nome do overlay na visualização: título público; sem ele, o componente apresentado
   * (`app-indisponibilidade-temporaria-modal` → `indisponibilidade-temporaria`); vazio quando nenhum existe.
   */
  private static overlayName(overlay: Element): string {
    // O componente apresentado é o elemento customizado mais próximo da raiz (Ionic: filho; CDK: dentro da superfície).
    let level = Array.from(overlay.children);
    let component: Element | undefined;
    for (let depth = 0; depth < 3 && level.length && !component; depth++) {
      component = level.find((element) => element.localName.includes('-') && !/^(?:ion|mat|cdk)-/.test(element.localName));
      level = level.flatMap((element) => Array.from(element.children));
    }
    const name = component ? overlayComponentName(component.localName) : '';
    return DomEventTracker.overlayTitle(overlay) || name;
  }

  private static overlayKind(overlay: Element): string {
    return OVERLAY_KIND[overlay.localName] ?? 'modal';
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
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (target?.type === 'checkbox' && 'checked' in target) return String(target.checked);
    if (target?.type === 'radio') {
      const label = target.getAttribute('aria-label')?.trim()
        || Array.from(target.labels ?? []).map((item) => item.textContent?.trim()).filter(Boolean).join(' ');
      return label && !/@|\d(?:[.\-\/ ]?\d){5,}/.test(label) ? label : null;
    }
    const value = detail?.value ?? (target && 'selectedOptions' in target
      ? Array.from(target.selectedOptions, (option) => option.value)
      : target && 'value' in target ? target.value : undefined);
    if (value === undefined || value === null || value === '') return null;

    const values = Array.isArray(value) ? value : [value];
    const options = new Map<unknown, Element>();
    element.querySelectorAll('ion-select-option, option, ion-segment-button, ion-radio').forEach((option) => {
      const optionValue = (option as Element & { value?: unknown }).value;
      if (!options.has(optionValue)) options.set(optionValue, option);
    });
    const labels = values.map((item) => {
        const option = options.get(item);
        // O valor técnico só liga evento e opção. Nunca é um fallback de Analytics.
        const text = option ? DomEventTracker.currentLabel(option) : '';
        return text || null;
      });
    return labels.every((label): label is string => label !== null) ? labels.join(',') : null;
  }

  /** Parâmetro complementar só sai se o schema do consumidor o aceita: nunca derruba o evento por isso. */
  static fitSchema(name: string, params: Params, schema: TrackingSchema): Params {
    const rule = schema[name];
    for (const optional of OPTIONAL_PARAMS) if (rule && !rule.allowedParams.includes(optional)) delete params[optional];
    return params;
  }

  static baseParams(screen: Screen, environment: string, product: string): Params {
    return { ambiente: environment, produto: product, funcionalidade: screen.funcionalidade, ...(subfuncionalidadeOf(screen.funcionalidade, screen.tela) ? { subfuncionalidade: screen.tela } : {}),
      tela: `${environment}:${product}:${screenPath(screen.funcionalidade, screen.tela)}` };
  }
}

export const resolveHit = (event: Event, mode: TrackingMode = 'classic'): Hit | null => DomEventTracker.resolveHit(event, mode);
export const screenOf = (event: Event, document: Document): Screen | null => DomEventTracker.screenOf(event, document);
export const findScreenMarker = (document: Document, selector: string): Element | null => DomEventTracker.findScreenMarker(document, selector);
export const installDomTracker = (document: Document, deps: DomTrackerDeps): (() => void) => new DomEventTracker(document, deps).install();
export const emitScreenView = (document: Document, selector: string, deps: DomTrackerDeps): boolean =>
  new DomEventTracker(document, deps).emitScreenView(selector);

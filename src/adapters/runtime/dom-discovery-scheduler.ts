/**
 * Busca incremental por marcadores. Nenhum callback de MutationObserver deve
 * percorrer uma árvore inteira, porque isso disputa a thread de renderização.
 * Cada fatia tem limite de nós E de tempo; o trabalho é cancelável no teardown.
 */
export class DomDiscoveryScheduler {
  private readonly pending: Element[] = [];
  private readonly queued = new Set<Element>();
  private iterator: TreeWalker | null = null;
  private currentRoot: Element | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private idleHandle: number | null = null;
  private stopped = false;
  private overloadReported = false;
  private rescanAfterOverload = false;
  private readonly maxPendingRoots = 4096;

  constructor(
    private readonly document: Document,
    private readonly discover: (element: Element) => void,
    private readonly warn: (error: unknown) => void,
    private readonly maxNodes = 160,
    private readonly budgetMs = 3,
  ) {}

  start(root: Element): void {
    this.enqueue(root);
    // Registrar eventos customizados de um DOM pequeno ainda no bootstrap.
    // Em páginas grandes, o restante é transferido para fatias assíncronas.
    this.drain();
  }

  added(root: Element): void {
    if (this.stopped || !root.isConnected) return;
    // O próprio host é barato; evita perder CustomEvents de componentes lazy
    // que possam emitir logo depois da inserção.
    this.visit(root);
    this.enqueue(root, true);
  }

  changed(element: Element): void {
    if (!this.stopped && element.isConnected) this.visit(element);
  }

  stop(): void {
    this.stopped = true;
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    if (this.idleHandle !== null) this.document.defaultView?.cancelIdleCallback?.(this.idleHandle);
    this.idleHandle = null;
    this.iterator = null;
    this.currentRoot = null;
    this.pending.length = 0;
    this.queued.clear();
    this.rescanAfterOverload = false;
  }

  private report(error: unknown): void {
    try { this.warn(error); }
    catch (reporterError) {
      try { console.error('[auto-tracking] diagnóstico falhou:', error, reporterError); }
      catch { /* Nenhum callback de tracking deve interromper o DOM do aplicativo. */ }
    }
  }

  private visit(element: Element): void {
    try { this.discover(element); }
    catch (error) { this.report(error); }
  }

  private enqueue(root: Element, defer = false): void {
    if (this.stopped || this.queued.has(root)) return;
    // Um nó novo pode entrar em uma parte da árvore que o cursor já passou.
    // Portanto só deduplicar raízes ainda na fila, nunca a árvore em curso.
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (this.queued.has(ancestor)) return;
    }
    if (this.pending.length >= this.maxPendingRoots) {
      this.rescanAfterOverload = true;
      if (!this.overloadReported) {
        this.overloadReported = true;
        this.report(new Error('DOM_DISCOVERY_OVERLOAD: limite temporário de fila; varredura incremental de recuperação agendada'));
      }
      return;
    }
    this.pending.push(root);
    this.queued.add(root);
    if (defer) this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.nextTimer !== null || this.idleHandle !== null) return;
    const view = this.document.defaultView;
    if (view?.requestIdleCallback) {
      // Priorizar frames e gestos da aplicação. O timeout garante progresso
      // mesmo em animações/transições Ionic contínuas.
      this.idleHandle = view.requestIdleCallback(() => {
        this.idleHandle = null;
        this.advance();
      }, { timeout: 250 });
    } else {
      // WebViews antigas: ceder um frame em vez de criar um loop setTimeout(0).
      this.nextTimer = setTimeout(() => {
        this.nextTimer = null;
        this.advance();
      }, 16);
    }
  }

  private advance(): void {
    try { this.drain(); }
    catch (error) {
      this.report(error);
      // Descartar apenas o cursor danificado. Nunca perpetuar uma falha
      // assíncrona nem bloquear o carregamento do aplicativo.
      this.iterator = null;
      this.currentRoot = null;
      if (!this.stopped && this.pending.length) this.schedule();
    }
  }

  private drain(): void {
    if (this.stopped) return;
    const started = performance.now();
    let visited = 0;
    // Respeitar o orçamento mesmo se performance.now() tiver pouca resolução.
    while (visited < this.maxNodes && performance.now() - started < this.budgetMs) {
      if (!this.iterator) {
        const root = this.pending.shift();
        if (!root) {
          if (!this.rescanAfterOverload) return;
          // Recupera marcadores atrasados sem manter uma fila ilimitada.
          this.rescanAfterOverload = false;
          this.enqueue(this.document.documentElement);
          continue;
        }
        this.queued.delete(root);
        if (!root.isConnected) continue;
        this.currentRoot = root;
        this.iterator = this.document.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
        this.visit(root);
        visited++;
        continue;
      }
      const node = this.iterator.nextNode();
      if (!node) {
        this.iterator = null;
        this.currentRoot = null;
        continue;
      }
      this.visit(node as Element);
      visited++;
    }
    if (this.iterator || this.pending.length) this.schedule();
  }
}

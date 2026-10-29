/** @jest-environment jsdom */
import { DomDiscoveryScheduler } from '../../src/adapters/runtime/dom-discovery-scheduler.js';

describe('descoberta incremental sem bloquear a thread principal', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { jest.useRealTimers(); });

  it('não processa uma árvore grande inteira durante o bootstrap e conclui por fatias', () => {
    jest.useFakeTimers();
    const root = document.createElement('section');
    root.innerHTML = Array.from({ length: 4000 }, (_, i) =>
      `<div><span data-at-ref="v1.${i}">item</span></div>`).join('');
    document.body.appendChild(root);
    let visited = 0;
    const scheduler = new DomDiscoveryScheduler(document, () => { visited++; }, (error) => { throw error; });
    scheduler.start(root);
    expect(visited).toBeGreaterThan(0);
    expect(visited).toBeLessThanOrEqual(160);
    jest.runAllTimers();
    expect(visited).toBe(8001);
    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('usa idle callback quando disponível e cancela no teardown', () => {
    const originalIdle = window.requestIdleCallback;
    const originalCancel = window.cancelIdleCallback;
    const callbacks: Array<() => void> = [];
    const requests = jest.fn((callback: () => void) => {
      callbacks.push(callback);
      return 93;
    });
    const cancel = jest.fn();
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: requests });
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: cancel });
    const root = document.createElement('main');
    root.innerHTML = '<button></button>'.repeat(1000);
    document.body.appendChild(root);
    let visited = 0;
    const scheduler = new DomDiscoveryScheduler(document, () => { visited++; }, (error) => { throw error; });
    try {
      scheduler.start(root);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(visited).toBeLessThan(1000);
      const before = visited;
      scheduler.stop();
      expect(cancel).toHaveBeenCalledWith(93);
      callbacks[0]!();
      expect(visited).toBe(before);
    } finally {
      scheduler.stop();
      Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: originalIdle });
      Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: originalCancel });
    }
  });

  it('cancela trabalho pendente e não analisa mais elementos após desmontar', () => {
    jest.useFakeTimers();
    const root = document.createElement('main');
    root.innerHTML = '<button></button>'.repeat(2000);
    document.body.appendChild(root);
    let visited = 0;
    const scheduler = new DomDiscoveryScheduler(document, () => { visited++; }, (error) => { throw error; });
    scheduler.start(root);
    const before = visited;
    scheduler.stop();
    jest.runAllTimers();
    expect(visited).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sob sobrecarga limita a fila, informa diagnóstico e recupera marcadores não visitados', () => {
    jest.useFakeTimers();
    const root = document.createElement('main');
    document.body.appendChild(root);
    const visited = new Set<string>();
    const warnings: string[] = [];
    const scheduler = new DomDiscoveryScheduler(document,
      (element) => { if (element.id) visited.add(element.id); },
      (error) => { warnings.push(String(error)); });
    scheduler.start(root);
    // Mutação massiva após um clique: mais raízes que o limite de memória.
    for (let i = 0; i < 4200; i++) {
      const section = document.createElement('section');
      section.innerHTML = '<span id="item-' + i + '"></span>';
      root.appendChild(section);
      scheduler.added(section);
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('DOM_DISCOVERY_OVERLOAD');
    jest.runAllTimers();
    expect(visited.has('item-4199')).toBe(true);
    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('elemento recém-inserido é descoberto imediatamente e restante é fatiado', () => {
    jest.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const discovered: string[] = [];
    const scheduler = new DomDiscoveryScheduler(document,
      (node) => { if (node.id) discovered.push(node.id); }, (error) => { throw error; });
    scheduler.start(root);
    const added = document.createElement('section');
    added.id = 'host';
    added.innerHTML = Array.from({ length: 800 }, (_, i) => `<div id="n${i}"></div>`).join('');
    root.appendChild(added);
    scheduler.added(added);
    expect(discovered).toContain('host');
    expect(discovered.length).toBeLessThan(800);
    jest.runAllTimers();
    expect(discovered).toContain('n799');
    scheduler.stop();
  });
});

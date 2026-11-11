/** @jest-environment jsdom */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AngularComponentCatalogBuilder } from '../../src/adapters/angular-compiler/component-catalog.js';
import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import { methodDelegate } from '../../src/application/apply/selection-provenance.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import type { ComponentDef } from '../../src/application/apply/ports/component-catalog.js';
import type { ComponentInfo } from '../../src/application/apply/ports/project-index.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const write = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

/** Diretiva de gesto de uma biblioteca qualquer: o nome não importa, o motor lê o seletor e o emit da própria classe. */
const gesture: ComponentDef = {
  selectors: [], attributes: ['meugesto'], source: 'ui-kit', outputs: new Map([['gestoEsquerda', 'gestoEsquerda'], ['semEmit', 'semEmit']]),
  inputs: new Set(), template: '', hostListeners: [], methods: new Map([['fimDoToque', 'if (dx > 150) this.gestoEsquerda.emit(event);']]),
};
const twin: ComponentDef = { ...gesture, attributes: ['outrogesto'] };
const catalogOf = (...defs: ComponentDef[]) => ({
  get: () => undefined,
  directive: (attributes: readonly string[], output: string) => {
    const found = defs.filter((def) => def.attributes!.some((name) => attributes.map((item) => item.toLowerCase()).includes(name)) && def.outputs.has(output));
    return found.length === 1 ? found[0] : undefined;
  },
});
const ctx = (over: Partial<TagContext> = {}): TagContext => ({
  owner: 'app', relFile: 'src/app/pedido/pedido.page.html', funcionalidade: 'pedido', tela: 'pedido', isScreen: false,
  catalog: catalogOf(gesture), usedIds: new Set(), mode: 'ref', ...over,
});
const tokenOf = (html: string) => decodeTrackingToken(/data-at-ref="([^"]+)"/.exec(html)![1]!)!;

describe('gesto reconhecido em código por diretiva de atributo', () => {
  it('output emitido pela diretiva é o mesmo evento do botão voltar, em qualquer elemento', () => {
    const result = tagTemplate('<ion-content meuGesto (gestoEsquerda)="voltar()"><h1>Pedido</h1><p>{{ pedido.texto }}</p></ion-content>', ctx());
    expect(result.entries.map((entry) => [entry.evento, entry.elemento, entry.rotulo, entry.acao])).toEqual([['click', 'botao', 'voltar', 'clique']]);
    expect(tokenOf(result.html).outputs!.map((output) => [output.event, output.selector])).toEqual([['emit:gestoEsquerda', ':host']]);
    expect(result.html).not.toContain('data-at-label');
    expect(tagTemplate(result.html, ctx()).html).toBe(result.html);
  });

  it('handler que só embrulha o gesto é nomeado pelo método que ele chama', () => {
    const result = tagTemplate('<div meuGesto (gestoEsquerda)="ajustaSwipe()"></div>', ctx({ methodDelegate: (method) => (method === 'ajustaSwipe' ? 'voltarPaginaAnterior' : null) }));
    expect(result.entries.map((entry) => entry.rotulo)).toEqual(['voltar']);
  });

  it.each([
    ['output que a diretiva nunca emite no código', '<div meuGesto (semEmit)="voltar()"></div>', catalogOf(gesture)],
    ['diretiva ausente do elemento', '<div (gestoEsquerda)="voltar()"></div>', catalogOf(gesture)],
    ['duas diretivas com o mesmo output no elemento', '<div meuGesto outroGesto (gestoEsquerda)="voltar()"></div>', catalogOf(gesture, twin)],
  ])('%s: sem evento', (_case, html, catalog) => {
    const result = tagTemplate(html, ctx({ catalog }));
    expect(result.entries).toEqual([]);
    expect(result.html).not.toContain('data-at-');
  });
});

describe('voltar em linguagem de produto', () => {
  it.each([
    ['voltarPaginaAnterior()', 'voltar'],
    ['voltarPagina()', 'voltar'],
    ['voltarParaTelaAnterior()', 'voltar'],
    ['voltarAoInicio()', 'voltar-inicio'],
  ])('%s → %s', (handler, rotulo) => {
    expect(tagTemplate(`<ion-icon (click)="${handler}"></ion-icon>`, ctx()).entries[0]!.rotulo).toBe(rotulo);
  });
});

describe('método que só embrulha outro', () => {
  const delegate = methodDelegate({ methods: new Map([
    ['ajustaSwipe', "{ this.tema === '' ? this.voltarPagina() : null; }"],
    ['voltarPagina', '{ this.navCtrl.back(); }'],
    ['salvar', '{ this.validar(); this.enviar(); }'],
    ['validar', '{ }'], ['enviar', '{ }'],
    ['cadeia', '{ if (this.ok) { this.ajustaSwipe(); } }'],
  ]) } as unknown as ComponentInfo);

  it.each([['ajustaSwipe', 'voltarPagina'], ['cadeia', 'voltarPagina'], ['salvar', null], ['voltarPagina', null], ['inexistente', null]])('%s → %s', (method, expected) => {
    expect(delegate(method)).toBe(expected);
  });
});

describe('catálogo lê diretiva de atributo de pacote pelo seletor declarado', () => {
  it('qualquer nome de diretiva usada no template entra; não usada fica fora', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-directive-'));
    try {
      write(root, 'package.json', JSON.stringify({ dependencies: { 'ui-kit': '1.0.0' } }));
      write(root, 'node_modules/ui-kit/fesm2022/ui-kit.mjs', `
        class GestoDirective { fim(e) { if (e) this.esquerda.emit(e); } }
        GestoDirective.ɵdir = i0.ɵɵngDeclareDirective({ type: GestoDirective, selector: '[qualquerNome]', outputs: { esquerda: 'esquerda' } });
        class NaoUsada { x() { this.y.emit(); } }
        NaoUsada.ɵdir = i0.ɵɵngDeclareDirective({ type: NaoUsada, selector: '[naoUsada]', outputs: { y: 'y' } });
      `);
      const page: ComponentDef = { selectors: ['app-page'], source: 'projeto', outputs: new Map(), inputs: new Set(),
        template: '<ion-content qualquerNome (esquerda)="voltar()"></ion-content>', methods: new Map(), hostListeners: [] };
      const catalog = new AngularComponentCatalogBuilder().buildCatalog(root, [page]);
      expect(catalog.directive!(['qualquerNome'], 'esquerda')?.attributes).toEqual(['qualquernome']);
      expect(catalog.directive!(['naoUsada'], 'y')).toBeUndefined();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('ponta a ponta: diretiva do projeto, relatório, planilha e envio', () => {
  it('swipe e botão voltar na mesma tela saem iguais e são uma linha só', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-directive-e2e-'));
    const sent: TrackingEvent[] = [];
    let listener: (() => void) | null = null;
    const tracker = new DomEventTracker(document, { owner: 'app', product: 'loja', schema: examplePreset.schema, mode: 'ref',
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {},
      subscribeOutput: (_host, output, notify) => { if (output !== 'gestoEsquerda') return null; listener = notify; return () => { listener = null; }; } });
    const stop = tracker.install();
    try {
      write(root, 'angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
      write(root, 'tsconfig.app.json', '{}');
      write(root, 'package.json', '{}');
      write(root, 'auto-tracking.config.ts', `export default defineAutoTrackingProject({
        projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
        runtime: { owner: 'app', root: 'app-root', product: 'loja', preset: examplePreset, mode: 'ref', send: () => {} } });`);
      write(root, 'src/app/routes.ts', `import { PedidoPage } from './pedido/pedido.page';
        export const routes = [{ path: 'pedido', component: PedidoPage }]; const providers = [provideAutoTracking(config.runtime)];`);
      write(root, 'src/app/gesto.directive.ts', `@Directive({ selector: '[gestoVoltar]' })
        export class GestoDirective { @Output() gestoEsquerda = new EventEmitter<void>(); fim(dx: number) { if (dx > 150) this.gestoEsquerda.emit(); } }`);
      write(root, 'src/app/pedido/pedido.page.ts', `@Component({ selector: 'app-pedido', templateUrl: './pedido.page.html' })
        export class PedidoPage { voltar() {} ajustaSwipe() { this.voltar(); } }`);
      write(root, 'src/app/pedido/pedido.page.html', `<ion-header><ion-button (click)="voltar()"><ion-icon name="arrow-back"></ion-icon></ion-button></ion-header>
        <ion-content gestoVoltar (gestoEsquerda)="ajustaSwipe()"><h1>Pedido</h1></ion-content>`);
      const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
      for (const change of result.changes) fs.writeFileSync(change.file, change.after);
      const entries = (JSON.parse(result.relatorio) as { entries: { origem: string; eventos: Record<string, string>[] }[] }).entries;
      const payloads = entries.flatMap((entry) => entry.eventos.map((params) => JSON.stringify(params)));
      expect(payloads.filter((payload) => payload.includes('"rotulo":"voltar"'))).toHaveLength(2);
      expect(new Set(payloads.filter((payload) => payload.includes('"rotulo":"voltar"'))).size).toBe(1);

      const html = fs.readFileSync(path.join(root, 'src/app/pedido/pedido.page.html'), 'utf8');
      document.body.innerHTML = `<app-root><app-pedido>${html}</app-pedido></app-root>`;
      tracker.emitScreenView('app-pedido');
      // A descoberta de marcadores cede frames ao app; espera até ela chegar ao host.
      for (let frame = 0; frame < 20 && !listener; frame++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(listener).not.toBeNull();
      listener!();
      document.querySelector('ion-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const clicks = sent.filter((event) => event.name === 'click').map((event) => JSON.stringify(event.params));
      expect(clicks).toHaveLength(2);
      expect(clicks[0]).toBe(clicks[1]);
      expect(JSON.parse(clicks[0]!)).toMatchObject({ rotulo: 'voltar', elemento: 'botao', acao: 'clique' });
    } finally { stop(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});

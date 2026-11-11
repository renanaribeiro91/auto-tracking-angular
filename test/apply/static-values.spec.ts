/** @jest-environment jsdom */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** Catálogo constante em outro arquivo, filtrado e remapeado na página: o que o template mostra é um subconjunto dele. */
const CATALOGO = `export const catalogo = [
  { titulo: 'Compras', itens: [{ nome: 'Ver pedidos', rota: ['pedidos'], acao: () => null }, { nome: 'Trocar produto', rota: ['trocas'] }] },
  { titulo: 'Conta', itens: [{ nome: 'Alterar senha de acesso', rota: ['senha'] }] },
];`;

function project(page: string): { root: string; labels: () => Record<string, string>; dispose: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-static-values-'));
  write(root, 'angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
  write(root, 'tsconfig.app.json', '{}');
  write(root, 'package.json', '{}');
  write(root, 'auto-tracking.config.ts', `export default defineAutoTrackingProject({
    projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
    runtime: { owner: 'app', root: 'app-root', product: 'loja', preset: examplePreset, mode: 'ref', send: () => {} } });`);
  write(root, 'src/app/routes.ts', `import { HubPage } from './hub/hub.page';
    export const routes = [{ path: 'hub', component: HubPage }]; const providers = [provideAutoTracking(config.runtime)];`);
  write(root, 'src/app/hub/catalogo.data.ts', CATALOGO);
  write(root, 'src/app/hub/hub.page.ts', page);
  write(root, 'src/app/hub/hub.page.html', `@for (secao of secoes; track secao.titulo) {
    <h2>{{ secao.titulo }}</h2>
    @for (item of secao.itens; track item.rota) {
      <button class="item" [attr.aria-label]="item.nome" (click)="abrir(item)"><span>{{ item.nome }}</span></button>
    }
  }`);
  const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
  for (const change of result.changes) fs.writeFileSync(change.file, change.after);
  fs.mkdirSync(result.paths.outputDir, { recursive: true });
  fs.writeFileSync(result.paths.relatorioFile, result.relatorio);
  return {
    root,
    labels: () => Object.fromEntries((JSON.parse(result.relatorio) as { entries: { evento: string; eventos: Record<string, string>[] }[] }).entries
      .filter((entry) => entry.evento === 'click').flatMap((entry) => entry.eventos.map((params) => [params['tela']!, params['rotulo']!]))),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const filtered = `import { catalogo } from './catalogo.data';
  @Component({ selector: 'app-hub', templateUrl: './hub.page.html' })
  export class HubPage {
    secoes = this.montar();
    constructor(private store: Store) { this.store.select(x).subscribe((cliente) => { this.secoes = this.montar(cliente); }); }
    abrir(item) {}
    private montar(cliente?: Cliente) {
      const completo = !!cliente?.premium;
      return catalogo.map((secao) => ({ ...secao, itens: completo ? secao.itens : secao.itens.filter((item) => !item.rota.includes('trocas')) }))
        .filter((secao) => secao.itens.length > 0);
    }
  }`;

describe('lista constante transformada e laço aninhado: rótulos provados pelo código', () => {
  it('constante importada + map com spread + filter + ternário + retorno de método: a tela lista o que pode aparecer', () => {
    const p = project(filtered);
    try {
      expect(p.labels()).toEqual({ '{ambiente}:loja:hub': 'Um de: ver-pedidos; trocar-produto; alterar-senha-de-acesso' });
    } finally { p.dispose(); }
  });

  it.each([
    ['lista vinda da store', `@Component({ selector: 'app-hub', templateUrl: './hub.page.html' })
      export class HubPage { secoes = []; constructor(private store: Store) { this.store.select(x).subscribe((s) => { this.secoes = s; }); } abrir(item) {} }`],
    ['lista mutada no lugar', `import { catalogo } from './catalogo.data';
      @Component({ selector: 'app-hub', templateUrl: './hub.page.html' })
      export class HubPage { secoes = [...catalogo]; ngOnInit() { this.secoes.push(this.extra); } abrir(item) {} }`],
    ['spread de valor de runtime', `import { catalogo } from './catalogo.data';
      @Component({ selector: 'app-hub', templateUrl: './hub.page.html' })
      export class HubPage { @Input() extra; secoes = catalogo.map((secao) => ({ ...this.extra, ...secao })); abrir(item) {} }`],
  ])('%s: não é prova; nenhuma lista é inventada a partir do catálogo', (_case, page) => {
    const p = project(page);
    try {
      const rotulo = Object.values(p.labels())[0]!;
      expect(rotulo).not.toMatch(/^Um de:|ver-pedidos|trocar-produto|alterar-senha/);
    } finally { p.dispose(); }
  });

  it('o runtime envia o texto exibido e ele está na lista que o relatório promete', async () => {
    const p = project(filtered);
    const sent: TrackingEvent[] = [];
    const tracker = new DomEventTracker(document, { owner: 'app', product: 'loja', schema: examplePreset.schema, mode: 'ref',
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    const stop = tracker.install();
    try {
      const html = fs.readFileSync(path.join(p.root, 'src/app/hub/hub.page.html'), 'utf8');
      const marker = /<h2[^>]*>/.exec(html)![0];
      const button = /<button[^>]*>/.exec(html)![0].replace(/\[attr\.aria-label\]="[^"]*"/, 'aria-label="Trocar produto"');
      document.body.innerHTML = `<app-root><app-hub>${marker}Compras</h2>${button}<span>Trocar produto</span></button></app-hub></app-root>`;
      tracker.emitScreenView('app-hub');
      document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const click = sent.find((event) => event.name === 'click')!;
      expect(click.params['rotulo']).toBe('trocar-produto');
      expect(p.labels()['{ambiente}:loja:hub']!.replace(/^Um de: /, '').split('; ')).toContain(click.params['rotulo']);
    } finally { stop(); p.dispose(); }
  });
});

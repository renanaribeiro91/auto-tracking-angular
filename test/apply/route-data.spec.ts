/** @jest-environment jsdom */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AngularProjectIndexer } from '../../src/adapters/angular-compiler/project-index.js';
import { routeDataLabels } from '../../src/application/apply/route-data.js';
import { UNPROVEN_ROUTE_VALUE, type ComponentInfo, type RouteChain } from '../../src/application/apply/ports/project-index.js';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** `data` efetivo de cada caminho em que a classe é a tela. */
function routeData(files: Record<string, string>, className: string): Record<string, unknown> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-route-data-'));
  try {
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    const index = new AngularProjectIndexer().buildProjectIndex(root);
    const key = index.components.find((component) => component.className === className)!.key;
    return Object.fromEntries((index.routeChains?.get(key) ?? []).map((chain) => [chain.pattern, chain.data]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const page = (name: string) => `@Component({ selector: 'app-${name.toLowerCase()}', template: '<p>x</p>' }) export class ${name} {}`;

describe('data da rota: valor efetivo como o Angular entrega', () => {
  it('filho de caminho vazio e filho de pai sem componente herdam; o próprio vence; filho de pai com componente não herda', () => {
    const data = routeData({
      'pages.ts': `${page('HubPage')} ${page('DetalhePage')} ${page('ListaPage')} ${page('ItemPage')}`,
      'routes.ts': `import { HubPage, DetalhePage, ListaPage, ItemPage } from './pages';
        const routes: Routes = [
          { path: 'loja', data: { area: 'loja', titulo: 'Loja' }, children: [
            { path: '', component: HubPage },
            { path: 'detalhe', component: DetalhePage, data: { titulo: 'Detalhe' } },
          ] },
          { path: 'lista', component: ListaPage, data: { area: 'lista' }, children: [{ path: 'item', component: ItemPage }] },
        ];
        @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
    }, 'HubPage');
    expect(data).toEqual({ loja: { area: 'loja', titulo: 'Loja' } });
    const detalhe = routeData({
      'pages.ts': `${page('HubPage')} ${page('DetalhePage')}`,
      'routes.ts': `import { HubPage, DetalhePage } from './pages';
        const routes: Routes = [{ path: 'loja', data: { area: 'loja', titulo: 'Loja' }, children: [{ path: 'detalhe', component: DetalhePage, data: { titulo: 'Detalhe' } }] }];
        @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
    }, 'DetalhePage');
    expect(detalhe).toEqual({ 'loja/detalhe': { area: 'loja', titulo: 'Detalhe' } });
    const item = routeData({
      'node_modules/@angular/router/package.json': JSON.stringify({ version: '20.3.0' }),
      'pages.ts': `${page('ListaPage')} ${page('ItemPage')}`,
      'routes.ts': `import { ListaPage, ItemPage } from './pages';
        const routes: Routes = [{ path: 'lista', component: ListaPage, data: { area: 'lista' }, children: [{ path: 'item', component: ItemPage }] }];
        @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
    }, 'ItemPage');
    expect(item).toEqual({ 'lista/item': undefined });
  });

  const lojaRoutes = (extra = '') => `import { ListaPage, ItemPage } from './pages';
    const routes: Routes = [{ path: 'lista', component: ListaPage, data: { area: 'lista' }, children: [{ path: 'item', component: ItemPage }] }];
    @NgModule({ imports: [RouterModule.forRoot(routes${extra})] }) export class AppRoutingModule {}`;
  const router = (version: string) => ({ 'node_modules/@angular/router/package.json': JSON.stringify({ version }) });
  const lista = { 'pages.ts': `${page('ListaPage')} ${page('ItemPage')}` };

  it('herança segue a estratégia do projeto: configurada no código, senão o padrão da versão instalada (emptyOnly até a v21, always na v22)', () => {
    expect(routeData({ ...lista, ...router('20.3.0'), 'routes.ts': lojaRoutes() }, 'ItemPage')).toEqual({ 'lista/item': undefined });
    expect(routeData({ ...lista, ...router('22.0.0'), 'routes.ts': lojaRoutes() }, 'ItemPage')).toEqual({ 'lista/item': { area: 'lista' } });
    expect(routeData({ ...lista, ...router('20.3.0'), 'routes.ts': lojaRoutes(", { paramsInheritanceStrategy: 'always' }") }, 'ItemPage')).toEqual({ 'lista/item': { area: 'lista' } });
    expect(routeData({ ...lista, ...router('22.1.0'), 'routes.ts': lojaRoutes(", { paramsInheritanceStrategy: 'emptyOnly' }") }, 'ItemPage')).toEqual({ 'lista/item': undefined });
    // Sem versão nem configuração: só vale o que as duas estratégias dão igual.
    expect(routeData({ ...lista, 'routes.ts': lojaRoutes() }, 'ItemPage')).toEqual({ 'lista/item': null });
    expect(routeData({ ...lista, 'routes.ts': lojaRoutes() }, 'ListaPage')).toEqual({ lista: { area: 'lista' } });
  });

  it('resolver e resource vencem o data estático: a chave resolvida não é prova; resolve não literal tira a prova toda', () => {
    const data = routeData({
      'pages.ts': page('HubPage'), ...router('20.3.0'),
      'routes.ts': `import { HubPage } from './pages';
        const routes: Routes = [
          { path: 'a', component: HubPage, data: { opcoes: [{ titulo: 'Fixa' }], titulo: 'Hub' }, resolve: { opcoes: OpcoesResolver } },
          { path: 'b', component: HubPage, data: { titulo: 'Hub' }, resolve: resolvers },
        ];
        @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
    }, 'HubPage');
    expect(data['a']).toEqual({ opcoes: UNPROVEN_ROUTE_VALUE, titulo: 'Hub' });
    expect(data['b']).toBeNull();
  });

  it('constante importada vira valor; chamada, spread e variável de runtime ficam não provados', () => {
    const data = routeData({
      'pages.ts': page('HubPage'),
      'opcoes.ts': `export const OPCOES = [{ titulo: 'Primeira' }];`,
      'routes.ts': `import { HubPage } from './pages'; import { OPCOES } from './opcoes';
        const routes: Routes = [
          { path: 'a', component: HubPage, data: { opcoes: OPCOES, extra: carregar(), lista: [...OPCOES] } },
          { path: 'b', component: HubPage, data: montarData() },
        ];
        @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
    }, 'HubPage');
    expect(data['a']).toEqual({ opcoes: [{ titulo: 'Primeira' }], extra: UNPROVEN_ROUTE_VALUE, lista: UNPROVEN_ROUTE_VALUE });
    expect(data['b']).toBeNull();
  });
});

describe('membro da página alimentado pelo data da rota: cada forma do Angular, e quando não é prova', () => {
  const chains: RouteChain[] = [
    { pattern: 'pedidos/opcoes', segments: ['pedidos', 'opcoes'], data: { opcoes: [{ titulo: 'Novo pedido' }, { titulo: 'Acompanhar pedido' }], titulo: 'Pedidos' } },
    { pattern: 'conta/opcoes', segments: ['conta', 'opcoes'], data: { opcoes: [{ titulo: 'Alterar senha de acesso do app' }] } },
  ];
  const labels = (classText: string, options: { inputBinding?: boolean; onlyRouted?: boolean; routes?: RouteChain[]; field?: string | undefined; member?: string } = {}) =>
    routeDataLabels({ classText } as ComponentInfo, options.routes ?? chains, !!options.inputBinding, options.onlyRouted ?? true)(options.member ?? 'opcoes', 'field' in options ? options.field : 'titulo');
  const expected = new Map([['pedidos/opcoes', ['novo-pedido', 'acompanhar-pedido']], ['conta/opcoes', ['alterar-senha-de-acesso-do-app']]]);

  it.each([
    ['snapshot', 'opcoes = []; constructor(private route: ActivatedRoute) {} ngOnInit() { this.opcoes = this.route.snapshot.data[\'opcoes\']; }'],
    ['subscribe com operador neutro', 'opcoes; constructor(private route: ActivatedRoute) {} ngOnInit() { this.route.data.pipe(take(1)).subscribe((d) => { this.opcoes = d.opcoes; }); }'],
    ['parâmetro desestruturado', 'opcoes; private route = inject(ActivatedRoute); ngOnInit() { this.route.data.subscribe(({ opcoes }) => this.opcoes = opcoes); }'],
    ['cópia inteira com Object.assign', 'opcoes; constructor(private route: ActivatedRoute) { this.route.data.subscribe((d) => Object.assign(this, d)); }'],
    ['cópia inteira com Object.entries', 'opcoes; constructor(private route: ActivatedRoute) {} ngOnInit() { this.route.data.pipe(take(1)).subscribe((d) => { for (const [key, value] of Object.entries(d)) { this[key] = value; } }); }'],
    ['alias local do snapshot', 'opcoes; constructor(private route: ActivatedRoute) {} ngOnInit() { const { opcoes } = this.route.snapshot.data; this.opcoes = opcoes; }'],
  ])('%s: cada rota com a sua lista', (_form, body) => {
    expect(labels(`export class HubPage { ${body} }`)).toEqual(expected);
  });

  it('@Input e input() só valem com o router ligando data aos inputs', () => {
    expect(labels('export class HubPage { @Input() opcoes: Opcao[]; }', { inputBinding: true })).toEqual(expected);
    expect(labels('export class HubPage { opcoes = input<Opcao[]>(); }', { inputBinding: true })).toEqual(expected);
    expect(labels('export class HubPage { @Input() opcoes: Opcao[]; }')).toBeNull();
    // Rota sem a chave: o input recebe parâmetro de caminho ou de query, valor da URL.
    expect(labels('export class HubPage { @Input() opcoes: Opcao[]; }', { inputBinding: true, routes: [...chains, { pattern: 'x', segments: ['x'] }] })).toBeNull();
  });

  it.each([
    ['operador que transforma o valor', 'opcoes; constructor(private route: ActivatedRoute) {} ngOnInit() { this.route.data.pipe(map((d) => d.outras)).subscribe((d) => { this.opcoes = d.opcoes; }); }'],
    ['membro também escrito por outra fonte', 'opcoes; constructor(private route: ActivatedRoute, private api: Api) {} ngOnInit() { this.opcoes = this.route.snapshot.data.opcoes; this.api.get().subscribe((r) => this.opcoes = r); }'],
    ['valor inicial que aparece na tela', "opcoes = [{ titulo: 'Fixa' }]; constructor(private route: ActivatedRoute) {} ngOnInit() { this.opcoes = this.route.snapshot.data.opcoes; }"],
    ['data de outra fonte que não a ActivatedRoute', 'opcoes; constructor(private store: Store) {} ngOnInit() { this.store.data.subscribe((d) => Object.assign(this, d)); }'],
  ])('%s: não é prova', (_case, body) => {
    expect(labels(`export class HubPage { ${body} }`)).toBeNull();
  });

  const bulk = 'export class HubPage { opcoes; titulo; constructor(private route: ActivatedRoute) { this.route.data.subscribe((d) => Object.assign(this, d)); } }';

  it('rota sem a chave não renderiza o item; rota com valor não provado, data não provado ou página fora das rotas tiram a prova', () => {
    expect(labels(bulk, { routes: [...chains, { pattern: 'ajuda/opcoes', segments: ['ajuda', 'opcoes'] }] })?.get('ajuda/opcoes')).toEqual([]);
    expect(labels(bulk, { routes: [...chains, { pattern: 'x', segments: ['x'], data: { opcoes: UNPROVEN_ROUTE_VALUE } }] })).toBeNull();
    expect(labels(bulk, { routes: [...chains, { pattern: 'x', segments: ['x'], data: { opcoes: [{ titulo: UNPROVEN_ROUTE_VALUE }] } }] })).toBeNull();
    expect(labels(bulk, { routes: [...chains, { pattern: 'x', segments: ['x'], data: null }] })).toBeNull();
    expect(labels(bulk, { onlyRouted: false })).toBeNull();
    // Chave de código no lugar do texto exibido não é rótulo provado.
    expect(labels(bulk, { routes: [...chains, { pattern: 'x', segments: ['x'], data: { opcoes: [{ titulo: 'btn-opcao-x' }] } }] })).toBeNull();
    expect(labels(bulk, { routes: [...chains, { pattern: 'x', segments: ['x'], data: { opcoes: [{ titulo: 'menu.opcao_x' }] } }] })).toBeNull();
  });

  it('texto direto do membro (sem lista)', () => {
    expect(labels(bulk, { member: 'titulo', field: undefined })).toEqual(new Map([['pedidos/opcoes', ['pedidos']], ['conta/opcoes', []]]));
  });
});

/** Ponta a ponta: o que a planilha/relatório promete por tela é o que o runtime envia em cada rota. */
describe('página dirigida pelo data da rota: relatório por tela e envio na mesma prova', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-route-data-e2e-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  beforeAll(() => {
    write(root, 'angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write(root, 'tsconfig.app.json', '{}');
    write(root, 'package.json', '{}');
    write(root, 'auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      runtime: { owner: 'app', root: 'app-root', product: 'loja', preset: examplePreset, mode: 'ref', send: () => {} } });`);
    write(root, 'src/main.ts', `import { AppModule } from './app/app.module'; platformBrowserDynamic().bootstrapModule(AppModule);`);
    write(root, 'src/app/app.module.ts', `import { AppRoutingModule } from './app-routing.module';
      export const p = [provideAutoTracking(tracking.runtime)];
      @NgModule({ imports: [AppRoutingModule] }) export class AppModule {}`);
    write(root, 'src/app/app-routing.module.ts', `import { EscolhaPage } from './escolha/escolha.page';
      const routes: Routes = [
        { path: 'pedidos', children: [{ path: 'opcoes', component: EscolhaPage, data: { opcoes: [{ titulo: 'Novo pedido' }, { titulo: 'Acompanhar pedido' }] } }] },
        { path: 'conta', children: [{ path: 'opcoes', component: EscolhaPage, data: { opcoes: [{ titulo: 'Alterar senha de acesso' }] } }] },
      ];
      @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`);
    write(root, 'src/app/escolha/escolha.page.ts', `@Component({ selector: 'app-escolha', templateUrl: './escolha.page.html' })
      export class EscolhaPage { opcoes; constructor(private route: ActivatedRoute) {}
        ngOnInit() { this.route.data.pipe(take(1)).subscribe((d) => { for (const [k, v] of Object.entries(d)) { this[k] = v; } }); }
        abrir(opcao) {} }`);
    write(root, 'src/app/escolha/escolha.page.html', '<div class="lista"><button *ngFor="let opcao of opcoes" [title]="opcao.titulo" (click)="abrir(opcao)">{{ opcao.titulo }}</button></div>');
    const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    for (const change of result.changes) fs.writeFileSync(change.file, change.after);
    fs.mkdirSync(result.paths.outputDir, { recursive: true });
    fs.writeFileSync(result.paths.relatorioFile, result.relatorio);
  });

  const report = () => JSON.parse(fs.readFileSync(path.join(root, '.auto-tracking/relatorio.json'), 'utf8')) as {
    entries: { id: string; evento: string; eventos: Record<string, string>[] }[] };
  const click = () => report().entries.find((entry) => entry.evento === 'click')!;

  it('cada tela lista só o que a sua rota mostra; uma opção é o próprio rótulo', () => {
    expect(Object.fromEntries(click().eventos.map((params) => [params['tela'], params['rotulo']]))).toEqual({
      '{ambiente}:loja:pedidos:opcoes': 'Um de: novo-pedido; acompanhar-pedido',
      '{ambiente}:loja:conta:opcoes': 'alterar-senha-de-acesso',
    });
  });

  it('segunda execução não reescreve nada', () => {
    expect(new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts')).changes).toEqual([]);
  });

  it('o runtime envia o texto exibido em cada rota, dentro do que a tela promete', async () => {
    const sent: TrackingEvent[] = [];
    const tracker = new DomEventTracker(document, { owner: 'app', product: 'loja', schema: examplePreset.schema, mode: 'ref',
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    const stop = tracker.install();
    try {
      const html = fs.readFileSync(path.join(root, 'src/app/escolha/escolha.page.html'), 'utf8');
      // Como o Angular renderiza o item: sem as diretivas, com os bindings já avaliados para o texto da rota.
      const render = (titulo: string) => /<button[^>]*>/.exec(html)![0].replace(/\*ngFor="[^"]*"\s*/, '').replace(/\(click\)="[^"]*"\s*/, '')
        .replace(/\[attr\.data-at-option\]="[^"]*"/, `data-at-option="${titulo}"`).replace(/\[title\]="[^"]*"/, `title="${titulo}"`);
      for (const [pattern, titulo, rotulo] of [['pedidos/opcoes', 'Acompanhar pedido', 'acompanhar-pedido'], ['conta/opcoes', 'Alterar senha de acesso', 'alterar-senha-de-acesso']] as const) {
        sent.length = 0;
        const screenMarker = /<div[^>]*class="lista"[^>]*>/.exec(html)![0];
        document.body.innerHTML = `<app-root><app-escolha>${screenMarker}${render(titulo)}${titulo}</button></div></app-escolha></app-root>`;
        tracker.emitScreenView('app-escolha', pattern);
        document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const promised = click().eventos.find((params) => params['tela'] === `{ambiente}:loja:${pattern.replace('/', ':')}`)!;
        const clicked = sent.find((event) => event.name === 'click')!;
        expect(clicked.params['tela']).toBe(promised['tela']!.replace('{ambiente}', 'app-x'));
        expect(clicked.params['rotulo']).toBe(rotulo);
        expect(promised['rotulo']!.replace(/^Um de: /, '').split('; ')).toContain(rotulo);
      }
    } finally {
      stop();
    }
  });
});

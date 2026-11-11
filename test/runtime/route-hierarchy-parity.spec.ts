/** @jest-environment jsdom */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { AutoTrackingSurfaces, DomEventTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Paridade ponta a ponta: o que o relatório (e a planilha, mesma fonte) promete é exatamente o que o runtime envia,
 * na escadinha da rota, inclusive para página reutilizada em dois caminhos e botão sem texto repassado ao uso.
 */
describe('paridade relatório × envio na escadinha de rotas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-parity-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  beforeAll(() => {
    write(root, 'angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write(root, 'tsconfig.app.json', '{}');
    write(root, 'package.json', '{}');
    write(root, 'auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      runtime: { owner: 'app', root: 'app-root', product: 'saude', preset: examplePreset, mode: 'ref', send: () => {} } });`);
    write(root, 'src/main.ts', `import { AppModule } from './app/app.module';
      platformBrowserDynamic().bootstrapModule(AppModule);`);
    write(root, 'src/app/app.module.ts', `import { AppRoutingModule } from './app-routing.module';
      export const p = [provideAutoTracking(tracking.runtime)];
      @NgModule({ imports: [AppRoutingModule] }) export class AppModule {}`);
    write(root, 'src/app/app-routing.module.ts', `const routes: Routes = [
      { path: 'reembolso', loadChildren: () => import('./reembolso/reembolso.module').then((m) => m.ReembolsoModule) },
      { path: 'extratos', children: [{ path: 'opcao-extrato', component: EscolhaPage }] },
      { path: 'ajuda', loadChildren: () => import('./ajuda/ajuda.module').then((m) => m.AjudaModule) },
      { path: 'conta', component: ContaLayoutPage, children: [
        { path: '', redirectTo: 'perfil', pathMatch: 'full' },
        { path: 'perfil', component: PerfilPage },
        { path: 'seguranca', component: SegurancaPage },
      ] },
    ];
    @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`);
    write(root, 'src/app/reembolso/reembolso.module.ts', `import { ResumoPage } from './calcular/resumo/resumo.page';
      import { EscolhaPage } from '../escolha/escolha.page';
      const routes: Routes = [
        { path: 'opcao-reembolso', component: EscolhaPage },
        { path: 'calcular-reembolso', children: [{ path: 'resumo', component: ResumoPage }] },
        { path: 'solicitar', children: [{ path: 'inicio', component: SolicitarPage }] },
        { path: 'solicitar-v2', children: [{ path: 'inicio', component: SolicitarV2Page }] },
        { path: 'consulta-v2', component: ConsultaPage },
      ];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class ReembolsoModule {}`);
    write(root, 'src/app/reembolso/calcular/resumo/resumo.page.ts', `@Component({ selector: 'app-resumo', templateUrl: './resumo.page.html' })
      export class ResumoPage { mostrarModalDadosBancarios() {} enviar() {} }`);
    write(root, 'src/app/reembolso/calcular/resumo/resumo.page.html',
      '<div class="pagina"><app-ajuda (onClick)="mostrarModalDadosBancarios()"></app-ajuda><button id="enviar" (click)="enviar()">Enviar solicitação</button>'
      + '<app-dados-solicitante></app-dados-solicitante><app-dados-bebes></app-dados-bebes>'
      + '<button id="anexo" (click)="editarArchiveNota()"><ion-icon name="create"></ion-icon></button></div>');
    for (const [name, selector] of [['dados-solicitante', 'DadosSolicitante'], ['dados-bebes', 'DadosBebes']] as const) {
      write(root, `src/app/reembolso/calcular/resumo/${name}/${name}.component.ts`, `@Component({ selector: 'app-${name}', templateUrl: './${name}.component.html' })
        export class ${selector}Component { editar() {} }`);
      write(root, `src/app/reembolso/calcular/resumo/${name}/${name}.component.html`, `<button class="editar" (click)="editar()">Editar</button>`);
    }
    write(root, 'src/app/conta/conta-layout.page.ts', `@Component({ selector: 'app-conta-layout', templateUrl: './conta-layout.page.html' })
      export class ContaLayoutPage { sair() {} }`);
    write(root, 'src/app/conta/conta-layout.page.html', '<ion-header><button id="voltar-conta" (click)="sair()">Sair da conta</button></ion-header><ion-router-outlet></ion-router-outlet>');
    for (const [className, selector, text] of [['PerfilPage', 'app-perfil', 'Salvar perfil'], ['SegurancaPage', 'app-seguranca', 'Trocar senha']] as const) {
      write(root, `src/app/conta/${selector}.page.ts`, `@Component({ selector: '${selector}', template: '<div class="tela"><button (click)="ok()">${text}</button></div>' })
        export class ${className} { ok() {} }`);
    }
    write(root, 'src/app/ajuda/ajuda.module.ts', `import { AjudaPage } from './ajuda.page'; import { SessaoAjudaPage } from './sessao/sessao.page';
      const routes: Routes = [{ path: '', component: AjudaPage }, { path: 'iframe-ajuda', component: SessaoAjudaPage }];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class AjudaModule {}`);
    write(root, 'src/app/ajuda/ajuda.page.ts', `@Component({ selector: 'app-ajuda-page', template: '<button (click)="iniciar()">Iniciar</button>' })
      export class AjudaPage { iniciar() {} }`);
    write(root, 'src/app/ajuda/sessao/sessao.page.ts', `@Component({ selector: 'app-sessao-ajuda', template: '<button (click)="sair()">Sair</button>' })
      export class SessaoAjudaPage { sair() {} }`);
    for (const [file, className] of [['solicitar/solicitar.page', 'SolicitarPage'], ['solicitar-v2/solicitar-v2.page', 'SolicitarV2Page'], ['consulta/consulta.page', 'ConsultaPage']] as const) {
      write(root, `src/app/reembolso/${file}.ts`, `@Component({ selector: 'app-${className.toLowerCase()}', template: '<button (click)="ok()">Continuar</button>' })
        export class ${className} { ok() {} }`);
    }
    write(root, 'src/app/shared/components/ajuda/ajuda.component.ts', `@Component({ selector: 'app-ajuda', templateUrl: './ajuda.component.html' })
      export class AjudaComponent { @Output() onClick = new EventEmitter<void>(); handleClick() { this.onClick.emit(); } }`);
    write(root, 'src/app/shared/components/ajuda/ajuda.component.html',
      '<div class="ajuda" data-testid="btn-tooltip-info" (click)="handleClick()"><strong>?</strong></div>');
    write(root, 'src/app/escolha/escolha.page.ts', `@Component({ selector: 'app-escolha', templateUrl: './escolha.page.html' })
      export class EscolhaPage { voltar() {} }`);
    write(root, 'src/app/escolha/escolha.page.html', '<div class="escolha"><button id="voltar" (click)="voltar()">Voltar</button></div>');

    const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    for (const change of result.changes) fs.writeFileSync(change.file, change.after);
    fs.mkdirSync(result.paths.outputDir, { recursive: true });
    fs.writeFileSync(result.paths.relatorioFile, result.relatorio);
  });

  const report = () => JSON.parse(fs.readFileSync(path.join(root, '.auto-tracking/relatorio.json'), 'utf8')) as {
    entries: { id: string; evento: string; arquivo: string; eventos: Record<string, string>[] }[]; diagnostics: unknown[] };
  const html = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  /** O que o relatório promete, com o ambiente que o runtime resolve. */
  const promised = (id: string, tela: string) => {
    const entry = report().entries.find((item) => item.id === id)!;
    const params = entry.eventos.find((item) => item['tela'] === `{ambiente}:saude:${tela}`)!;
    return JSON.parse(JSON.stringify(params).replace(/\{ambiente\}/g, 'app-x'));
  };
  const sent: TrackingEvent[] = [];
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());
  const tracker = () => {
    sent.length = 0;
    const instance = new DomEventTracker(document, { owner: 'app', product: 'saude', schema: examplePreset.schema, mode: 'ref',
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    stop = instance.install();
    return instance;
  };

  it('relatório na escadinha: funcionalidade, subfuncionalidade do 2º nível e tela com o caminho inteiro', () => {
    const entries = report().entries;
    const resumo = entries.find((entry) => entry.evento === 'screen_view' && entry.eventos.some((item) => item['tela']!.endsWith('resumo')))!;
    expect(resumo.eventos[0]).toEqual({ ambiente: '{ambiente}', produto: 'saude', funcionalidade: 'reembolso',
      subfuncionalidade: 'calcular-reembolso', tela: '{ambiente}:saude:reembolso:calcular-reembolso:resumo' });
    expect(JSON.stringify(entries)).not.toMatch(/tooltip|escolha:/);
  });

  it('versão do código nunca chega ao produto: as duas gerações do fluxo são a mesma tela', () => {
    const screens = report().entries.filter((entry) => entry.evento === 'screen_view').flatMap((entry) => entry.eventos.map((item) => item['tela']));
    expect(screens).toEqual(expect.arrayContaining(['{ambiente}:saude:reembolso:solicitar:inicio', '{ambiente}:saude:reembolso:consulta']));
    expect(screens.join(' ')).not.toMatch(/-v\d/);
  });

  it('rota filha com outro componente nunca vira a tela do pai, nem quando a limpeza de produto a colapsaria', () => {
    const screens = report().entries.filter((entry) => entry.evento === 'screen_view').flatMap((entry) => entry.eventos.map((item) => item['tela']));
    expect(screens).toEqual(expect.arrayContaining(['{ambiente}:saude:ajuda', '{ambiente}:saude:ajuda:iframe-ajuda']));
    expect(screens.filter((tela) => tela === '{ambiente}:saude:ajuda')).toHaveLength(1);
  });

  it('layout que embrulha o outlet não é tela: sem screen_view nem marcador; o clique dele vale nas telas filhas', () => {
    const entries = report().entries.filter((entry) => entry.arquivo === 'src/app/conta/conta-layout.page.html');
    expect(entries.map((entry) => entry.evento)).toEqual(['click']);
    expect(entries[0]!.eventos.map((params) => params['tela'])).toEqual(['{ambiente}:saude:conta:perfil', '{ambiente}:saude:conta:seguranca']);
    expect(html('src/app/conta/conta-layout.page.html').match(/data-at-ref/g)).toHaveLength(1);
  });

  it('no runtime o clique do layout sai com a tela filha ativa, igual ao relatório', async () => {
    sent.length = 0;
    // Como o provideAutoTracking: a tela atual é a do componente roteado mais profundo.
    const surfaces = new AutoTrackingSurfaces('app', () => DomEventTracker.screenForHost(document, 'app-perfil', 'ref', 'app', 'conta/perfil'));
    const instance = new DomEventTracker(document, { owner: 'app', product: 'saude', schema: examplePreset.schema, mode: 'ref', surfaces,
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    stop = instance.install();
    const perfil = /template: '([^']*)'/.exec(html('src/app/conta/app-perfil.page.ts'))![1]!;
    document.body.innerHTML = `<app-root><app-conta-layout>${html('src/app/conta/conta-layout.page.html').replace('<ion-router-outlet></ion-router-outlet>', `<app-perfil>${perfil}</app-perfil>`)}</app-conta-layout></app-root>`;
    expect(instance.emitScreenView('app-perfil', 'conta/perfil')).toBe(true);
    await flush();
    sent.length = 0;
    document.getElementById('voltar-conta')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    const entry = report().entries.find((item) => item.arquivo === 'src/app/conta/conta-layout.page.html')!;
    expect(sent.map((event) => event.params)).toEqual([promised(entry.id, 'conta:perfil')]);
  });

  it('ações distintas com o mesmo texto na mesma tela levam o nome do bloco; código em inglês vira português', () => {
    const rotulos = report().entries.filter((entry) => entry.evento === 'click').map((entry) => entry.eventos[0]!['rotulo']);
    expect(rotulos).toEqual(expect.arrayContaining(['editar-dados-solicitante', 'editar-dados-bebes', 'editar-arquivo-nota']));
    expect(rotulos).not.toContain('editar');
  });

  it('segunda execução não reescreve nada (rótulos diferenciados são estáveis)', () => {
    expect(new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts')).changes).toEqual([]);
  });

  it('o rótulo diferenciado é o que o runtime envia', async () => {
    tracker();
    const page = html('src/app/reembolso/calcular/resumo/resumo.page.html')
      .replace(/(<app-dados-solicitante[^>]*>)/, `$1${html('src/app/reembolso/calcular/resumo/dados-solicitante/dados-solicitante.component.html')}`)
      .replace(/(<app-dados-bebes[^>]*>)/, `$1${html('src/app/reembolso/calcular/resumo/dados-bebes/dados-bebes.component.html')}`);
    document.body.innerHTML = `<app-root><app-resumo>${page}</app-resumo></app-root>`;
    document.querySelector('app-dados-bebes .editar')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    const entry = report().entries.find((item) => item.eventos.some((params) => params['rotulo'] === 'editar-dados-bebes'))!;
    expect(sent.map((event) => event.params)).toEqual([promised(entry.id, 'reembolso:calcular-reembolso:resumo')]);
  });

  it('screen_view e cliques enviados são os do relatório, na página reutilizada em dois caminhos', async () => {
    const instance = tracker();
    document.body.innerHTML = `<app-root><app-escolha>${html('src/app/escolha/escolha.page.html')}</app-escolha></app-root>`;
    for (const [pattern, tela] of [['reembolso/opcao-reembolso', 'reembolso:opcao-reembolso'], ['extratos/opcao-extrato', 'extratos:opcao-extrato']] as const) {
      sent.length = 0;
      instance.emitScreenView('app-escolha', `saude/${pattern}`);
      document.getElementById('voltar')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await flush();
      const screenId = report().entries.find((entry) => entry.evento === 'screen_view' && entry.eventos.some((item) => item['tela']!.endsWith('opcao-extrato')))!.id;
      const clickId = report().entries.find((entry) => entry.evento === 'click' && entry.eventos.some((item) => item['rotulo'] === 'voltar'))!.id;
      expect(sent.map((event) => event.params)).toEqual([promised(screenId, tela), promised(clickId, tela)]);
    }
  });

  it('botão sem texto do componente compartilhado sai uma vez, com o rótulo do uso, como no relatório', async () => {
    tracker();
    document.body.innerHTML = `<app-root><app-resumo>${html('src/app/reembolso/calcular/resumo/resumo.page.html')
      .replace(/(<app-ajuda[^>]*>)/, `$1${html('src/app/shared/components/ajuda/ajuda.component.html')}`)}</app-resumo></app-root>`;
    document.querySelector('.ajuda strong')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    const entry = report().entries.find((item) => item.evento === 'click' && item.eventos.some((params) => params['rotulo'] === 'mostrar-dados-bancarios'))!;
    expect(sent.map((event) => event.params)).toEqual([promised(entry.id, 'reembolso:calcular-reembolso:resumo')]);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AngularProjectIndexer } from '../../../src/adapters/angular-compiler/project-index.js';

/** Projeto mínimo em disco; cada arquivo é um trecho real do padrão Angular/Ionic testado. */
function project(files: Record<string, string>): { src: string; chains: (className: string) => string[]; unresolved: () => string[];
  declared: () => (readonly string[] | undefined)[]; dispose: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-routes-'));
  const src = path.join(root, 'src');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
  }
  const index = new AngularProjectIndexer().buildProjectIndex(src);
  const keyOf = (className: string) => index.components.find((component) => component.className === className)!.key;
  return {
    src,
    chains: (className) => (index.routeChains?.get(keyOf(className)) ?? []).map((chain) => `${chain.pattern} => ${chain.segments.join('>')}`),
    unresolved: () => (index.unresolvedRoutes ?? []).map((route) => route.specifier),
    declared: () => (index.unresolvedRoutes ?? []).map((route) => route.declared),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const page = (name: string, selector: string) => `import { Component } from '@angular/core';
@Component({ selector: '${selector}', template: '<button (click)="ok()">Ok</button>' })
export class ${name} { ok() {} }`;

describe('árvore de rotas: escadinha provada no código, qualquer arquitetura Angular/Ionic', () => {
  it('NgModule: forRoot → loadChildren de módulo com routing module separado (forChild) → página', () => {
    const p = project({
      'app/app-routing.module.ts': `const routes: Routes = [
        { path: '', redirectTo: 'home', pathMatch: 'full' },
        { path: 'reembolso', loadChildren: () => import('./reembolso/reembolso.module').then((m) => m.ReembolsoModule) },
      ];
      @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
      'app/reembolso/reembolso.module.ts': `import { ReembolsoRoutingModule } from './reembolso-routing.module';
      @NgModule({ imports: [ReembolsoRoutingModule] }) export class ReembolsoModule {}`,
      'app/reembolso/reembolso-routing.module.ts': `import { DadosPage } from './calcular/dados/dados.page';
      import { OpcaoPage } from './opcao/opcao.page';
      const routes: Routes = [
        { path: 'opcao-reembolso', component: OpcaoPage },
        { path: 'calcular-reembolso', children: [{ path: 'dados-procedimento', component: DadosPage }] },
      ];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class ReembolsoRoutingModule {}`,
      'app/reembolso/calcular/dados/dados.page.ts': page('DadosPage', 'app-dados'),
      'app/reembolso/opcao/opcao.page.ts': page('OpcaoPage', 'app-opcao'),
    });
    try {
      expect(p.chains('DadosPage')).toEqual(['reembolso/calcular-reembolso/dados-procedimento => reembolso>calcular-reembolso>dados-procedimento']);
      expect(p.chains('OpcaoPage')).toEqual(['reembolso/opcao-reembolso => reembolso>opcao-reembolso']);
      expect(p.unresolved()).toEqual([]);
    } finally { p.dispose(); }
  });

  it('página reutilizada em duas rotas é tela nos dois caminhos', () => {
    const p = project({
      'app/app.routes.ts': `import { EscolhaPage } from './escolha/escolha.page';
      export const routes: Routes = [
        { path: 'reembolso', children: [{ path: 'opcao-reembolso', component: EscolhaPage }] },
        { path: 'extratos', children: [{ path: 'opcao-extrato', component: EscolhaPage }] },
      ];`,
      'main.ts': `import { routes } from './app/app.routes';
      bootstrapApplication(App, { providers: [provideRouter(routes)] });`,
      'app/escolha/escolha.page.ts': page('EscolhaPage', 'app-escolha'),
    });
    try {
      expect(p.chains('EscolhaPage')).toEqual(['extratos/opcao-extrato => extratos>opcao-extrato', 'reembolso/opcao-reembolso => reembolso>opcao-reembolso']);
    } finally { p.dispose(); }
  });

  it('standalone: provideRouter, loadChildren de arquivo de rotas (export nomeado e default), loadComponent e parâmetros', () => {
    const p = project({
      'main.ts': `import { routes } from './app/app.routes';
      bootstrapApplication(App, { providers: [provideRouter(routes)] });`,
      'app/app.routes.ts': `export const routes: Routes = [
        { path: 'faturas', loadChildren: () => import('./faturas/faturas.routes').then((m) => m.FATURAS_ROUTES) },
        { path: 'perfil', loadChildren: () => import('./perfil/perfil.routes') },
        { path: '**', component: NaoEncontradaPage },
      ];`,
      'app/faturas/faturas.routes.ts': `export const FATURAS_ROUTES: Routes = [
        { path: 'detalhe/:id', loadComponent: () => import('./detalhe/detalhe.page').then((m) => m.DetalhePage) },
      ];`,
      'app/perfil/perfil.routes.ts': `import { DadosPage } from './dados.page';
      export default [{ path: 'dados', component: DadosPage }] satisfies Routes;`,
      'app/faturas/detalhe/detalhe.page.ts': page('DetalhePage', 'app-detalhe'),
      'app/perfil/dados.page.ts': page('DadosPage', 'app-dados'),
      'app/nao-encontrada.page.ts': page('NaoEncontradaPage', 'app-nao-encontrada'),
    });
    try {
      expect(p.chains('DetalhePage')).toEqual(['faturas/detalhe/:id => faturas>detalhe']);
      expect(p.chains('DadosPage')).toEqual(['perfil/dados => perfil>dados']);
      expect(p.chains('NaoEncontradaPage')).toEqual([]);
    } finally { p.dispose(); }
  });

  it('Ionic tabs: caminho com várias partes, children importado e array espalhado', () => {
    const p = project({
      'app/app-routing.module.ts': `import { TABS } from './tabs/tabs.routes';
      import { EXTRA } from './extra.routes';
      const routes: Routes = [...TABS, ...EXTRA];
      @NgModule({ imports: [RouterModule.forRoot(routes)] }) export class AppRoutingModule {}`,
      'app/tabs/tabs.routes.ts': `import { INICIO } from './inicio.routes';
      export const TABS: Routes = [{ path: 'tabs', component: TabsPage, children: INICIO }];`,
      'app/tabs/inicio.routes.ts': `export const INICIO: Routes = [{ path: 'inicio/saude', component: SaudePage }];`,
      'app/extra.routes.ts': `export const EXTRA: Routes = [{ path: 'ajuda', component: AjudaPage }];`,
      'app/tabs/tabs.page.ts': `@Component({ selector: 'app-tabs', template: '<ion-tabs><ion-tab-bar slot="bottom"><ion-tab-button tab="inicio">Início</ion-tab-button></ion-tab-bar></ion-tabs>' })
      export class TabsPage {}`,
      'app/tabs/saude.page.ts': page('SaudePage', 'app-saude'),
      'app/ajuda.page.ts': page('AjudaPage', 'app-ajuda'),
    });
    try {
      expect(p.chains('SaudePage')).toEqual(['tabs/inicio/saude => tabs>inicio>saude']);
      expect(p.chains('TabsPage')).toEqual(['tabs => tabs']);
      expect(p.chains('AjudaPage')).toEqual(['ajuda => ajuda']);
    } finally { p.dispose(); }
  });

  it('microfrontend: forChild de módulo importado eager é a raiz; o que só sai no barrel não ganha caminho inventado', () => {
    const p = project({
      'mfe/app.module.ts': `import { LibModule } from '../lib/lib.module';
      @NgModule({ imports: [LibModule] }) export class AppModule {}`,
      'main.ts': `import { AppModule } from './mfe/app.module';
      platformBrowserDynamic().bootstrapModule(AppModule);`,
      'lib/lib.module.ts': `import { LibRoutingModule } from './lib-routing.module';
      @NgModule({ imports: [LibRoutingModule] }) export class LibModule {}`,
      'public-api.ts': `export * from './lib/quimio/quimio.module';`,
      'lib/quimio/quimio.module.ts': `const routes: Routes = [{ path: 'perfil', component: PerfilPage }];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class QuimioModule {}`,
      'lib/quimio/perfil.page.ts': page('PerfilPage', 'lib-perfil'),
      'lib/lib-routing.module.ts': `const routes: Routes = [
        { path: 'reembolso', loadChildren: () => import('./reembolso/reembolso.module').then((m) => m.ReembolsoModule) },
        { path: 'quebrado', loadChildren: () => import('./quebrado/quebrado.module').then((m) => m.QuebradoModule) },
      ];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class LibRoutingModule {}`,
      'lib/reembolso/reembolso.module.ts': `const routes: Routes = [{ path: 'resumo', component: ResumoPage }];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class ReembolsoModule {}`,
      'lib/quebrado/quebrado.module.ts': `@NgModule({}) export class QuebradoModule {}`,
      'lib/reembolso/resumo.page.ts': page('ResumoPage', 'lib-resumo'),
    });
    try {
      expect(p.chains('ResumoPage')).toEqual(['reembolso/resumo => reembolso>resumo']);
      expect(p.chains('PerfilPage')).toEqual([]);
      expect(p.unresolved()).toEqual(['./quebrado/quebrado.module']);
    } finally { p.dispose(); }
  });

  it('path por constante: objeto `as const` via barrel, enum e template literal', () => {
    const p = project({
      'app/app.routes.ts': `import { ROTAS } from './common';
      import { Modulo } from './modulo.enum';
      const BASE = 'servicos';
      export const routes: Routes = [
        { path: Modulo.Reembolso, children: [{ path: ROTAS.RESUMO, component: ResumoPage }] },
        { path: \`\${BASE}/vacinas\`, component: VacinasPage },
      ];`,
      'main.ts': `import { routes } from './app/app.routes';
      bootstrapApplication(App, { providers: [provideRouter(routes)] });`,
      'app/common/index.ts': `export * from './constants/rotas.constants';`,
      'app/common/constants/rotas.constants.ts': `export const ROTAS = { RESUMO: 'resumo-reembolso' } as const;`,
      'app/modulo.enum.ts': `export enum Modulo { Reembolso = 'reembolso' }`,
      'app/resumo.page.ts': page('ResumoPage', 'app-resumo'),
      'app/vacinas.page.ts': page('VacinasPage', 'app-vacinas'),
    });
    try {
      expect(p.chains('ResumoPage')).toEqual(['reembolso/resumo-reembolso => reembolso>resumo-reembolso']);
      expect(p.chains('VacinasPage')).toEqual(['servicos/vacinas => servicos>vacinas']);
    } finally { p.dispose(); }
  });

  it('mesmo caminho declarado duas vezes (canMatch) é uma cadeia só', () => {
    const p = project({
      'main.ts': `import { routes } from './app/app.routes';
      bootstrapApplication(App, { providers: [provideRouter(routes)] });`,
      'app/app.routes.ts': `export const routes: Routes = [
        { path: 'faturas', canMatch: [podeVer], component: FaturasPage },
        { path: 'faturas', component: FaturasPage },
      ];`,
      'app/faturas.page.ts': page('FaturasPage', 'app-faturas'),
    });
    try {
      expect(p.chains('FaturasPage')).toEqual(['faturas => faturas']);
    } finally { p.dispose(); }
  });

  it('loadChildren por alias de tsconfig não vira raiz falsa: módulo do projeto fica sem caminho e é diagnosticado', () => {
    const p = project({
      'app/app-routing.module.ts': `import { ExtraModule } from './extra/extra.module';
      const routes: Routes = [{ path: 'm', loadChildren: () => import('@app/sub/sub.module').then((m) => m.SubModule) }];
      @NgModule({ imports: [RouterModule.forRoot(routes), ExtraModule] }) export class AppRoutingModule {}`,
      'main.ts': `// bootstrapApplication(Falso) em comentário não conta
      import { AppRoutingModule } from './app/app-routing.module';
      platformBrowserDynamic().bootstrapModule(AppRoutingModule);`,
      'app/extra/extra.module.ts': `import { SubModule } from '../sub/sub.module';
      @NgModule({ imports: [SubModule] }) export class ExtraModule {}`,
      'app/sub/sub.module.ts': `const routes: Routes = [{ path: 'sub', component: SubPage }];
      @NgModule({ imports: [RouterModule.forChild(routes)] }) export class SubModule {}`,
      'app/sub/sub.page.ts': page('SubPage', 'app-sub'),
    });
    try {
      expect(p.chains('SubPage')).toEqual([]);
      expect(p.unresolved()).toEqual(['@app/sub/sub.module']);
    } finally { p.dispose(); }
  });

  it('lazy só para carregar o módulo da página não é erro; rota sem component com lazy vazio é tela que nunca aparece', () => {
    const p = project({
      'main.ts': `import { routes } from './app/app.routes';
      bootstrapApplication(App, { providers: [provideRouter(routes)] });`,
      'app/app.routes.ts': `export const routes: Routes = [
        { path: 'info', component: InfoPage, loadChildren: () => import('./info/info.module').then((m) => m.InfoModule) },
        { path: 'opcao', loadChildren: () => import('./opcao/opcao.module').then((m) => m.OpcaoModule), data: { titulo: 'Opção' } },
      ];`,
      'app/info/info.module.ts': `const routes: Routes = [];
      @NgModule({ imports: [RouterModule.forChild(routes)], declarations: [InfoPage] }) export class InfoModule {}`,
      'app/info/info.page.ts': page('InfoPage', 'app-info'),
      'app/opcao/opcao.module.ts': `import { EscolhaPage } from './escolha.page';
      @NgModule({ imports: [RouterModule.forChild([])], declarations: [EscolhaPage] }) export class OpcaoModule {}`,
      'app/opcao/escolha.page.ts': page('EscolhaPage', 'app-escolha'),
    });
    try {
      expect(p.chains('InfoPage')).toEqual(['info => info']);
      expect(p.unresolved()).toEqual(['./opcao/opcao.module']);
      expect(p.declared()).toEqual([['EscolhaPage']]);
      expect(p.chains('EscolhaPage')).toEqual([]);
    } finally { p.dispose(); }
  });

  it('array de rotas sem registro nem montagem não inventa caminho; objeto com path que não é rota é ignorado', () => {
    const p = project({
      'app/rotas-soltas.ts': `export const r = [{ path: 'solta', component: SoltaPage }];`,
      'app/menu.ts': `export const menu = [{ path: 'reembolso', titulo: 'Reembolso' }];`,
      'app/solta.page.ts': page('SoltaPage', 'app-solta'),
    });
    try {
      expect(p.chains('SoltaPage')).toEqual([]);
    } finally { p.dispose(); }
  });
});

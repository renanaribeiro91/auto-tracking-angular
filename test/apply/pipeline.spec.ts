import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { screenIdentity } from '../../src/application/apply/pipeline.js';
import { ScreenIdentityResolver } from '../../src/application/apply/screen-identity-resolver.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

const pipelineFactory = new TrackingPipelineFactory();
const runPipeline = (root: string, configFile: string) => pipelineFactory.create().runPipeline(root, configFile);
const inputFingerprint = (root: string, configFile: string) => pipelineFactory.create().inputFingerprint(root, configFile);

/** pacote no formato Angular Package Format, como publicado por qualquer biblioteca de componentes */
const APF = `import * as i0 from '@angular/core';
class LibHeader {
  botaoVoltar() { this.voltar.emit(); }
}
LibHeader.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.0.0", type: LibHeader, selector: "lib-header",
  outputs: { voltar: "voltar" },
  template: "<h1>Título</h1><div id=\\"btnVoltar\\" (click)=\\"botaoVoltar()\\"></div>" });
export { LibHeader };`;

describe('pipeline apply/verify ponta a ponta', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-pipe-'));
  const cfg = path.join(root, 'auto-tracking.config.ts');
  beforeAll(() => {
    write(root, 'angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write(root, 'tsconfig.app.json', '{}');
    write(root, 'package.json', JSON.stringify({ dependencies: { 'lib-ui': '1.0.0' } }));
    write(root, 'node_modules/lib-ui/fesm2022/lib-ui.mjs', APF);
    write(root, 'auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      runtime: { owner: 'mob', root: 'app-root', product: 'saude', preset: examplePreset, mode: 'ref', send: () => {} } });`);
    write(root, 'src/app/app.module.ts', 'export const p = [provideAutoTracking(tracking.runtime)];');
    write(root, 'src/app/features/reembolso/common/enums/reembolso.enum.ts', 'export enum R {}');
    write(root, 'src/app/common/constants/app.constants.ts', 'export const A = 1;');
    write(root, 'src/app/features/reembolso/routes.ts', `export const r = [
      { path: 'tipo', component: TipoPage }, { path: 'x', children: [] }];`);
    write(root, 'src/app/features/reembolso/tipo/tipo.page.ts', `@Component({ selector: 'app-tipo', templateUrl: './tipo.page.html' })
export class TipoPage { abrir() { this.modal.create({ component: AjudaModal }); } }`);
    write(root, 'src/app/features/reembolso/tipo/tipo.page.html', '<lib-header (voltar)="voltar()"></lib-header><app-card></app-card>');
    write(root, 'src/app/shared/components/card/card.component.ts', `@Component({ selector: 'app-card', template: "<button (click)=\\"ok()\\">Ok</button>" })
export class CardComponent { ok() {} }`);
    write(root, 'src/app/shared/components/card/card.data.ts', `@Component({ selector: 'app-card', template: '' })
export class CardComponentMock {}`);
    write(root, 'src/app/shared/modals/ajuda/ajuda.modal.ts', `@Component({ selector: 'app-ajuda', template: \`<ion-button (click)="fechar()">Fechar</ion-button>\` })
export class AjudaModal { fechar() {} }`);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const apply = () => {
    const r = runPipeline(root, cfg);
    for (const c of r.changes) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.after); }
    fs.mkdirSync(r.paths.outputDir, { recursive: true });
    fs.writeFileSync(r.paths.relatorioFile, r.relatorio);
    return r;
  };

  it('módulo e tela pelo padrão: pasta com common/ acima da tela, senão a pasta abaixo do contêiner', () => {
    const src = path.join(root, 'src');
    expect(screenIdentity(src, path.join(src, 'app/features/reembolso/tipo/tipo.page.html'))).toEqual({ funcionalidade: 'reembolso', tela: 'tipo' });
    expect(screenIdentity(src, path.join(src, 'app/features/onboarding/onboarding.page.html'))).toEqual({ funcionalidade: 'onboarding', tela: 'onboarding' });
    expect(screenIdentity(src, path.join(src, 'lib/modules/saude-equilibrio/pages/agendamentos/agendamentos.page.html'))).toEqual({ funcionalidade: 'saude-equilibrio', tela: 'agendamentos' });
  });

  it('ignora pasta vazia/gerada ao escolher a funcionalidade; usa apenas fontes reais', () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'at-identity-'));
    try {
      const source = path.join(localRoot, 'src');
      const template = path.join(source, 'app/features/reembolso/incluir-mais-procedimentos/procedimento2/procedimento2.page.html');
      const common = path.join(source, 'app/features/reembolso/common/constants');
      fs.mkdirSync(path.join(common, '.omc/state'), { recursive: true });
      const withoutSource = screenIdentity(source, template);
      fs.rmSync(path.join(common, '.omc'), { recursive: true });
      expect(screenIdentity(source, template)).toEqual(withoutSource);
      write(localRoot, 'src/app/features/reembolso/common/constants/eventos.ts', 'export const eventos = {};');
      expect(screenIdentity(source, template)).toEqual({ funcionalidade: 'reembolso', tela: 'procedimento2' });
    } finally { fs.rmSync(localRoot, { recursive: true, force: true }); }
  });

  it('identifica módulo Angular roteado sem depender de subpastas geradas', () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'at-identity-'));
    try {
      const source = path.join(localRoot, 'src');
      const template = path.join(source, 'app/features/reembolso/incluir-mais-procedimentos/procedimento2/procedimento2.page.html');
      write(localRoot, 'src/app/features/reembolso/reembolso.module.ts', 'export class ReembolsoModule {}');
      write(localRoot, 'src/app/features/reembolso/reembolso.routing.ts', 'export const routes = [];');
      const resolve = () => new ScreenIdentityResolver().resolve(source, template, 0, '', true);
      const first = resolve();
      write(localRoot, 'src/app/features/reembolso/incluir-mais-procedimentos/common/constants/.omc/state/cache.json', '{}');
      expect(first).toEqual({ funcionalidade: 'reembolso', tela: 'procedimento2' });
      expect(resolve()).toEqual(first);
      fs.rmSync(path.join(source, 'app/features/reembolso/incluir-mais-procedimentos/common'), { recursive: true });
      expect(resolve()).toEqual(first);
    } finally { fs.rmSync(localRoot, { recursive: true, force: true }); }
  });

  it('usa o caminho completo para separar identidades que continuam colidindo após os refinamentos usuais', () => {
    const src = path.join(root, 'src');
    const page = screenIdentity(src, path.join(src, 'app/features/reembolso/pages/consulta/consulta.page.html'), 3);
    const component = screenIdentity(src, path.join(src, 'app/features/reembolso/components/consulta/consulta.page.html'), 3);
    expect(page.funcionalidade).toBe(component.funcionalidade);
    expect(page.tela).not.toBe(component.tela);
  });

  it('mapeia saída de biblioteca APF e resolve a tela de componentes compartilhados e modais', () => {
    const r = apply();
    const template = fs.readFileSync(path.join(root, 'src/app/features/reembolso/tipo/tipo.page.html'), 'utf-8');
    expect(template).toMatch(/data-at-ref="v1\.[A-Za-z0-9_-]+"/);
    const ref = /data-at-ref="([^"]+)"/.exec(template)![1]!;
    expect(decodeTrackingToken(ref)?.outputs).toEqual([
      { id: 'reembolso-tipo-voltar', event: 'click', selector: '#btnVoltar', label: 'voltar', output: 'voltar' },
    ]);
    expect(r.entries.find((e) => e.id === 'reembolso-tipo-voltar')?.ref).toBe(ref);
    expect((JSON.parse(fs.readFileSync(path.join(root, '.auto-tracking/relatorio.json'), 'utf8')) as { entries: Array<{ ref?: string }> }).entries.some((entry) => entry.ref === ref)).toBe(true);
    expect(fs.existsSync(path.join(root, '.auto-tracking/tracking-manifest.generated.ts'))).toBe(false);
    const card = r.entries.find((e) => e.arquivo.endsWith('card.component.ts'))!;
    const modal = r.entries.find((e) => e.arquivo.endsWith('ajuda.modal.ts'))!;
    expect(card.telas).toEqual(['reembolso:tipo']);
    expect(modal.telas).toEqual(['reembolso:tipo']);
    expect(r.entries.filter((e) => e.evento === 'screen_view').map((e) => e.telas)).toEqual([['reembolso:tipo']]);
    expect(r.diagnostics).toEqual([]);
  });

  it('resolve a tela de componentes abertos por serviço→serviço, effect NgRx (alias de action diferente) e método privado; sem uso fica sem tela', () => {
    write(root, 'src/app/features/reembolso/lista/lista.page.ts', `@Component({ selector: 'app-lista', templateUrl: './lista.page.html' })
export class ListaPage { constructor(private useCase: ListaUseCase, private store: Store) {}
  ver() { this.useCase.verDetalhe(); }
  filtrar() { this.store.dispatch(ListaActionsDaTela.abrirFiltro()); } }`);
    write(root, 'src/app/features/reembolso/lista/lista.page.html', '<ion-content></ion-content>');
    write(root, 'src/app/features/reembolso/rotas-lista.ts', `export const r3 = [{ path: 'lista', component: ListaPage }];`);
    write(root, 'src/app/features/reembolso/lista/lista.use-case.ts', `export class ListaUseCase { constructor(private modais: ModaisService) {}
  verDetalhe() { return this.modais.abrirDetalhe(); } }`);
    write(root, 'src/app/shared/modais.service.ts', `export class ModaisService { abrirDetalhe() { return this.ctrl.create({ component: DetalheModal }); } }`);
    write(root, 'src/app/shared/filtro.effects.ts', `export class FiltroEffects { constructor(private service: FiltroService) {}
  abrir$ = createEffect(() => this.actions$.pipe(ofType(ListaActionsDoEffect.abrirFiltro), switchMap(() => this.montar())));
  private montar() { return this.service.criarFiltro(); } }`);
    write(root, 'src/app/shared/filtro.service.ts', `export class FiltroService { criarFiltro() { return new Container(FiltroModal); } }`);
    for (const [cls, sel] of [['DetalheModal', 'detalhe'], ['FiltroModal', 'filtro'], ['SemUsoComponent', 'sem-uso']]) {
      write(root, `src/app/shared/modals/${sel}/${sel}.modal.ts`, `@Component({ selector: 'app-${sel}', template: '<button (click)="ok()">Ok</button>' })
export class ${cls} { ok() {} }`);
    }
    const r = apply();
    const telas = (f: string) => r.entries.find((e) => e.arquivo.endsWith(f))!.telas;
    expect(telas('detalhe.modal.ts')).toEqual(['reembolso:lista']);
    expect(telas('filtro.modal.ts')).toEqual(['reembolso:lista']);
    expect(telas('sem-uso.modal.ts')).toEqual([]);
  });

  it('telas homônimas recebem identidade única (módulo pela pasta-mãe; nome pela pasta se preciso)', () => {
    write(root, 'src/app/features/servicos/common/enums/c.enum.ts', 'export enum C {}');
    for (const area of ['viagem', 'vacina']) {
      write(root, `src/app/features/servicos/${area}/resumo/resumo.page.ts`, `@Component({ selector: 'app-${area}-resumo', templateUrl: './resumo.page.html' })\nexport class ${area}ResumoPage {}`);
      write(root, `src/app/features/servicos/${area}/resumo/resumo.page.html`, '<ion-content></ion-content>');
      write(root, `src/app/features/servicos/${area}/rotas.ts`, `export const r = [{ path: 'resumo', component: ${area}ResumoPage }];`);
    }
    const r = apply();
    const telas = r.entries.filter((e) => e.evento === 'screen_view' && e.arquivo.includes('servicos/')).map((e) => e.telas[0]).sort();
    expect(telas).toEqual(['vacina:resumo', 'viagem:resumo']);
  });

  it('modo ref é autocontido, relatório contém ref por evento e a segunda execução é idempotente', () => {
    const first = apply();
    const report = JSON.parse(first.relatorio) as { entries: Array<{ ref?: string }> };
    expect(report.entries.every((entry) => entry.ref && decodeTrackingToken(entry.ref))).toBe(true);
    expect('trackingManifest' in report).toBe(false);
    expect(fs.existsSync(path.join(root, '.auto-tracking/tracking-manifest.generated.ts'))).toBe(false);
    const second = runPipeline(root, cfg);
    expect(second.changes).toHaveLength(0);
    expect(second.relatorio).toBe(first.relatorio);
  });

  it('segunda execução: zero mudanças e relatório idêntico', () => {
    const first = runPipeline(root, cfg);
    const second = runPipeline(root, cfg);
    expect(second.changes).toHaveLength(0);
    expect(second.relatorio).toBe(first.relatorio);
  });

  it('mudança de runtime.owner reconcilia as marcações e os relatórios sem trocar IDs', () => {
    const configBefore = fs.readFileSync(cfg, 'utf-8');
    try {
      write(root, 'auto-tracking.config.ts', configBefore);
      apply();
      const trackedFile = path.join(root, 'src/app/shared/components/card/card.component.ts');
      const templateBefore = fs.readFileSync(trackedFile, 'utf-8');
      const beforeRef = /data-at-ref=["']([^"']+)["']/.exec(templateBefore)?.[1];
      expect(beforeRef).toBeDefined();
      const existingId = decodeTrackingToken(beforeRef!)?.click?.id;
      expect(existingId).toBeDefined();

      write(root, 'auto-tracking.config.ts', configBefore.replace("owner: 'mob'", "owner: 'mfe-exemplo'"));
      const migration = runPipeline(root, cfg);
      const taggedTemplate = migration.changes.find((change) => change.file === trackedFile)?.after ?? fs.readFileSync(trackedFile, 'utf-8');

      const migratedRef = /data-at-ref=["']([^"']+)["']/.exec(taggedTemplate)?.[1];
      expect(migratedRef).toBeDefined();
      expect(decodeTrackingToken(migratedRef!)?.click?.id).toBe(existingId);
      expect(decodeTrackingToken(migratedRef!)?.owner).toBe('mfe-exemplo');
      expect(migration.entries.every((entry) => entry.owner === 'mfe-exemplo')).toBe(true);
      expect(JSON.parse(migration.relatorio).entries.every((entry: { owner: string }) => entry.owner === 'mfe-exemplo')).toBe(true);

      for (const change of migration.changes) fs.writeFileSync(change.file, change.after);
      fs.writeFileSync(path.join(root, '.auto-tracking/relatorio.json'), migration.relatorio);
      const second = runPipeline(root, cfg);
      expect(second.changes).toHaveLength(0);
      expect(second.relatorio).toBe(migration.relatorio);
    } finally {
      fs.writeFileSync(cfg, configBefore);
    }
  });

  it('fingerprint muda com template e com o lockfile (versão de biblioteca)', () => {
    const before = inputFingerprint(root, cfg);
    write(root, 'package-lock.json', '{"lockfileVersion":3}');
    const afterLock = inputFingerprint(root, cfg);
    expect(afterLock).not.toBe(before);
    fs.appendFileSync(path.join(root, 'src/app/features/reembolso/tipo/tipo.page.html'), ' ');
    expect(inputFingerprint(root, cfg)).not.toBe(afterLock);
  });

  it('acusa bootstrap sem provideAutoTracking', () => {
    fs.rmSync(path.join(root, 'src/app/app.module.ts'));
    expect(runPipeline(root, cfg).diagnostics.map((d) => d.code)).toContain('BOOTSTRAP_PROVIDER_MISSING');
  });
});

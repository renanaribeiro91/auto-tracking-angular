import { loadWorkbookProvider } from '../../src/adapters/reports/excel-workbook.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { writeEvidenceWorkbook } from '../../src/adapters/reports/evidence-writer.js';

describe('declaração TypeScript usa o pipeline e a evidência dos templates', () => {
  let root: string;
  const write = (file: string, text: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const service = (action = "{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar indisponibilidade' }") => `
import { defineTrackingSurface as surface } from 'auto-tracking-angular';
@Injectable({providedIn:'root'}) export class ModalService {
  abrir() { const declaration = surface({id:'indisponibilidade', actions:[${action}]}); return declaration; }
}`;
  const run = () => new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-surface-'));
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}'); write('package.json', '{"dependencies":{}}');
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects:[{angularProject:'app',tsconfig:'tsconfig.app.json'}],
      runtime:{owner:'mob',root:'app-root',product:'saude',preset:examplePreset,mode:'ref',send:()=>{}}});`);
    write('src/app/app.module.ts', 'export const p = [provideAutoTracking(tracking.runtime)];');
    write('src/app/features/reembolso/common/enums/reembolso.enum.ts', 'export enum R {}');
    write('src/app/features/reembolso/routes.ts', 'export const r = [{path:"tipo",component:TipoPage}];');
    write('src/app/features/reembolso/tipo/tipo.page.ts', `
import { ModalService } from '../../../shared/modal.service';
@Component({selector:'app-tipo',templateUrl:'./tipo.page.html'})
export class TipoPage { constructor(private modal: ModalService) {} abrir() { this.modal.abrir(); } }`);
    write('src/app/features/reembolso/tipo/tipo.page.html', '<button (click)="abrir()">Ajuda</button>');
    write('src/app/shared/modal.service.ts', service());
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('gera ref no TS sem cache, associa a tela chamadora e não reescreve na segunda execução', () => {
    const result = run();
    expect(result.diagnostics).toEqual([]);
    const report = JSON.parse(result.relatorio);
    const entries = report.entries;
    // O relatório usa a mesma estrutura pública de TagEntry dos templates.
    expect(entries).toBeDefined();
    const entry = entries.find((item: { id: string }) => item.id === 'indisponibilidade-fechar');
    expect(entry).toMatchObject({ telas: ['reembolso:tipo'], eventos: [expect.objectContaining({ rotulo: 'fechar-indisponibilidade', elemento: 'botao' })] });
    expect(decodeTrackingToken(entry.ref)?.outputs?.[0]).toMatchObject({ id: entry.id, label: entry.eventos[0].rotulo, selector: '#fechar' });
    const change = result.changes.find((item) => item.file.endsWith('modal.service.ts'))!;
    expect(change.after).toContain('ref: "v1.');
    for (const item of result.changes) fs.writeFileSync(item.file, item.after);
    expect(run().changes).toEqual([]);
    fs.writeFileSync(change.file, change.after.replace('Fechar indisponibilidade', 'Confirmar indisponibilidade'));
    const updated = run();
    expect(updated.changes.some((item) => item.file === change.file)).toBe(true);
    expect(updated.relatorio).toContain('confirmar-indisponibilidade');
  });

  it('atribui modal aberto por effect após outra action somente à tela que iniciou o fluxo', () => {
    write('src/app/features/reembolso/tipo/tipo.page.ts', `
@Component({selector:'app-tipo',templateUrl:'./tipo.page.html'})
export class TipoPage { constructor(private store: Store) {}
  abrir() { this.store.dispatch(ExtratosActions.buscar()); } }`);
    write('src/app/features/outro/outro.page.ts', `
@Component({selector:'app-outro',template:'<button>Outro</button>'})
export class OutroPage { constructor(private store: Store) {}
  abrir() { this.store.dispatch(OutrasActions.buscar()); } }`);
    write('src/app/features/outro/routes.ts', `export const r = [{path:'outro',component:OutroPage}];`);
    write('src/app/effects-registration.ts', `import { ErroEffects } from './shared/erro.effects'; export const effects = provideEffects(ErroEffects);`);
    write('src/app/shared/erro.effects.ts', `
export class ErroEffects { constructor(private modal: ModalService) {}
  carregar$ = createEffect(() => this.actions$.pipe(
    ofType(ExtratosActions.buscar), switchMap(() => of(ExtratosActions.falha()))));
  mostrar$ = createEffect(() => this.actions$.pipe(
    ofType(ExtratosActions.falha), tap(() => this.modal.abrir())), {dispatch:false});
}`);
    const result = run();
    expect(result.diagnostics).toEqual([]);
    const entry = result.entries.find((item) => item.id === 'indisponibilidade-fechar');
    expect(entry?.telas).toEqual(['reembolso:tipo']);
    expect(JSON.parse(result.relatorio).entries.find((item: { id: string }) => item.id === entry?.id)?.telas)
      .toEqual(['reembolso:tipo']);
    for (const change of result.changes) fs.writeFileSync(change.file, change.after);
    expect(run().changes).toEqual([]);
  });

  it('reconhece aliases de actions importadas e não mistura actions homônimas de outros módulos', () => {
    write('src/app/shared/actions.ts', 'export const buscar = () => ({}); export const falha = () => ({});');
    write('src/app/shared/other-actions.ts', 'export const buscar = () => ({});');
    write('src/app/features/reembolso/tipo/tipo.page.ts', `
import * as TelaActions from '../../../shared/actions';
@Component({selector:'app-tipo',templateUrl:'./tipo.page.html'})
export class TipoPage { constructor(private store: Store) {}
  abrir() { this.store.dispatch(TelaActions.buscar()); } }`);
    write('src/app/features/outro/outro.page.ts', `
import * as OutrasActions from '../../shared/other-actions';
@Component({selector:'app-outro',template:'<button>Outro</button>'})
export class OutroPage { constructor(private store: Store) {}
  abrir() { this.store.dispatch(OutrasActions.buscar()); } }`);
    write('src/app/features/outro/routes.ts', `export const r = [{path:'outro',component:OutroPage}];`);
    write('src/app/effects-registration.ts', `import { ErroEffects } from './shared/erro.effects'; export const effects = provideEffects(ErroEffects);`);
    write('src/app/shared/erro.effects.ts', `
import * as EffectActions from './actions';
export class ErroEffects { constructor(private modal: ModalService) {}
  carregar$ = createEffect(() => this.actions$.pipe(
    ofType(EffectActions.buscar), switchMap(() => of(EffectActions.falha()))));
  mostrar$ = createEffect(() => this.actions$.pipe(
    ofType(EffectActions.falha), tap(() => this.modal.abrir())), {dispatch:false});
}`);
    const result = run();
    expect(result.diagnostics).toEqual([]);
    expect(result.entries.find((entry) => entry.id === 'indisponibilidade-fechar')?.telas).toEqual(['reembolso:tipo']);
    expect(JSON.parse(result.relatorio).entries.find((entry: { id: string }) => entry.id === 'indisponibilidade-fechar')?.telas)
      .toEqual(['reembolso:tipo']);
  });

  it('exporta as interações declaradas no TS com a mesma origem e rótulo do relatório', async () => {
    const result = run();
    const file = path.join(root, 'evidencia.xlsx');
    await writeEvidenceWorkbook(file, { owner: 'mob', product: 'saude', branding: {}, entries: result.entries }, 'surface-test');
    const ExcelJS = await loadWorkbookProvider();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const cells: string[] = [];
    workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
    expect(cells).toEqual(expect.arrayContaining(['fechar-indisponibilidade', 'reembolso', 'modal.service.ts'].map(
      (value) => expect.stringContaining(value))));
    expect(cells).toEqual(expect.arrayContaining([expect.stringContaining(':tipo')]));
  });

  it('reconcilia opções e remoção de ações, preserva IDs e estabiliza na segunda execução', () => {
    write('src/app/shared/modal.service.ts', service(`
      { id: 'tipo', selector: 'select', elemento: 'dropdown', rotulo: 'Tipo', event: 'change',
        optionAttribute: 'data-option', allowedOptions: ['Consulta'] },
      { id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }`));
    const first = run();
    for (const item of first.changes) fs.writeFileSync(item.file, item.after);
    const file = path.join(root, 'src/app/shared/modal.service.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("allowedOptions: ['Consulta']", "allowedOptions: ['Consulta', 'Exame']"));
    const changed = run();
    const before = first.entries.find((entry) => entry.id === 'indisponibilidade-tipo')!;
    const after = changed.entries.find((entry) => entry.id === before.id)!;
    expect(after.ref).not.toBe(before.ref);
    expect(changed.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id));
    for (const item of changed.changes) fs.writeFileSync(item.file, item.after);
    expect(run().changes).toEqual([]);
    expect(run().relatorio).toBe(changed.relatorio);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/,\s*\{ id: 'fechar'[^}]+\}/, ''));
    const removed = run();
    expect(removed.entries.some((entry) => entry.id === 'indisponibilidade-fechar')).toBe(false);
    expect(removed.entries.find((entry) => entry.id === before.id)?.ref).not.toBe(after.ref);
    for (const item of removed.changes) fs.writeFileSync(item.file, item.after);
    expect(run().changes).toEqual([]);
  });

  it('reserva o ID público da superfície antes de gerar um HTML com o mesmo nome', () => {
    write('src/app/shared/modal.service.ts', service().replace("id:'indisponibilidade'", "id:'reembolso-tipo'"));
    write('src/app/features/reembolso/tipo/tipo.page.html', '<button (click)="abrir()">Fechar</button>');
    const first = run();
    expect(first.diagnostics).toEqual([]);
    const modal = first.entries.find((entry) => entry.arquivo.endsWith('modal.service.ts'))!;
    const html = first.entries.find((entry) => entry.evento === 'click' && entry.arquivo.endsWith('.html'))!;
    expect(modal.id).toBe('reembolso-tipo-fechar');
    expect(html.id).not.toBe(modal.id);
    expect(new Set(first.entries.map((entry) => entry.id)).size).toBe(first.entries.length);
    for (const change of first.changes) fs.writeFileSync(change.file, change.after);
    expect(run().changes).toEqual([]);
    expect(run().relatorio).toBe(first.relatorio);
  });

  it('reconcilia somente a DI do tracking e a ref sem duplicação', () => {
    write('src/app/shared/modal.service.ts', `
import type { AutoTrackingSurfaces as Surfaces } from 'auto-tracking-angular';
import { defineTrackingSurface } from 'auto-tracking-angular';
import { Injectable, Optional } from '@angular/core';
@Injectable() export class ModalService {
  constructor(@Optional() private readonly tracking: Surfaces | null = null) {}
  abrir() { return defineTrackingSurface({ id:'ajuda', actions:[
    {id:'fechar',selector:'#fechar',elemento:'botao',rotulo:'Fechar ajuda'}] }); }
}`);
    const result = run();
    expect(result.diagnostics).toEqual([]);
    const service = result.changes.find((change) => change.file.endsWith('modal.service.ts'))!;
    expect(service.after).toMatch(/@Inject\(Surfaces\)/);
    expect(service.after).not.toContain('import type { AutoTrackingSurfaces');
    expect(service.after).toContain('ref: "v1.');
    for (const change of result.changes) fs.writeFileSync(change.file, change.after);
    const second = run();
    expect(second.changes).toEqual([]);
    expect(second.relatorio).toBe(result.relatorio);
    expect(service.after).toContain("constructor(@Inject(Surfaces) @Optional() private readonly tracking: Surfaces | null = null)");
  });

  it('agrupa o modal compartilhado nas telas e módulos chamadores, sem duplicar a interação no relatório', async () => {
    write('src/app/features/consulta/common/enums/consulta.enum.ts', 'export enum C {}');
    write('src/app/features/consulta/routes.ts', 'export const r = [{path:"agenda",component:AgendaPage}];');
    write('src/app/features/consulta/agenda/agenda.page.ts', `
import { ModalService } from '../../../shared/modal.service';
@Component({selector:'app-agenda',templateUrl:'./agenda.page.html'})
export class AgendaPage { constructor(private modal: ModalService) {} abrir() { this.modal.abrir(); } }`);
    write('src/app/features/consulta/agenda/agenda.page.html', '<button (click)="abrir()">Ajuda</button>');
    const result = run();
    expect(result.diagnostics).toEqual([]);
    const entries = result.entries.filter((entry) => entry.id === 'indisponibilidade-fechar');
    expect(entries).toHaveLength(1);
    expect([...entries[0]!.telas].sort()).toEqual(['consulta:agenda', 'reembolso:tipo']);
    const file = path.join(root, 'compartilhado.xlsx');
    await writeEvidenceWorkbook(file, { owner: 'mob', product: 'saude', branding: {}, entries }, 'shared-surface-test');
    const { Workbook } = await loadWorkbookProvider();
    const workbook = new Workbook();
    await workbook.xlsx.readFile(file);
    const origins = new Set<string>();
    workbook.eachSheet((sheet) => sheet.eachRow((row) => {
      const cells = row.values as unknown[];
      if (cells.includes('indisponibilidade-fechar')) {
        if (cells.includes('{ambiente}:saude:consulta:agenda')) origins.add('consulta:agenda');
        if (cells.includes('{ambiente}:saude:reembolso:tipo')) origins.add('reembolso:tipo');
      }
    }));
    expect([...origins].sort()).toEqual(['consulta:agenda', 'reembolso:tipo']);
  });

  it.each([
    "{ id: 'fechar', selector: dynamic, elemento: 'botao', rotulo: 'Fechar' }",
    "{ id: 'fechar', id: 'outro', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar' }",
    "{ id: 'fechar', selector: '#fechar', elemento: 'botao', rotulo: 'Fechar', optionAttribute: 'value' }",
  ])('bloqueia declaração não comprovada estaticamente', (action) => {
    write('src/app/shared/modal.service.ts', service(action));
    expect(run().diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SURFACE_DECLARATION_UNPROVEN' })]));
  });
});

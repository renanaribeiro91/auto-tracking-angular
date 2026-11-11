/** @jest-environment jsdom */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { installDomTracker, AutoTrackingSurfaces } from '../../src/adapters/runtime/dom-tracker.js';
import { AngularProjectIndexer } from '../../src/adapters/angular-compiler/project-index.js';
import { writeEvidenceWorkbook } from '../../src/adapters/reports/evidence-writer.js';
import { loadWorkbookProvider } from '../../src/adapters/reports/excel-workbook.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it('prova fonte → JSON/XLSX → gesto → valores exatos com dados trocados, sem duplicar ou congelar opções', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-values-'));
  const write = (file: string, text: string) => {
    const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text);
  };
  const sent: TrackingEvent[] = [];
  const warnings: string[] = [];
  let stop = () => {};
  try {
    write('angular.json', '{"projects":{"app":{"sourceRoot":"src"}}}');
    write('package.json', '{"dependencies":{}}'); write('tsconfig.app.json', '{}');
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({projects:[{angularProject:'app',tsconfig:'tsconfig.app.json'}],runtime:{owner:'app',root:'app-root',product:'produto',mode:'ref',send:()=>{}}});`);
    write('src/routes.ts', `import { Page } from './features/catalogo/page'; export const routes=[{path:'catalogo',component:Page}]; const p=[provideAutoTracking(config.runtime)];`);
    write('src/features/catalogo/page.ts', `import { Choices } from './choices';
      @Component({selector:'app-page',templateUrl:'./page.html'}) export class Page {
        constructor(private choices: Choices) {} abrir(){ this.choices.abrir(); } escolher(value: unknown) {} continuar() {}
      }`);
    write('src/features/catalogo/page.html', `<main><button id="action" (click)="continuar()">{{ actionLabel }}</button>
      <select id="selection" [attr.aria-label]="selectionLabel" (change)="escolher($event)"><option *ngFor="let item of items" [value]="item.id">{{item.label}}</option></select>
      <button id="static" (click)="abrir()">Abrir opções</button><button id="list-choice" *ngFor="let item of items" (click)="escolher(item)">{{item.label}}</button></main>`);
    const declaration = `import type { AutoTrackingSurfaces } from 'auto-tracking-angular';
      import { defineTrackingSurface } from 'auto-tracking-angular';
      export class Choices { constructor(private tracking: AutoTrackingSurfaces | null) {}
      abrir(){ return defineTrackingSurface({id:'opcoes',actions:[{id:'escolher',selector:'button',elemento:'lista',rotulo:'Escolher',
        optionAttribute:'data-public-option',optionPlaceholder:'[nome-publico-selecionado]',labelAttribute:'aria-label'}]}); } }`;
    write('src/features/catalogo/choices.ts', declaration);
    const pipeline = new TrackingPipelineFactory().create();
    const run = () => pipeline.runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    const result = run();
    expect(result.diagnostics).toEqual([]);
    for (const change of result.changes) fs.writeFileSync(change.file, change.after);
    expect(run().changes).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'src/features/catalogo/choices.ts'), 'utf8')).toContain('constructor(@Inject(AutoTrackingSurfaces) private tracking: AutoTrackingSurfaces | null)');
    expect(fs.readFileSync(path.join(root, 'src/features/catalogo/choices.ts'), 'utf8')).toContain("import { AutoTrackingSurfaces }");
    const entries = (JSON.parse(result.relatorio).entries as (typeof result.entries[number] & { eventos: object[] })[]).map((entry) => ({ ...entry, ...entry.eventos[0] })) as typeof result.entries;
    const choice = entries.find((entry) => entry.id === 'opcoes-escolher')!;
    const selection = entries.find((entry) => entry.origem === '(change)')!;
    expect(selection).toMatchObject({rotulo:'[rotulo-do-botao-exibido]',opcao_selecionada_1:'[valor-selecionado]'});
    expect(choice).toMatchObject({rotulo:'[rotulo-do-botao-exibido]',opcao_selecionada_1:'[nome-publico-selecionado]'});
    expect(result.changes.find((change)=>change.file.endsWith('page.html'))!.after).toContain('[attr.data-at-option]="item.label"');
    const staticAction = entries.find((entry) => entry.rotulo === 'abrir-opcoes')!;
    expect(staticAction.opcao_selecionada_1).toBeUndefined();

    document.body.innerHTML = fs.readFileSync(path.join(root, 'src/features/catalogo/page.html'), 'utf8');
    const action = document.getElementById('action')!;
    const select = document.getElementById('selection') as HTMLSelectElement;
    const surfaces = new AutoTrackingSurfaces('app', () => ({funcionalidade:'catalogo',tela:'catalogo'}));
    stop = installDomTracker(document, {owner:'app',mode:'ref',product:'produto',schema:examplePreset.schema,surfaces,
      resolveEnvironment:async ()=>'app-x',send:(event)=>{sent.push(event);},warn:(message)=>{warnings.push(message);}});
    const choose = (items: readonly {id: string; label: string}[], id: string, label: string) => {
      select.replaceChildren(...items.map((item) => {const option=document.createElement('option'); option.value=item.id; option.textContent=item.label; return option;}));
      select.value=id; select.setAttribute('aria-label',label); select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    action.innerHTML = '<span>Confirmar</span> <b>escolha</b><span hidden>Segredo</span>';
    action.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    choose([{id:'opaque-1',label:'Unidade Norte'},{id:'opaque-2',label:'Unidade Sul'}],'opaque-2','Escolher unidade');
    choose([{id:'opaque-3',label:'Unidade Leste'},{id:'opaque-4',label:'Unidade Oeste'}],'opaque-3','Alterar unidade');
    action.textContent='Continuar'; action.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    document.getElementById('static')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const definition = new AngularProjectIndexer().buildProjectIndex(path.join(root,'src')).surfaces![0]!.definition;
    const portal=document.createElement('dialog'); portal.innerHTML='<button aria-label="Reservar" data-public-option="Espaço Norte">Escolher</button>'; document.body.append(portal);
    const detach=surfaces.attach(portal,definition,surfaces.capture());
    const button=portal.querySelector('button')!;
    button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    button.setAttribute('data-public-option','Espaço Sul'); button.setAttribute('aria-label','Trocar reserva');
    button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await flush();
    const listChoice=document.getElementById('list-choice')!;
    listChoice.textContent='Espaço Leste'; listChoice.setAttribute('data-at-option','Espaço Leste'); listChoice.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    listChoice.textContent='Espaço Oeste'; listChoice.setAttribute('data-at-option','Espaço Oeste'); listChoice.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await flush();
    const clicks=sent.filter((event)=>event.name==='click');
    expect(clicks.map((event)=>[event.params['rotulo'],event.params['opcao_selecionada_1']])).toEqual([
      ['confirmar-escolha',undefined],['escolher-unidade','unidade-sul'],['alterar-unidade','unidade-leste'],
      ['continuar',undefined],['abrir-opcoes',undefined],['reservar','espaco-norte'],['trocar-reserva','espaco-sul'],['escolher','espaco-leste'],['escolher','espaco-oeste'],
    ]);
    expect(clicks.every((event)=>event.params['tela']==='app-x:produto:catalogo' && event.params['funcionalidade']==='catalogo')).toBe(true);
    expect(warnings).toEqual([]);
    // Sem correspondência pública, nem ID nem objeto nem placeholder pode chegar ao dispatch.
    select.dispatchEvent(new CustomEvent('change',{bubbles:true,detail:{value:'opaque-missing'}}));
    select.dispatchEvent(new CustomEvent('change',{bubbles:true,detail:{value:{id:9}}}));
    select.options[0]!.textContent='teste@example.com'; select.value='opaque-3'; select.dispatchEvent(new Event('change',{bubbles:true}));
    await flush(); expect(sent.filter((event)=>event.name==='click')).toHaveLength(9);
    expect(warnings).toHaveLength(3);
    expect(JSON.stringify(sent)).not.toMatch(/opaque|\[valor|example.com|Segredo/);
    // Fechado, o framework remove o portal do DOM.
    detach(); button.closest('dialog, [role=dialog], ion-modal')?.remove(); button.dispatchEvent(new MouseEvent('click',{bubbles:true})); await flush();
    expect(sent.filter((event)=>event.name==='click')).toHaveLength(9);

    const file=path.join(root,'evidencia.xlsx');
    await writeEvidenceWorkbook(file,{owner:'app',product:'produto',branding:{},entries:result.entries},'value-contract');
    const ExcelJS=await loadWorkbookProvider(); const book=new ExcelJS.Workbook(); await book.xlsx.readFile(file);
    const cells: string[]=[]; book.eachSheet((sheet)=>sheet.eachRow((row)=>row.eachCell((cell)=>cells.push(String(cell.value)))));
    expect(cells).toEqual(expect.arrayContaining(['[valor-selecionado]','[nome-publico-selecionado]','[rotulo-do-botao-exibido]','abrir-opcoes']));
    let matched=0;
    book.eachSheet((sheet)=>sheet.eachRow((row)=>{
      const values: string[]=[]; row.eachCell((cell)=>values.push(String(cell.value)));
      if(values.includes(choice.id)){ expect(values).toEqual(expect.arrayContaining([choice.rotulo,choice.opcao_selecionada_1!])); matched++; }
      if(values.includes(selection.id)){ expect(values).toEqual(expect.arrayContaining([selection.rotulo,selection.opcao_selecionada_1!])); matched++; }
    }));
    expect(matched).toBe(2);
    expect(cells.join(' ')).not.toMatch(/item\.label|selectionLabel|actionLabel|opaque/);
  } finally { stop(); document.body.innerHTML=''; fs.rmSync(root,{recursive:true,force:true}); }
});

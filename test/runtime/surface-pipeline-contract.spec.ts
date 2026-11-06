/** @jest-environment jsdom */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { AngularProjectIndexer } from '../../src/adapters/angular-compiler/project-index.js';
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { createTrackingSurface } from '../../src/adapters/runtime/create-tracking-surface.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

it('pareia a superfície TS gerada com o evento real do DOM e reconcilia mudança sem duplicar o gesto', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-source-runtime-'));
  const write = (file: string, text: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  let stop = () => {};
  let deactivate = () => {};
  try {
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}');
    write('package.json', '{"dependencies":{}}');
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects:[{angularProject:'app',tsconfig:'tsconfig.app.json'}],
      runtime:{owner:'app',root:'app-root',product:'produto',mode:'ref',send:()=>{}}});`);
    write('src/routes.ts', `import { Page } from './page'; export const routes = [{path:'inicio',component:Page}];
      const providers = [provideAutoTracking(config.runtime)];`);
    write('src/page.ts', `import { ModalService } from './modal.service';
      @Component({selector:'app-page',template:'<button (click)="abrir()">Ajuda</button>'})
      export class Page { constructor(private modal: ModalService){} abrir(){this.modal.abrir();} }`);
    write('src/modal.service.ts', `import { defineTrackingSurface } from 'auto-tracking-angular';
      export class ModalService { abrir(){return defineTrackingSurface({id:'ajuda',actions:[
        {id:'tipo',selector:'select',elemento:'dropdown',rotulo:'Tipo',event:'change'},
        {id:'fechar',selector:'#fechar',elemento:'botao',rotulo:'Fechar ajuda'}]});} }`);
    const pipeline = new TrackingPipelineFactory().create();
    const run = () => pipeline.runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    const first = run();
    expect(first.diagnostics).toEqual([]);
    for (const change of first.changes) fs.writeFileSync(change.file, change.after);
    expect(run().changes).toEqual([]);
    const definition = () => new AngularProjectIndexer().buildProjectIndex(path.join(root, 'src')).surfaces![0]!.definition;
    const origin = first.entries.find((entry) => entry.evento === 'screen_view')!;
    const screen = { funcionalidade: origin.funcionalidade, tela: origin.tela };
    const surfaces = new AutoTrackingSurfaces('app', () => screen);
    deactivate = AutoTrackingSurfaces.activate(document, surfaces);
    const events: TrackingEvent[] = [];
    const warnings: string[] = [];
    stop = installDomTracker(document, { owner: 'app', mode: 'ref', product: 'produto', surfaces,
      schema: examplePreset.schema, resolveEnvironment: async () => 'app-x',
      send: (event) => { events.push(event); }, warn: (warning) => { warnings.push(warning); } });
    const portal = document.createElement('dialog');
    portal.innerHTML = '<select><option value="1">Consulta</option><option value="2" selected>Exame</option></select><button id="fechar">Fechar</button>';
    document.body.append(portal);
    await createTrackingSurface(surfaces, definition(), async () => portal);
    portal.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
    portal.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const report = JSON.parse(first.relatorio);
    for (const [index, id] of ['ajuda-tipo', 'ajuda-fechar'].entries()) {
      const entry = report.entries.find((item: { id: string }) => item.id === id);
      expect(entry.telas).toEqual([`${screen.funcionalidade}:${screen.tela}`]);
      expect(events[index]).toMatchObject({ name: entry.evento, params: {
        rotulo: entry.rotulo, elemento: entry.elemento, funcionalidade: screen.funcionalidade,
        tela: `app-x:produto:${screen.funcionalidade}:${screen.tela}`, categoria: `app-x:produto:${screen.funcionalidade}:${screen.tela}`,
      } });
    }
    expect(events).toHaveLength(2);
    expect(events[0]!.params['opcao_selecionada_1']).toBe('exame');
    const serviceFile = path.join(root, 'src/modal.service.ts');
    fs.writeFileSync(serviceFile, fs.readFileSync(serviceFile, 'utf8').replace('Fechar ajuda', 'Concluir ajuda'));
    const updated = run();
    for (const change of updated.changes) fs.writeFileSync(change.file, change.after);
    expect(updated.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id));
    portal.removeAttribute('data-at-ref');
    // Novo portal representa a reabertura do framework depois de recompilar a declaração.
    const reopened = portal.cloneNode(true) as HTMLElement;
    portal.remove(); document.body.append(reopened);
    await createTrackingSurface(surfaces, definition(), async () => reopened);
    reopened.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(3);
    expect(events[2]!.params['rotulo']).toBe(updated.entries.find((entry) => entry.id === 'ajuda-fechar')!.rotulo);
    expect(run().changes).toEqual([]);
    expect(warnings).toEqual([]);
  } finally {
    stop(); deactivate(); document.body.innerHTML = '';
    fs.rmSync(root, { recursive: true, force: true });
  }
});

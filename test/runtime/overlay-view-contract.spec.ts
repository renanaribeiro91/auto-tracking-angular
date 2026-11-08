/** @jest-environment jsdom */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('visualizacao de overlay: planilha e runtime com o mesmo contrato', () => {
  let root: string;
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-overlay-view-'));
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}');
    write('package.json', '{"dependencies":{}}');
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects:[{angularProject:'app',tsconfig:'tsconfig.app.json'}],
      runtime:{owner:'app',root:'app-root',product:'saude',mode:'ref',send:()=>{}}});`);
    write('src/routes.ts', `import { FaturasPage } from './faturas/faturas.page'; export const routes = [{path:'faturas',component:FaturasPage}];
      const providers = [provideAutoTracking(config.runtime)];`);
    write('src/faturas/faturas.page.ts', `import { IndisponivelModal } from './indisponivel.modal'; import { SemTituloModal } from './sem-titulo.modal';
      @Component({selector:'app-faturas', templateUrl:'./faturas.page.html'})
      export class FaturasPage { constructor(private modalController: ModalController, private dialog: MatDialog) {}
        async abrir() { const modal = await this.modalController.create({ component: IndisponivelModal }); await modal.present(); }
        abrirOutro() { this.dialog.open(SemTituloModal); } }`);
    write('src/faturas/faturas.page.html', `<ion-header><ion-title>Faturas</ion-title></ion-header>
      <button (click)="abrir()">Ver</button><button (click)="abrirOutro()">Enviar</button>
      <ion-modal trigger="abrir-ajuda-faturas"><ng-template><p>Ajuda</p></ng-template></ion-modal>
      <ion-modal [isOpen]="aberto"><ng-template><p>Sem nome</p></ng-template></ion-modal>`);
    write('src/faturas/indisponivel.modal.ts', `@Component({selector:'app-indisponivel-modal', template:'<div class="m"><h2>Indisponibilidade temporária</h2><button (click)="fechar()">Ok</button></div>'})
      export class IndisponivelModal { fechar() {} }`);
    write('src/faturas/sem-titulo.modal.ts', `@Component({selector:'app-confirmar-envio-dialog', template:'<section><p>Confirma?</p></section>'})
      export class SemTituloModal {}`);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('CLI registra a visualizacao com rótulo provado e o runtime envia exatamente esse contrato', async () => {
    const pipeline = new TrackingPipelineFactory().create();
    const run = () => pipeline.runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    const first = run();
    for (const change of first.changes) fs.writeFileSync(change.file, change.after);
    expect(run().changes).toEqual([]); // idempotente
    const views = first.entries.filter((entry) => entry.evento === 'visualizacao');
    expect(views.map((entry) => [entry.elemento, entry.rotulo, entry.telas])).toEqual(expect.arrayContaining([
      ['modal', 'indisponibilidade-temporaria', ['faturas:faturas']],
      ['modal', 'confirmar-envio', ['faturas:faturas']],
      ['modal', 'ajuda-faturas', ['faturas:faturas']],
    ]));
    expect(views).toHaveLength(3);
    expect(first.diagnostics.map((item) => item.code)).toContain('OVERLAY_NAME_UNPROVEN'); // [isOpen]="aberto" sem nome

    // Runtime: o modal apresentado pelo controller contém o template tagueado do componente.
    const modalHtml = fs.readFileSync(path.join(root, 'src/faturas/indisponivel.modal.ts'), 'utf8').match(/template:'([^']*)'/)![1]!;
    const ref = /data-at-ref="([^"]+)"/.exec(modalHtml)![1]!;
    expect(decodeTrackingToken(ref)?.view).toMatchObject({ elemento: 'modal', rotulo: 'indisponibilidade-temporaria' });
    document.body.innerHTML = `<ion-modal><app-indisponivel-modal>${modalHtml.replace(/<h2>[^<]*<\/h2>/, '<h2>Título trocado em runtime</h2>')}</app-indisponivel-modal></ion-modal>`;
    const sent: TrackingEvent[] = [];
    const stop = installDomTracker(document, { owner: 'app', mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces('app', () => ({ funcionalidade: 'faturas', tela: 'faturas' })),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    try {
      document.querySelector('ion-modal')!.dispatchEvent(new CustomEvent('ionModalDidPresent', { bubbles: true, composed: true }));
      await flush();
      expect(sent).toEqual([{ name: 'visualizacao', params: { ambiente: 'app-x', produto: 'saude', funcionalidade: 'faturas',
        subfuncionalidade: 'faturas', tela: 'app-x:saude:faturas', categoria: 'app-x:saude:faturas',
        elemento: 'modal', rotulo: 'indisponibilidade-temporaria', acao: 'visualizacao' } }]);
    } finally { stop(); }
  });

  it('diálogo fora do Ionic emite ao abrir, uma vez por abertura; sem nome não envia', async () => {
    document.body.innerHTML = '';
    const sent: TrackingEvent[] = []; const warns: string[] = [];
    const stop = installDomTracker(document, { owner: 'app', mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces('app', () => ({ funcionalidade: 'faturas', tela: 'lista' })),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: (message) => { warns.push(message); } });
    try {
      const pane = document.createElement('div');
      pane.className = 'cdk-overlay-pane';
      pane.innerHTML = '<mat-dialog-container role="dialog" aria-modal="true"><div class="mat-mdc-dialog-surface"><app-excluir-cartao-dialog><p>Excluir?</p></app-excluir-cartao-dialog></div></mat-dialog-container>';
      document.body.append(pane);
      const nativo = document.createElement('dialog');
      nativo.innerHTML = '<h3>Termos de uso</h3>';
      document.body.append(nativo);
      const anonimo = document.createElement('div');
      anonimo.setAttribute('role', 'dialog'); anonimo.setAttribute('aria-modal', 'true');
      document.body.append(anonimo);
      await flush();
      nativo.setAttribute('open', '');
      await flush();
      nativo.removeAttribute('open');
      await flush();
      nativo.setAttribute('open', '');
      await flush(); await flush();
      expect(sent.map((event) => [event.params['elemento'], event.params['rotulo']])).toEqual([
        ['modal', 'excluir-cartao'], ['modal', 'termos-de-uso'], ['modal', 'termos-de-uso']]);
      expect(warns.some((message) => message.includes('sem título nem componente'))).toBe(true);
    } finally { stop(); }
  });
});

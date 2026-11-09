/** @jest-environment jsdom */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrackingPipelineFactory } from '../../src/cli/tracking-pipeline-composition.js';
import { AutoTrackingSurfaces, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const LIB_TEMPLATE = '<h2>{{ title }}</h2>'
  + '<i *ngIf="fecharVisivel" role="button" aria-label="Botão fechar da modal" (click)="x()"></i>'
  + '<div *ngIf="link"><a (click)="y()"><span>{{ link }}</span></a></div>'
  + '<div *ngFor="let b of botoes"><button [title]="b.t" (click)="z()"></button></div>';
const LIB_MODAL = `class LibModal { constructor() { this.fecharVisivel = true; this.link = undefined; } }
LibModal.cmp = i0.ɵɵngDeclareComponent({ type: LibModal, selector: 'lib-modal', template: ${JSON.stringify(LIB_TEMPLATE)} });`;

describe('clique de overlay sem template no projeto: planilha igual ao runtime', () => {
  let root: string;
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const clicksOf = (page: string) => {
    write('src/p/p.page.ts', `import { LibModal } from 'lib-externa';
      @Component({selector:'app-p', templateUrl:'./p.page.html'}) export class PPage {
        constructor(private modalCtrl: ModalController, private alertCtrl: AlertController, private actionSheetCtrl: ActionSheetController) {}
        ${page} }`);
    const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
    expect(result.diagnostics).toEqual([]);
    return result.entries.filter((entry) => entry.origem?.includes('()') && entry.evento === 'click');
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-overlay-click-'));
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}');
    write('package.json', '{"dependencies":{"lib-externa":"1.0.0"}}');
    write('node_modules/lib-externa/package.json', '{"module":"fesm2022/lib.mjs"}');
    write('node_modules/lib-externa/fesm2022/lib.mjs', LIB_MODAL);
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects:[{angularProject:'app',tsconfig:'tsconfig.app.json'}],
      runtime:{owner:'app',root:'app-root',product:'saude',mode:'ref',send:()=>{}}});`);
    write('src/routes.ts', `import { PPage } from './p/p.page'; export const routes = [{path:'extratos',component:PPage}];
      const providers = [provideAutoTracking(config.runtime)];`);
    write('src/p/p.page.html', '<ion-header><ion-title>Extratos</ion-title></ion-header><button (click)="abrir(a, b)">Abrir</button>');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const labels = (page: string) => clicksOf(page).map((entry) => [entry.elemento, entry.rotulo, entry.telas]);
  const screens = ['p:p'];

  it('lê botões, ícone de fechar e link do componente de biblioteca, respeitando as opções da abertura', () => {
    expect(labels(`abrir() { const ok = { title: 'Entendi' };
      return this.modalCtrl.create({ component: LibModal, componentProps: { title: 'Extrato indisponível', link: 'Saiba mais', botoes: [ok, { title: 'Sair' }] } }); }`))
      .toEqual([['modal', 'entendi-extrato-indisponivel', screens], ['modal', 'sair-extrato-indisponivel', screens],
        ['modal', 'fechar-extrato-indisponivel', screens], ['modal', 'saiba-mais-extrato-indisponivel', screens]]);
  });

  it('texto só conhecido em runtime vira marcador; opção false esconde o gesto', () => {
    expect(labels(`abrir(titulo: string, botao: string) {
      return this.modalCtrl.create({ component: LibModal, componentProps: { title: titulo, fecharVisivel: false, botoes: [{ title: botao }] } }); }`))
      .toEqual([['modal', '[rotulo-do-botao-exibido]-[titulo-do-modal-exibido]', screens]]);
  });

  it('alerta e menu: buttons em objeto ou texto, ramos condicionais, sem repetir o título nem contar campo de texto', () => {
    expect(labels(`abrir(a: boolean) { return this.alertCtrl.create({ header: 'Excluir', inputs: [{ type: 'text', label: 'Nome' }],
      buttons: a ? [{ text: 'Cancelar', role: 'cancel' }, 'Excluir'] : ['Voltar'] }); }`))
      .toEqual([['alerta', 'cancelar-excluir', screens], ['alerta', 'excluir', screens], ['alerta', 'voltar-excluir', screens]]);
    expect(labels(`abrir() { return this.actionSheetCtrl.create({ buttons: [{ text: 'Câmera' }, { text: 'Galeria' }] }); }`))
      .toEqual([['menu-de-opcoes', 'camera-menu-de-opcoes', screens], ['menu-de-opcoes', 'galeria-menu-de-opcoes', screens]]);
  });

  it.each([
    ['opções vindas de parâmetro', 'abrir(opcoes: any) { return this.modalCtrl.create(opcoes); }'],
    ['spread nas opções', 'abrir(base: any) { return this.modalCtrl.create({ ...base, component: LibModal }); }'],
    ['componente de tipo desconhecido', 'abrir(c: any) { return this.modalCtrl.create({ component: c }); }'],
    ['lista montada por função', 'abrir() { return this.alertCtrl.create({ header: "Aviso", buttons: this.montar() }); }'],
  ])('estrutura desconhecida (%s) nunca quebra nem some: fica com marcador', (_name, page) => {
    expect(clicksOf(page).some((entry) => entry.rotulo.includes('[rotulo-do-botao-exibido]'))).toBe(true);
  });

  it('o runtime envia exatamente o rótulo da planilha', async () => {
    const expected = clicksOf(`abrir() { return this.modalCtrl.create({ component: LibModal, componentProps: { title: 'Extrato indisponível', botoes: [{ title: 'Entendi' }] } }); }`)
      .map((entry) => entry.rotulo);
    document.body.innerHTML = `<ion-modal><lib-modal><h2>Extrato indisponível</h2>
      <i id="fechar" role="button" aria-label="Botão fechar da modal"></i><button id="ok">Entendi</button></lib-modal></ion-modal>`;
    const sent: TrackingEvent[] = [];
    const stop = installDomTracker(document, { owner: 'app', mode: 'ref', product: 'saude', schema: examplePreset.schema,
      surfaces: new AutoTrackingSurfaces('app', () => ({ funcionalidade: 'extratos', tela: 'extratos' })),
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: () => {} });
    try {
      document.getElementById('ok')!.click();
      document.getElementById('fechar')!.click();
      await flush(); await flush();
      expect(sent.map((event) => event.params['rotulo']).sort()).toEqual([...expected].sort());
    } finally { stop(); }
  });
});

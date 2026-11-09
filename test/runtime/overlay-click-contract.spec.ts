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

  it('versão do código sai do módulo, salvo quando as duas gerações convivem', () => {
    for (const name of ['login-v2', 'conta', 'conta-v2']) {
      const cls = name.replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase());
      write(`src/pages/${name}/${name}.page.ts`, `@Component({selector:'app-${name}', templateUrl:'./${name}.page.html'}) export class ${cls}Page {}`);
      write(`src/pages/${name}/${name}.page.html`, '<ion-content></ion-content>');
    }
    write('src/routes.ts', `import { LoginV2Page } from './pages/login-v2/login-v2.page'; import { ContaPage } from './pages/conta/conta.page'; import { ContaV2Page } from './pages/conta-v2/conta-v2.page';
      export const r = [{ path: 'l', component: LoginV2Page }, { path: 'c', component: ContaPage }, { path: 'd', component: ContaV2Page }];`);
    const modulos = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts')).entries
      .filter((entry) => entry.evento === 'screen_view').map((entry) => entry.funcionalidade);
    expect(modulos).toEqual(expect.arrayContaining(['login', 'conta', 'conta-v2']));
    expect(modulos).not.toContain('login-v2');
  });

  it('método de serviço sem chamada não lista overlay; o chamado aparece na tela de quem chama', () => {
    write('src/p/m.service.ts', `@Injectable({ providedIn: 'root' }) export class MService {
      constructor(private modalCtrl: ModalController) {}
      async usado() { const m = await this.modalCtrl.create({ component: LibModal, componentProps: { title: 'Usado' } }); await m.present(); }
      async morto() { const m = await this.modalCtrl.create({ component: LibModal, componentProps: { title: 'Morto' } }); await m.present(); }
    }`);
    write('src/p/p.page.ts', `import { MService } from './m.service'; @Component({selector:'app-p', templateUrl:'./p.page.html'}) export class PPage {
      constructor(private m: MService) {} ngOnInit() { this.m.usado(); } }`);
    const origens = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts')).entries.map((entry) => entry.origem).join(' ');
    expect(origens).toContain('MService.usado');
    expect(origens).not.toContain('MService.morto');
  });

  it('lê botões, ícone de fechar e link do componente de biblioteca, respeitando as opções da abertura', () => {
    expect(labels(`abrir() { const ok = { title: 'Entendi' };
      return this.modalCtrl.create({ component: LibModal, componentProps: { title: 'Extrato indisponível', link: 'Saiba mais', botoes: [ok, { title: 'Sair' }] } }); }`))
      .toEqual([['modal', 'entendi-extrato-indisponivel', screens], ['modal', 'fechar-extrato-indisponivel', screens],
        ['modal', 'saiba-mais-extrato-indisponivel', screens], ['modal', 'sair-extrato-indisponivel', screens]]);
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

  describe('texto passado por parâmetro', () => {
    const run = () => {
      const result = new TrackingPipelineFactory().create().runPipeline(root, path.join(root, 'auto-tracking.config.ts'));
      expect(result.diagnostics).toEqual([]);
      return result.entries.filter((entry) => entry.origem?.includes('()')).map((entry) => [entry.evento, entry.rotulo, entry.telas]);
    };
    const page = (name: string, body: string) => {
      write(`src/${name}/${name}.page.ts`, `import { AvisosService } from '../avisos.service';
        @Component({selector:'app-${name}', templateUrl:'./${name}.page.html'}) export class P${name}Page { constructor(private avisos: AvisosService) {} ${body} }`);
      write(`src/${name}/${name}.page.html`, '<button (click)="abrir()">Abrir</button>');
    };
    beforeEach(() => {
      write('src/routes.ts', `import { PaPage } from './a/a.page'; import { PbPage } from './b/b.page'; import { PcPage } from './c/c.page';
        export const routes = [{path:'a',component:PaPage},{path:'b',component:PbPage},{path:'c',component:PcPage}];
        const providers = [provideAutoTracking(config.runtime)];`);
      write('src/constantes.ts', `export enum Titulos { INDISPONIVEL = 'Serviço indisponível' }
        export const Erros = { padrao: { 99: { title: 'Ops', arrayButtons: [{ title: 'Voltar' }] } } };`);
      write('src/avisos.service.ts', `import { LibModal } from 'lib-externa';
        export class AvisosService { constructor(private modalCtrl: ModalController) {}
          aviso(titulo: string, botao = 'OK') { return this.modalCtrl.create({ component: LibModal, componentProps: { title: titulo, fecharVisivel: false, botoes: [{ title: botao }] } }); }
          mostrar(props?: any) { const p = props ? props : Erros.padrao[99]; return this.modalCtrl.create({ component: LibModal, componentProps: { ...p, fecharVisivel: false, botoes: p.arrayButtons } }); }
          atalho(titulo: string) { return this.aviso(titulo, 'Entendi'); } }`);
    });

    it('cada tela mostra o título e o botão que a sua chamada comprova; só o valor de runtime fica marcador', () => {
      page('a', `abrir() { this.avisos.aviso(Titulos.INDISPONIVEL); }`);
      page('b', `abrir() { this.avisos.atalho('Atenção'); }`);
      page('c', `abrir(erro: any) { this.avisos.aviso(erro.message, 'Fechar'); }`);
      expect(run()).toEqual(expect.arrayContaining([
        ['visualizacao', 'servico-indisponivel', ['a:a']], ['click', 'ok-servico-indisponivel', ['a:a']],
        ['visualizacao', 'atencao', ['b:b']], ['click', 'entendi-atencao', ['b:b']],
        ['visualizacao', '[titulo-do-modal-exibido]', ['c:c']], ['click', 'fechar-[titulo-do-modal-exibido]', ['c:c']],
      ]));
    });

    it('segue método auxiliar do título; componente sem título usa o próprio nome e os botões do template', () => {
      write('node_modules/lib-externa/fesm2022/lib.mjs', `${LIB_MODAL}
class LibCrop {} LibCrop.cmp = i0.ɵɵngDeclareComponent({ type: LibCrop, selector: 'lib-crop[imagem]', template: '<lib-btn title="Cancelar" (onClick)="c()"></lib-btn>' });`);
      write('src/avisos.service.ts', `import { LibModal, LibCrop } from 'lib-externa';
        export class AvisosService { constructor(private modalCtrl: ModalController) {}
          private definir(t?: string) { let titulo = 'Desculpe!'; if (t) { titulo = t; } return titulo; }
          erro(mensagem: string, t?: string) { return this.modalCtrl.create({ component: LibModal, componentProps: { title: this.definir(t), fecharVisivel: false, description: mensagem, botoes: ['OK'] } }); }
          recorte(ver = false) { return this.modalCtrl.create({ component: ver ? LibModal : LibCrop, componentProps: { imagem: 'x' } }); } }`);
      write('src/textos.ts', `export default { TITULO: 'Sem conexão' };`);
      page('a', `abrir(erro: any) { this.avisos.erro(erro); }`);
      page('b', `abrir(erro: any) { this.avisos.erro(erro, Textos.TITULO); }`);
      const pageB = path.join(root, 'src/b/b.page.ts');
      fs.writeFileSync(pageB, `import Textos from '../textos';\n${fs.readFileSync(pageB, 'utf8')}`);
      page('c', `abrir(titulo: any) { this.avisos.erro('m', titulo.x); this.avisos.recorte(); }`);
      expect(run()).toEqual(expect.arrayContaining([
        ['visualizacao', 'desculpe', ['a:a']], ['click', 'ok-desculpe', ['a:a']],
        ['visualizacao', 'sem-conexao', ['b:b']], ['click', 'ok-sem-conexao', ['b:b']],
        ['visualizacao', '[titulo-do-modal-exibido]', ['c:c']],
        ['visualizacao', 'crop', ['c:c']], ['click', 'cancelar-modal', ['c:c']],
      ]));
    });

    it('objeto de opções vindo da chamada, de variável local, ou o padrão quando a chamada não passa nada', () => {
      page('a', `abrir() { const props = { title: 'Local', arrayButtons: [{ title: 'Ok' }] }; this.avisos.mostrar(props); }`);
      page('b', `abrir() { this.avisos.mostrar(); }`);
      page('c', `abrir() { this.avisos.mostrar({ title: 'Direto', arrayButtons: [{ title: 'Sim' }] }); }`);
      expect(run()).toEqual(expect.arrayContaining([
        ['visualizacao', 'local', ['a:a']], ['click', 'ok-local', ['a:a']],
        ['visualizacao', 'ops', ['b:b']], ['click', 'voltar-ops', ['b:b']],
        ['visualizacao', 'direto', ['c:c']], ['click', 'sim-direto', ['c:c']],
      ]));
    });
  });
});

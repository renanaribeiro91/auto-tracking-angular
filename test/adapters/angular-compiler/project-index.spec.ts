import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AngularProjectIndexer } from '../../../src/adapters/angular-compiler/project-index.js';

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('AngularProjectIndexer', () => {
  it('relaciona componente passado por import dinâmico com alias ao método do serviço, sem confundir homônimos', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-dynamic-component-'));
    try {
      write(root, 'a/modal.ts', `@Component({ selector: 'app-modal-a', template: '<button>Confirmar</button>' }) export class ModalComponent {}`);
      write(root, 'b/modal.ts', `@Component({ selector: 'app-modal-b', template: '' }) export class ModalComponent {}`);
      write(root, 'modal.service.ts', `export class ModalService {
        async abrirA() { const { ModalComponent: View } = await import('./a/modal'); this.montar(View); }
        async abrirB() { const { ModalComponent: View } = await import('./b/modal'); this.montar(View); }
        montar(component: unknown) { createComponent(component); }
      }`);
      const index = new AngularProjectIndexer().buildProjectIndex(root);
      const service = index.services.get(`${path.join(root, 'modal.service.ts')}#ModalService`)!;
      expect(service.openedComponents.get('abrirA')).toEqual(new Set([`${path.join(root, 'a/modal.ts')}#ModalComponent`]));
      expect(service.openedComponents.get('abrirB')).toEqual(new Set([`${path.join(root, 'b/modal.ts')}#ModalComponent`]));
      expect(service.openedComponents.has('montar')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('não deixa infraestrutura de teste sobrescrever componentes publicados', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-test-infra-'));
    try {
      write(root, 'page.component.ts', `@Component({ selector: 'app-page', template: '<demo-new-button (onClick)="save()"></demo-new-button>' }) export class PageComponent {}`);
      write(root, 'setup-jest.ts', `@Component({ selector: 'demo-new-button', template: '' }) export class DemoNewButtonMock {}`);
      write(root, 'page.component.test.ts', `@Component({ selector: 'demo-new-button', template: '' }) export class DemoNewButtonTestDouble {}`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);

      expect(index.components.map((component) => component.def.selectors)).toEqual([['app-page']]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('componente roteado que só embrulha o outlet é casca; com conteúdo próprio é tela', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-index-'));
    try {
      write(root, 'wrapper.component.ts', `@Component({ selector: 'app-w', template: '<div class="x"><ion-router-outlet></ion-router-outlet></div>' }) export class WrapperComponent {}`);
      write(root, 'abas.page.ts', `@Component({ selector: 'app-a', template: '<ion-segment></ion-segment><ion-router-outlet></ion-router-outlet>' }) export class AbasPage {}`);
      write(root, 'routes.ts', `import { WrapperComponent } from './wrapper.component'; import { AbasPage } from './abas.page'; export const routes = [{ path: 'w', component: WrapperComponent }, { path: 'a', component: AbasPage }];`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);
      expect(index.shellComponents).toEqual(new Set([`${path.join(root, 'wrapper.component.ts')}#WrapperComponent`]));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rota-casca com filho de caminho vazio é casca; sem esse filho, a própria rota é destino', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-index-'));
    try {
      write(root, 'casca.page.ts', `@Component({ selector: 'app-casca', template: '' }) export class CascaPage {}`);
      write(root, 'destino.page.ts', `@Component({ selector: 'app-destino', template: '' }) export class DestinoPage {}`);
      write(root, 'routes.ts', `import { CascaPage } from './casca.page'; import { DestinoPage } from './destino.page'; export const routes = [
        { path: 'a', component: CascaPage, children: [{ path: '', redirectTo: 'x', pathMatch: 'full' }] },
        { path: 'b', component: DestinoPage, children: [{ path: 'y', loadChildren: () => null }] }];`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);
      expect(index.shellComponents).toEqual(new Set([`${path.join(root, 'casca.page.ts')}#CascaPage`]));
      expect(index.routedComponents.size).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolve rota para a declaração importada quando existem classes homônimas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-index-'));
    try {
      write(root, 'area-a/resumo.page.ts', `@Component({ selector: 'app-a', template: '' }) export class ResumoPage {}`);
      write(root, 'area-b/resumo.page.ts', `@Component({ selector: 'app-b', template: '' }) export class ResumoPage {}`);
      write(root, 'area-a/modal.service.ts', `export class ModalService { open() {} }`);
      write(root, 'area-b/modal.service.ts', `export class ModalService { close() {} }`);
      write(root, 'area-a/page.component.ts', `import { ModalService } from './modal.service'; @Component({ selector: 'app-page', template: '' }) export class PageComponent { constructor(private modal: ModalService) {} }`);
      write(root, 'routes.ts', `import { ResumoPage } from './area-a/resumo.page'; import { PageComponent } from './area-a/page.component'; export const routes = [{ path: 'resumo', component: ResumoPage }, { path: 'page', component: PageComponent }];`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);
      const expected = `${path.join(root, 'area-a/resumo.page.ts')}#ResumoPage`;
      expect(index.components.filter((item) => item.className === 'ResumoPage')).toHaveLength(2);
      expect(index.routedComponents).toEqual(new Set([expected, `${path.join(root, 'area-a/page.component.ts')}#PageComponent`]));
      expect(index.services.size).toBe(2);
      expect(index.components.find((item) => item.className === 'PageComponent')?.serviceDependencies.get('modal')).toBe(
        `${path.join(root, 'area-a/modal.service.ts')}#ModalService`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolve serviço injetado por barrels encadeados sem confundir homônimos', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-barrel-service-'));
    try {
      write(root, 'common/services/processar.service.ts', `export class ProcessarService { abrir() {} }`);
      write(root, 'other/processar.service.ts', `export class ProcessarService {}`);
      write(root, 'common/services/index.ts', `export * from './processar.service';`);
      write(root, 'common/index.ts', `export * from './services';`);
      write(root, 'page.ts', `import { ProcessarService } from './common'; @Component({ selector: 'app-page', template: '' }) export class PageComponent { private readonly processar = inject(ProcessarService); abrir() { this.processar.abrir(); } }`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);
      expect(index.components.find((item) => item.className === 'PageComponent')?.serviceDependencies.get('processar')).toBe(
        `${path.join(root, 'common/services/processar.service.ts')}#ProcessarService`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('não associa serviço quando dois barrels exportam classes homônimas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-ambiguous-barrel-'));
    try {
      write(root, 'a/service.ts', `export class ModalService {}`);
      write(root, 'b/service.ts', `export class ModalService {}`);
      write(root, 'index.ts', `export * from './a/service'; export * from './b/service';`);
      write(root, 'page.ts', `import { ModalService } from './index'; @Component({ selector: 'app-page', template: '' }) export class PageComponent { modal = inject(ModalService); }`);
      const index = new AngularProjectIndexer().buildProjectIndex(root);
      expect(index.components.find((item) => item.className === 'PageComponent')?.serviceDependencies.has('modal')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('expõe diagnóstico para rota ambígua sem associar os dois componentes por engano', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-ambiguous-route-'));
    try {
      write(root, 'area-a/resumo.page.ts', `@Component({ selector: 'app-a', template: '' }) export class ResumoPage {}`);
      write(root, 'area-b/resumo.page.ts', `@Component({ selector: 'app-b', template: '' }) export class ResumoPage {}`);
      write(root, 'routes.ts', `export const routes = [{ path: 'resumo', component: ResumoPage }];`);

      const index = new AngularProjectIndexer().buildProjectIndex(root);
      expect(index.routedComponents).toEqual(new Set());
      expect(index.ambiguousRoutes).toEqual([{ file: path.join(root, 'routes.ts'), className: 'ResumoPage', line: 1 }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('texto comprovado no código, em qualquer forma de escrita', () => {
  const texts = (classBody: string, expression: string, extra: Record<string, string> = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-texto-'));
    try {
      write(root, 'pagina.page.ts', `@Component({ selector: 'app-pagina', template: '' }) export class PaginaPage { ${classBody} }`);
      for (const [file, content] of Object.entries(extra)) write(root, file, content);
      return new AngularProjectIndexer().buildProjectIndex(root).displayTexts!(`${path.join(root, 'pagina.page.ts')}#PaginaPage`, expression);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  it.each([
    ['propriedade literal', `botao = 'Salvar';`, 'botao', ['Salvar']],
    ['objeto na classe', `textos = { BOTAO: 'Salvar' };`, 'textos.BOTAO', ['Salvar']],
    ['ternário entre literal e membro', `outro = 'Voltar'; aberto = false;`, `aberto ? 'Salvar' : outro`, ['Salvar', 'Voltar']],
    ['atribuições comprovadas', `botao = 'A'; ngOnInit() { this.botao = 'B'; }`, 'botao', ['A', 'B']],
    ['getter', `get botao() { return 'Salvar'; }`, 'botao', ['Salvar']],
    ['método sem argumentos', `aberto = true; rotulo() { if (this.aberto) { return 'A'; } return 'B'; }`, 'rotulo()', ['A', 'B']],
  ])('%s', (_name, body, expression, expected) => {
    expect(texts(body, expression)).toEqual(expected);
  });

  it('constante movida para outro arquivo mantém o valor; valor alterado acompanha', () => {
    const body = `readonly textos = TEXTOS;`;
    expect(texts(body, 'textos.BOTAO', { 'textos.ts': `export const TEXTOS = { BOTAO: 'Salvar' };` })).toEqual(['Salvar']);
    expect(texts(body, 'textos.BOTAO', { 'textos.ts': `export const TEXTOS = { BOTAO: 'Confirmar' };` })).toEqual(['Confirmar']);
  });

  it.each([
    ['campo sobrescrito em runtime', `textos = { BOTAO: 'A' }; ngOnInit(p: any) { this.textos.BOTAO = p.x; }`, 'textos.BOTAO'],
    ['atribuição não comprovada', `botao = 'A'; ngOnInit(p: any) { this.botao = p.x; }`, 'botao'],
    ['sem valor no código', `botao: string;`, 'botao'],
    ['pipe', `botao = 'A';`, `botao | translate`],
    ['observable', `botao$ = of('A');`, `botao$ | async`],
    ['método com argumento', `rotulo(x: string) { return x; }`, `rotulo('a')`],
    ['membro inexistente (herança)', ``, 'botao'],
  ])('%s continua só em runtime', (_name, body, expression) => {
    expect(texts(body, expression)).toBeNull();
  });

  const inputTexts = (child: string, parents: readonly string[]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-input-'));
    try {
      write(root, 'filho.component.ts', `@Component({ selector: 'app-filho', template: '' }) export class FilhoComponent { ${child} }`);
      parents.forEach((template, index) => write(root, `pai${index}.page.ts`, `@Component({ selector: 'app-pai${index}', template: \`${template}\` }) export class Pai${index}Page { texto = 'Do pai'; }`));
      return new AngularProjectIndexer().buildProjectIndex(root).displayTexts!(`${path.join(root, 'filho.component.ts')}#FilhoComponent`, 'rotulo');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  it('@Input reúne o valor de todos os usos, inclusive o padrão', () => {
    expect(inputTexts(`@Input() rotulo = 'Padrao';`, [`<app-filho rotulo="Fixo"></app-filho>`, `<app-filho [rotulo]="texto"></app-filho>`, `<app-filho></app-filho>`])).toEqual(['Fixo', 'Do pai', 'Padrao']);
  });

  it('@Input com um uso desconhecido, variável de template ou sem uso fica em runtime', () => {
    expect(inputTexts(`@Input() rotulo = 'Padrao';`, [`<app-filho [rotulo]="apiValor"></app-filho>`])).toBeNull();
    expect(inputTexts(`@Input() rotulo = 'Padrao';`, [`<ng-container *ngFor="let texto of lista"><app-filho [rotulo]="texto"></app-filho></ng-container>`])).toBeNull();
    expect(inputTexts(`@Input() rotulo = 'Padrao';`, [])).toBeNull();
  });
});

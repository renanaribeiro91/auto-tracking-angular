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

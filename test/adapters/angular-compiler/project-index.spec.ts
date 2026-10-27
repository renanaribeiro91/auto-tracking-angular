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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AngularComponentCatalogBuilder } from '../../../src/adapters/angular-compiler/component-catalog.js';
import { TemplateAnalysis } from '../../../src/application/apply/template-analysis.js';
import type { ComponentDef } from '../../../src/application/apply/ports/component-catalog.js';

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('AngularComponentCatalogBuilder', () => {
  it('herda outputs e métodos da classe-base publicada por uma biblioteca Angular', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-catalog-'));
    try {
      write(root, 'package.json', JSON.stringify({ dependencies: { 'ui-kit': '1.0.0' } }));
      write(root, 'node_modules/ui-kit/fesm2022/ui-kit.mjs', `
        class BaseControl { setValue() { this.onChange.emit(); } }
        BaseControl.ɵcmp = i0.ɵɵngDeclareComponent({ type: BaseControl, selector: 'ng-component', outputs: { onChange: 'onChange' }, template: '' });
        class UiSelect extends BaseControl { select(event) { this.setValue(event); } }
        UiSelect.ɵcmp = i0.ɵɵngDeclareComponent({ type: UiSelect, selector: 'ui-select', template: '<ion-select (ionChange)="select($event)"></ion-select>' });
      `);
      const projectDef: ComponentDef = {
        selectors: ['app-page'], source: 'projeto', outputs: new Map(), inputs: new Set(), template: '<ui-select></ui-select>', methods: new Map(), hostListeners: [],
      };

      const catalog = new AngularComponentCatalogBuilder().buildCatalog(root, [projectDef]);
      const select = catalog.get('ui-select');

      expect(select?.outputs.get('onChange')).toBe('onChange');
      expect(select && new TemplateAnalysis().outputTriggers(select, 'onChange', catalog)).toEqual([{ event: 'ionChange', selector: 'ion-select' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolve CustomEvents públicos Stencil em dependência transitiva e preserva o nome físico do evento', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-stencil-'));
    try {
      write(root, 'package.json', JSON.stringify({ dependencies: { 'angular-wrapper': '1.0.0' } }));
      write(root, 'node_modules/angular-wrapper/package.json', JSON.stringify({ dependencies: { 'stencil-core': '1.0.0' } }));
      write(root, 'node_modules/stencil-core/package.json', JSON.stringify({ name: 'stencil-core' }));
      write(root, 'node_modules/stencil-core/dist/docs.json', JSON.stringify({
        components: [{
          tag: 'custom-action',
          events: [
            { event: 'actionConfirmed', bubbles: true, composed: true },
            { event: 'internalOnly', bubbles: false, composed: true },
          ],
        }],
      }));
      const projectDef: ComponentDef = {
        selectors: ['app-page'], source: 'projeto', outputs: new Map(), inputs: new Set(),
        template: '<custom-action (actionConfirmed)="confirmar()"></custom-action>',
        methods: new Map(), hostListeners: [],
      };
      const catalog = new AngularComponentCatalogBuilder().buildCatalog(root, [projectDef]);
      const component = catalog.get('custom-action');
      expect(component?.outputs.has('actionConfirmed')).toBe(true);
      expect(component?.outputs.has('internalOnly')).toBe(false);
      expect(component && new TemplateAnalysis().outputTriggers(component, 'actionConfirmed', catalog))
        .toEqual([{ event: 'actionConfirmed', selector: ':host' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('lê metadados Angular de pacotes aninhados em node_modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-transitive-'));
    try {
      write(root, 'package.json', JSON.stringify({ dependencies: { 'wrapper': '1.0.0' } }));
      write(root, 'node_modules/wrapper/package.json', JSON.stringify({ dependencies: { 'nested-ui': '1.0.0' } }));
      write(root, 'node_modules/wrapper/node_modules/nested-ui/fesm2022/ui.mjs', `
        class UiAction { onClick() { this.confirmed.emit(); } }
        UiAction.ɵcmp = i0.ɵɵngDeclareComponent({
          type: UiAction, selector: 'nested-action', outputs: { confirmed: 'confirmed' },
          template: '<button (click)="onClick()">OK</button>',
        });
      `);
      const projectDef: ComponentDef = {
        selectors: ['app-page'], source: 'projeto', outputs: new Map(), inputs: new Set(),
        template: '<nested-action (confirmed)="confirmar()"></nested-action>',
        methods: new Map(), hostListeners: [],
      };
      const catalog = new AngularComponentCatalogBuilder().buildCatalog(root, [projectDef]);
      const component = catalog.get('nested-action');
      expect(component?.outputs.get('confirmed')).toBe('confirmed');
      expect(component && new TemplateAnalysis().outputTriggers(component, 'confirmed', catalog))
        .toEqual([{ event: 'click', selector: 'button' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('não perde um output quando módulos distintos declaram o mesmo seletor', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-collision-'));
    try {
      write(root, 'package.json', JSON.stringify({ dependencies: {} }));
      const older: ComponentDef = {
        selectors: ['shared-action'], source: 'projeto',
        outputs: new Map([['voltar', 'voltar']]), inputs: new Set(),
        template: '<button (click)="onVoltar()">Voltar</button>',
        methods: new Map([['onVoltar', '{ this.voltar.emit(); }']]), hostListeners: [],
      };
      const newer: ComponentDef = {
        selectors: ['shared-action'], source: 'projeto',
        outputs: new Map([['avancar', 'avancar']]), inputs: new Set(),
        template: '<button (click)="onAvancar()">Avançar</button>',
        methods: new Map([['onAvancar', '{ this.avancar.emit(); }']]), hostListeners: [],
      };
      const catalog = new AngularComponentCatalogBuilder().buildCatalog(root, [older, newer]);
      expect(catalog.get('shared-action', 'voltar')).toBe(older);
      expect(catalog.get('shared-action', 'avancar')).toBe(newer);
      expect(new TemplateAnalysis().outputTriggers(older, 'voltar', catalog))
        .toEqual([{ event: 'click', selector: 'button', coveredByChild: true }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

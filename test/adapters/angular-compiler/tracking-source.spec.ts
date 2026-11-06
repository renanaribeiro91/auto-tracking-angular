import { reconcileTrackingSource } from '../../../src/adapters/angular-compiler/tracking-source.js';

describe('imports e injeção limitados à API pública do tracking', () => {
  it.each([
    ["import { Optional, Inject as Token } from '@angular/core';", '@Token(Surfaces)'],
    ["import * as ng from '@angular/core';", '@ng.Inject(Surfaces)'],
    ["import { Optional } from '@angular/core';", '@Inject(Surfaces)'],
    ['const Inject = 1;', '@AutoTrackingInject(Surfaces)'],
  ])('preserva aliases e gera token uma única vez: %s', (angular, token) => {
    const source = `${angular}\nimport type { AutoTrackingSurfaces as Surfaces, TrackingSurfaceDefinition } from 'auto-tracking-angular';
      class Modal { constructor(private tracking: Surfaces | null, private business: Business | null) {} }`;
    const result = reconcileTrackingSource(source);
    expect(result).toContain(token);
    expect(result).toContain('import { AutoTrackingSurfaces as Surfaces, type TrackingSurfaceDefinition }');
    expect(result).toContain('private business: Business | null');
    expect(result).not.toContain('@Inject(Business)');
    expect(reconcileTrackingSource(result)).toBe(result);
  });
  it('preserva bootstrap, providers e token explícito de negócio', () => {
    const source = `import { Inject as Token } from '@angular/core';
      import { AutoTrackingSurfaces } from 'auto-tracking-angular';
      @Component({standalone: true}) class App { constructor(@Token(CUSTOM) private tracking: AutoTrackingSurfaces | null) {} }
      @NgModule({imports:[App],bootstrap:[App],providers:[Other]}) class Module {}`;
    expect(reconcileTrackingSource(source)).toBe(source);
    expect(reconcileTrackingSource(source.replace('auto-tracking-angular','other'))).toBe(source.replace('auto-tracking-angular','other'));
  });
  it('preserva indentação e vírgula final, sem promover outros imports type-only', () => {
    const source = `import type {\n  Optional,\n  Injectable,\n} from '@angular/core';
      import { type AutoTrackingSurfaces } from 'auto-tracking-angular';
      class Modal {constructor(private tracking: AutoTrackingSurfaces | null){}}`;
    const result=reconcileTrackingSource(source);
    expect(result).toContain('import {\n  type Optional,\n  type Injectable,\n  Inject,\n}');
    expect(result).toContain('import { AutoTrackingSurfaces }');
    expect(reconcileTrackingSource(result)).toBe(result);
  });
  it('promove import de valor sem inserir token redundante num parâmetro não anulável', () => {
    const source=`import type { AutoTrackingSurfaces } from 'auto-tracking-angular'; class Modal {constructor(private tracking:AutoTrackingSurfaces){}}`;
    expect(reconcileTrackingSource(source)).toBe(source.replace('import type','import'));
  });
});

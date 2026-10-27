import { numericSelectionMethods, type NumericSelection } from '../../src/application/apply/selection-provenance.js';
import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';
import type { ComponentInfo } from '../../src/application/apply/ports/project-index.js';

const component = (classText: string, template: string, selectors: string[], inputs: string[] = [], outputs: string[] = [], methods: [string, string][] = []): ComponentInfo => ({
  classText, def: { source: 'projeto', selectors, template, inputs: new Set(inputs), outputs: new Map(outputs.map((name) => [name, name])), methods: new Map(methods), hostListeners: [] },
} as unknown as ComponentInfo);

describe('proveniência de opções numéricas em componentes repetidos', () => {
  const child = component('class Rating { eventClick: EventEmitter<number>; index: number; }', `<ion-icon [attr.aria-label]="'Avaliar com ' + index + ' estrelas'" (click)="onCliked()"></ion-icon>`, ['star-ranking'], ['index'], ['eventClick'], [['onCliked', '{ this.eventClick.emit(this.index); }']]);
  const parent = component('class Page { stars = [1, 2, 3, 4, 5]; }', '<ng-container *ngFor="let star of stars; let i = index"><star-ranking [index]="star"></star-ranking></ng-container>', ['app-page']);
  const ctx = (selectionMethods: ReadonlyMap<string, NumericSelection>): TagContext => ({ owner: 'mob', relFile: 'rating.html', funcionalidade: 'avaliacao', tela: 'rating', isScreen: false, catalog: { get: () => undefined }, usedIds: new Set(), selectionMethods });

  it('liga o valor emitido pelo componente ao gesto com origem numérica comprovada', () => {
    const methods = numericSelectionMethods(child, [parent, child]);
    expect([...methods]).toEqual([['onCliked', { input: 'index', allowed: ['1', '2', '3', '4', '5'] }]]);
    const result = tagTemplate(child.def.template, { ...ctx(methods), mode: 'ref' });
    const ref = /data-at-ref="([^"]+)"/.exec(result.html)?.[1];
    expect(ref).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(result.html).not.toContain('data-at-option=');
    expect(result.html).not.toContain('data-at-option-allowed=');
    expect(result.entries[0]?.opcao_selecionada_1).toBe('dinâmica (opção selecionada)');
    const descriptor = decodeTrackingToken(ref!);
    expect(descriptor?.click).toMatchObject({ opcaoFonte: 'aria-label-numero', opcaoPermitida: '1|2|3|4|5' });
    const second = tagTemplate(result.html, { ...ctx(methods), mode: 'ref' });
    expect(second.html).toBe(result.html);
  });

  it('não infere valores de serviço ou uso de seletor ambíguo', () => {
    const dynamic = component('class Page { stars = this.service.values; }', parent.def.template, ['app-page']);
    expect(numericSelectionMethods(child, [dynamic, child]).size).toBe(0);
    const nonfinite = component('class Page { stars = [1e999]; }', parent.def.template, ['app-page']);
    expect(numericSelectionMethods(child, [nonfinite, child]).size).toBe(0);
    expect(numericSelectionMethods(child, [parent, child, { ...child }]).size).toBe(0);
  });
});

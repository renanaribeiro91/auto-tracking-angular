import { decodeOutputBindings, encodeOutputBindings, type OutputBinding } from '../../src/domain/contract/output-bindings.js';

describe('contrato de outputs: compactação sem renomear eventos', () => {
  const samples: OutputBinding[] = [
    { id: 'profissionais-excluir', label: 'excluir', output: 'onClick', event: 'click', selector: '.icone > button' },
    { id: 'profissionais-excluir', label: 'excluir', output: 'onClick', event: 'click', selector: 'ion-button[data-testid="x,y|z;~"]' },
    { id: 'profissionais-excluir', label: 'excluir', output: 'onClick', event: 'ionChange', selector: '[role="switch"]' },
    { id: 'profissionais-voltar', label: 'voltar', output: 'onBack', event: 'click', selector: '#voltar' },
  ];

  it('agrupa múltiplos gestos, reduz tamanho e decodifica seletor com delimitadores', () => {
    const encoded = encodeOutputBindings(samples);
    expect(encoded.startsWith('v2:')).toBe(true);
    const legacy = samples.map((b) => `${b.id}|${b.event}|${b.selector}|${b.label}|${b.output}`).join(';');
    expect(encoded.length).toBeLessThan(legacy.length);
    expect(decodeOutputBindings(encoded)).toEqual(samples);
  });

  it('aceita atributo legado e mantém os IDs sem criar evento novo', () => {
    const old = 'profissionais-excluir|click|#voltar|excluir|onClick';
    expect(decodeOutputBindings(old)).toEqual([{ id: 'profissionais-excluir', event: 'click', selector: '#voltar', label: 'excluir', output: 'onClick' }]);
    expect(encodeOutputBindings(decodeOutputBindings(old))).toBe(old);
  });

  it('não reordena outputs intercalados que competem pelo mesmo seletor', () => {
    const interleaved = [samples[0]!, samples[3]!, samples[1]!];
    const encoded = encodeOutputBindings(interleaved);
    expect(encoded.startsWith('v2:')).toBe(true);
    expect(decodeOutputBindings(encoded)).toEqual(interleaved);
  });

  it('não gera saída por dados malformados e não lança exceção', () => {
    expect(decodeOutputBindings('v2:id|rotulo|click|invalid,%ZZ')).toEqual([]);
    expect(decodeOutputBindings('')).toEqual([]);
  });
});

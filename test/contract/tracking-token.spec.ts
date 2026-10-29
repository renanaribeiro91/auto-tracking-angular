import { decodeTrackingToken, encodeTrackingToken, TrackingTokenCache } from '../../src/domain/contract/tracking-token.js';
import type { TrackingElement } from '../../src/domain/contract/tracking-element.js';
import { deflateRaw } from 'pako';

describe('token autocontido: codec versionado e sem estado externo', () => {
  const contract: TrackingElement = {
    owner: 'fed-saude', funcionalidade: 'adicionar-exame', tela: 'adicionar-exame',
    click: { id: 'adicionar-exame-excluir', event: 'click', elemento: 'botao', rotulo: 'excluir' },
    outputs: [
      { id: 'voltar', event: 'click', selector: ':scope > button[aria-label="Voltar"]', label: 'voltar', output: 'back' },
      { id: 'enviar', event: 'ionChange', selector: '.selecionado', label: 'enviar', output: 'onChange' },
    ],
  };

  it('codifica dados completos, sem registro externo, determinístico e sem caracteres HTML especiais', () => {
    const first = encodeTrackingToken(contract);
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(encodeTrackingToken(contract)).toBe(first);
    expect(decodeTrackingToken(first)).toEqual(contract);
    expect(first.length).toBeLessThan(450);
  });

  it('outra identidade gera token diferente; Unicode e opções continuam intactos', () => {
    const changed: TrackingElement = { ...contract, click: { ...contract.click!, rotulo: 'exclusão de João' } };
    const a = encodeTrackingToken(changed);
    expect(a).not.toBe(encodeTrackingToken(contract));
    expect(decodeTrackingToken(a)).toEqual(changed);
  });

  it('falha fechada para versão, base64 inválido, JSON inválido, tamanho e valores malformados', () => {
    for (const token of ['', 'v2.abc', 'v1.__&&', 'v1.abcd', 'v1.' + 'a'.repeat(13_000)]) {
      expect(decodeTrackingToken(token)).toBeNull();
    }
  });

  it('não gera tokens que o próprio runtime rejeitaria', () => {
    expect(() => encodeTrackingToken({ ...contract, owner: 'x'.repeat(513) })).toThrow('contrato de tracking inválido');
    expect(() => encodeTrackingToken({ ...contract, outputs: Array.from({ length: 65 }, (_, index) => ({
      id: `id-${index}`, event: 'click', selector: '#button', label: 'selecionar', output: 'ok',
    })) })).toThrow('contrato de tracking inválido');
  });

  it('nega expansão excessiva de um token altamente comprimível', () => {
    const payload = deflateRaw('x'.repeat(200_000));
    const malicious = 'v1.' + btoa(Array.from(payload, (byte) => String.fromCharCode(byte)).join(''))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(decodeTrackingToken(malicious)).toBeNull();
  });

  it('cache limita bytes, sem invalidar a decodificação de tokens válidos', () => {
    const a = encodeTrackingToken(contract);
    const b = encodeTrackingToken({ ...contract, tela: 'nova-tela' });
    const cache = new TrackingTokenCache(10, a.length * 2 + 1);
    const first = cache.resolve(a);
    expect(first).toEqual(contract);
    expect(cache.resolve(b)?.tela).toBe('nova-tela');
    // O primeiro token foi desalojado pelo orçamento, mas continua válido.
    expect(cache.resolve(a)).toEqual(first);
    const noCapacity = new TrackingTokenCache(0, 0);
    expect(noCapacity.resolve(a)).toEqual(contract);
  });

  it('cache reusa contrato decodificado e limita crescimento de memória', () => {
    const cache = new TrackingTokenCache(2);
    const a = encodeTrackingToken(contract);
    const b = encodeTrackingToken({ ...contract, tela: 'segunda' });
    const c = encodeTrackingToken({ ...contract, tela: 'terceira' });
    expect(cache.resolve(a)).toBe(cache.resolve(a));
    expect(cache.resolve(b)?.tela).toBe('segunda');
    expect(cache.resolve(c)?.tela).toBe('terceira');
    expect(cache.resolve(a)).toEqual(contract);
    expect(cache.resolve('v1.invalido')).toBeNull();
  });
});

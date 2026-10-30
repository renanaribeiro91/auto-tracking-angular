// Codificação do token: usada só pelo CLI. Mantida fora do runtime para que o
// bundle do app não carregue a compressão do pako.
import { deflateRaw } from 'pako';
import type { TrackingElement } from './tracking-element.js';
import { MAX_PAYLOAD_SIZE, MAX_TOKEN_SIZE, PREFIX, pack, unpack } from './tracking-token.js';

/** Determinístico, URL/HTML-safe, sem criptografia ou dados secretos. */
export function encodeTrackingToken(contract: TrackingElement): string {
  const packed = pack(contract);
  if (!unpack(packed)) throw new Error('contrato de tracking inválido');
  const json = JSON.stringify(packed);
  if (json.length > MAX_PAYLOAD_SIZE) throw new Error('contrato de tracking excede limite');
  const compressed = deflateRaw(json, { level: 9 });
  if (compressed.length > MAX_TOKEN_SIZE * 3 / 4) throw new Error('token de tracking excede limite');
  const binary = Array.from(compressed, (byte) => String.fromCharCode(byte)).join('');
  const token = PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (token.length > MAX_TOKEN_SIZE) throw new Error('token de tracking excede limite');
  return token;
}

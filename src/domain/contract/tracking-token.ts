// Contrato puro/browser-safe. O token contém o evento inteiro; não há lookup externo.
import { deflateRaw, Inflate } from 'pako';
import type { TrackingElement } from './tracking-element.js';

const PREFIX = 'v1.';
const MAX_TOKEN_SIZE = 12_000;
const MAX_PAYLOAD_SIZE = 32_768;
const MAX_OUTPUTS = 64;

type Packed = [string, string, string, string | 0,
  [string, string, string, string, string | 0, string | 0] | 0,
  [string, string, string, string, string][] | 0,
  [string, string, string, string, string][] | 0];

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const safeText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2048;
const gestures = (value: unknown): value is [string, string, string, string, string][] =>
  Array.isArray(value) && value.length <= MAX_OUTPUTS && value.every((row) =>
    Array.isArray(row) && row.length === 5 && nonBlank(row[0]) && nonBlank(row[1])
      && nonBlank(row[2]) && safeText(row[3]) && nonBlank(row[4]));

function pack(contract: TrackingElement): Packed {
  return [contract.owner, contract.funcionalidade, contract.tela, contract.screenId ?? 0,
    contract.click ? [contract.click.id, contract.click.event, contract.click.elemento,
      contract.click.rotulo, contract.click.opcaoPermitida ?? 0, contract.click.opcaoFonte ?? 0] : 0,
    contract.outputs?.map(({ id, event, selector, label, output }) => [id, event, selector, label, output]) ?? 0,
    contract.overlayOutputs?.map(({ id, event, selector, label, output }) => [id, event, selector, label, output]) ?? 0];
}

function unpack(value: unknown): TrackingElement | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const [owner, funcionalidade, tela, screenId, click, outputs, overlayOutputs] = value;
  if (!nonBlank(owner) || !nonBlank(funcionalidade) || !nonBlank(tela)) return null;
  if (screenId !== 0 && !nonBlank(screenId)) return null;
  if (click !== 0 && (!Array.isArray(click) || click.length !== 6
    || !nonBlank(click[0]) || !nonBlank(click[1]) || !nonBlank(click[2]) || !safeText(click[3])
    || (click[4] !== 0 && !safeText(click[4])) || (click[5] !== 0 && click[5] !== 'aria-label-numero'))) return null;
  if (outputs !== 0 && !gestures(outputs)) return null;
  if (overlayOutputs !== 0 && !gestures(overlayOutputs)) return null;
  if (screenId === 0 && click === 0 && (!outputs || outputs.length === 0) && (!overlayOutputs || overlayOutputs.length === 0)) return null;
  const toBindings = (rows: [string, string, string, string, string][]) =>
    rows.map(([id, event, selector, label, output]) => ({ id, event, selector, label, output }));
  return {
    owner, funcionalidade, tela,
    ...(screenId ? { screenId } : {}),
    ...(click ? { click: { id: click[0], event: click[1], elemento: click[2], rotulo: click[3],
      ...(click[4] ? { opcaoPermitida: click[4] } : {}), ...(click[5] ? { opcaoFonte: click[5] } : {}) } } : {}),
    ...(outputs ? { outputs: toBindings(outputs) } : {}),
    ...(overlayOutputs ? { overlayOutputs: toBindings(overlayOutputs) } : {}),
  };
}

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

/** Falha fechada: tokens desconhecidos, incompletos ou malformados nunca disparam evento. */
export function decodeTrackingToken(token: string): TrackingElement | null {
  if (!token.startsWith(PREFIX) || token.length > MAX_TOKEN_SIZE || !/^v1\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const encoded = token.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    const compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // Limita a saída durante a descompressão, não depois: tokens hostis
    // não podem expandir indefinidamente antes da validação do JSON.
    const inflater = new Inflate({ raw: true, to: 'string', chunkSize: 8192 });
    const chunks: string[] = [];
    let expanded = 0;
    inflater.onData = (chunk) => {
      const value: unknown = chunk; // pako tipa como bytes mesmo quando 'to: string' está ativo.
      if (typeof value !== 'string') throw new Error('payload inválido');
      expanded += value.length;
      if (expanded > MAX_PAYLOAD_SIZE) throw new Error('payload excede limite');
      chunks.push(value);
    };
    inflater.push(compressed, true);
    if (inflater.err) return null;
    return unpack(JSON.parse(chunks.join('')));
  } catch { return null; }
}

/** Cache LRU limitado evita custo de inflate/parse em cliques repetidos. */
export class TrackingTokenCache {
  private readonly entries = new Map<string, TrackingElement | null>();
  constructor(private readonly capacity = 4096) {}

  resolve(token: string): TrackingElement | null {
    const previous = this.entries.get(token);
    if (previous !== undefined || this.entries.has(token)) {
      this.entries.delete(token);
      this.entries.set(token, previous ?? null);
      return previous ?? null;
    }
    const decoded = decodeTrackingToken(token);
    this.entries.set(token, decoded);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
    return decoded;
  }
}

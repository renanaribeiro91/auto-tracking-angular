// Contrato puro/browser-safe. O token contém o evento inteiro; não há lookup externo.
// Runtime só descomprime: a build de inflate do pako tem metade do tamanho do
// pacote completo (o ESM do pako não permite tree-shaking da compressão).
import pakoInflate from 'pako/dist/pako_inflate.min.js';
import type { TrackingElement } from './tracking-element.js';

const { Inflate } = pakoInflate;
export const PREFIX = 'v1.';
export const MAX_TOKEN_SIZE = 12_000;
export const MAX_PAYLOAD_SIZE = 32_768;
const MAX_OUTPUTS = 64;

export type Packed = [string, string, string, string | 0,
  [string, string, string, string, string | 0, string | 0] | 0,
  [string, string, string, string, string][] | 0,
  [string, string, string, string, string][] | 0,
  string[]?];

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const safeText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2048;
const gestures = (value: unknown): value is [string, string, string, string, string][] =>
  Array.isArray(value) && value.length <= MAX_OUTPUTS && value.every((row) =>
    Array.isArray(row) && row.length === 5 && nonBlank(row[0]) && nonBlank(row[1])
      && nonBlank(row[2]) && safeText(row[3]) && nonBlank(row[4]));

export function pack(contract: TrackingElement): Packed {
  return [contract.owner, contract.funcionalidade, contract.tela, contract.screenId ?? 0,
    contract.click ? [contract.click.id, contract.click.event, contract.click.elemento,
      contract.click.rotulo, contract.click.opcaoPermitida ?? 0, contract.click.opcaoFonte ?? 0] : 0,
    contract.outputs?.map(({ id, event, selector, label, output }) => [id, event, selector, label, output]) ?? 0,
    contract.overlayOutputs?.map(({ id, event, selector, label, output }) => [id, event, selector, label, output]) ?? 0,
    // Slot opcional: tokens sem rótulos provados mantêm o formato de 7 posições.
    ...(contract.rotulos?.length ? [[...contract.rotulos]] : [])] as Packed;
}

export function unpack(value: unknown): TrackingElement | null {
  if (!Array.isArray(value) || (value.length !== 7 && value.length !== 8)) return null;
  const [owner, funcionalidade, tela, screenId, click, outputs, overlayOutputs, rotulos] = value;
  if (rotulos !== undefined && (!Array.isArray(rotulos) || rotulos.length === 0 || rotulos.length > MAX_OUTPUTS
    || !rotulos.every(nonBlank))) return null;
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
    ...(rotulos ? { rotulos: rotulos as string[] } : {}),
  };
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
  private readonly entries = new Map<string, { value: TrackingElement | null; bytes: number }>();
  private occupiedBytes = 0;
  /** Limita tokens E contratos decodificados; teto aproximado de 2 MiB em strings. */
  constructor(private readonly capacity = 1024, private readonly maxBytes = 2 * 1024 * 1024) {}

  resolve(token: string): TrackingElement | null {
    const previous = this.entries.get(token);
    if (previous) {
      this.entries.delete(token);
      this.entries.set(token, previous);
      return previous.value;
    }
    const decoded = decodeTrackingToken(token);
    const bytes = token.length * 2 + (decoded ? JSON.stringify(decoded).length * 2 : 0);
    if (bytes > this.maxBytes || this.capacity < 1) return decoded;
    this.entries.set(token, { value: decoded, bytes });
    this.occupiedBytes += bytes;
    while (this.entries.size > this.capacity || this.occupiedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      const evicted = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      this.occupiedBytes -= evicted.bytes;
    }
    return decoded;
  }
}

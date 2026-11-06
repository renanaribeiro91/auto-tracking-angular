import * as fs from 'node:fs';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';

export const XLSX_LIMITS = {
  compressedBytes: 32 * 1024 * 1024, entryBytes: 8 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024, entries: 4096,
  imageBytes: 4 * 1024 * 1024, imagePixels: 4 * 1024 * 1024,
} as const;

/** O limite vale também se o arquivo crescer entre stat e read. */
export function readBoundedFile(file: string, maximum: number): Buffer {
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximum) throw new Error('arquivo fora do limite permitido');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error('arquivo alterado durante a leitura');
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null)) throw new Error('arquivo alterado durante a leitura');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

export function validatePng(bytes: Buffer): void {
  if (bytes.length > XLSX_LIMITS.imageBytes || bytes.length < 33
    || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('imagem deve ser PNG válido dentro do limite');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > XLSX_LIMITS.imagePixels) throw new Error('dimensões da imagem fora do limite');
  // pngjs limita a expansão convencional, mas usa inflateSync sem teto em Adam7.
  // Confere esse fluxo antes de entregá-lo ao decoder, preservando PNG interlaçado legítimo.
  if (bytes[28] !== 0) {
    if (bytes[28] !== 1) throw new Error('PNG com entrelaçamento inválido');
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new Error('PNG truncado');
      const size = bytes.readUInt32BE(offset);
      if (offset + size + 12 > bytes.length) throw new Error('PNG truncado');
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
    }
    inflateSync(Buffer.concat(chunks), { maxOutputLength: Math.max(1024, width * height * 16) });
  }
}

export function readBrandingPng(file: string): Buffer {
  const bytes = readBoundedFile(file, XLSX_LIMITS.imageBytes);
  validatePng(bytes);
  return bytes;
}

async function boundedEntry(entry: JSZip.JSZipObject, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let size = 0, failed = false;
    stream.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maximum) {
        failed = true; stream.pause(); chunks.length = 0;
        reject(new Error('entrada ZIP excede limite de descompressão'));
      } else chunks.push(chunk);
    }).on('error', reject).on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); }).resume();
  });
}

/** Inspeciona metadados e relações antes de abrir XML; o provider limita também bytes reais ao inflar. */
export async function inspectXlsx(bytes: Buffer): Promise<void> {
  if (bytes.length > XLSX_LIMITS.compressedBytes) throw new Error('XLSX comprimido excede limite');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > XLSX_LIMITS.entries) throw new Error('ZIP possui entradas demais');
  let total = 0;
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original.includes('\\') || original.includes('\0') || original.startsWith('/')
      || /^[A-Za-z]:/.test(original) || original.split('/').includes('..')) throw new Error('caminho ZIP inválido');
    const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!entry.dir && (size === undefined || size < 0 || size > XLSX_LIMITS.entryBytes)) throw new Error('entrada ZIP fora do limite');
    total += size ?? 0;
    if (total > XLSX_LIMITS.expandedBytes) throw new Error('ZIP expandido excede limite');
    if (!entry.dir && entry.name.endsWith('.rels')) {
      const xml = (await boundedEntry(entry, XLSX_LIMITS.entryBytes)).toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /TargetMode\s*=\s*["']External["']/i.test(xml)) throw new Error('relação externa não permitida');
      for (const match of xml.matchAll(/\bTarget\s*=\s*["']([^"']*)["']/g)) {
        const target = match[1]!;
        const base = path.posix.dirname(path.posix.dirname(entry.name));
        const resolved = path.posix.normalize(path.posix.join(base, target));
        if (target.includes('&') || target.includes('\\') || target.startsWith('/') || /^[A-Za-z][\w+.-]*:/.test(target)
          || resolved === '..' || resolved.startsWith('../')) throw new Error('destino de relação fora do ZIP');
      }
    }
  }
}

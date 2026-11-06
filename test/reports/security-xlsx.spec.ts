import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { loadWorkbookProvider } from '../../src/adapters/reports/excel-workbook.js';
import { EvidenceWorkbookWriter } from '../../src/adapters/reports/evidence-writer.js';
import { inspectXlsx, readBoundedFile, readBrandingPng, validatePng, XLSX_LIMITS } from '../../src/adapters/reports/xlsx-safety.js';
import type { TagEntry } from '../../src/application/apply/tagger.js';

describe('segurança XLSX e fornecedor distribuído', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-xlsx-security-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('remove exceljs e as versões unzipper/bluebird atribuídas aos seis findings do lock distribuído', () => {
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string }> };
    expect(Object.keys(lock.packages).some((key) => key.endsWith('/exceljs'))).toBe(false);
    expect(Object.entries(lock.packages).filter(([key]) => key.endsWith('/unzipper')).map(([, value]) => value.version)).toEqual(['0.12.5']);
    expect(Object.entries(lock.packages).filter(([key]) => key.endsWith('/bluebird')).map(([, value]) => value.version)).toEqual(['3.7.2']);
    expect(lock.packages['node_modules/exceljs-hardened']?.version).toBe('5.1.0');
  });

  it('CVE-2026-78207: notas JSON não alteram Object.prototype', async () => {
    const { Workbook } = await loadWorkbookProvider();
    const workbook = new Workbook();
    const note = JSON.parse('{"__proto__":{"atPolluted":true},"constructor":{"prototype":{"atPolluted":true}},"texts":[{"text":"legítimo"}]}');
    workbook.addWorksheet('Seguranca').getCell('A1').note = note;
    await workbook.xlsx.writeBuffer();
    expect(Object.prototype).not.toHaveProperty('atPolluted');
    expect({}).not.toHaveProperty('atPolluted');
  });

  it('CVE-2026-78209: prefixos de fórmula permanecem texto no XLSX e são neutralizados no CSV do fornecedor', async () => {
    const values = ['=2+2', '+2+2', '-2+2', '@SUM(A1:A2)'];
    const entries: TagEntry[] = values.map((rotulo, index) => ({ id: `test-${index}`, owner: 'app', funcionalidade: 'modulo', tela: 'pagina',
      telas: ['modulo:pagina'], evento: 'click', acao: 'clique', elemento: 'botao', rotulo, origem: '(click)', arquivo: 'a.html', linha: index + 1 }));
    const file = path.join(root, 'e.xlsx');
    const writer = new EvidenceWorkbookWriter();
    const input = { owner: 'app', product: 'produto', entries, branding: {} };
    await writer.writeEvidenceWorkbook(file, input, 'sig');
    expect(await writer.matchesEvidenceWorkbook(file, input, 'sig')).toBe(true);
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    for (const entry of Object.values(zip.files).filter((item) => /^xl\/worksheets\/sheet\d+\.xml$/.test(item.name))) {
      expect(await entry.async('string')).not.toMatch(/<f(?:\s|>)/);
    }
    const { Workbook } = await loadWorkbookProvider();
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Seguranca');
    values.forEach((value) => sheet.addRow([value]));
    const csv = Buffer.from(await workbook.csv.writeBuffer()).toString('utf8');
    for (const value of values) expect(csv).toContain(`'${value}`);
  });

  it('CVE-2026-78208: recusa traversal do fornecedor e fontes não PNG ou acima do orçamento', async () => {
    const { Workbook } = await loadWorkbookProvider();
    const workbook = new Workbook();
    expect(() => workbook.addImage({ filename: '../segredo', extension: 'png' })).toThrow('traversal');
    const secret = path.join(root, 'segredo.txt');
    fs.writeFileSync(secret, 'nao incorporar');
    expect(() => readBrandingPng(secret)).toThrow('PNG');
    expect(() => readBoundedFile(secret, 2)).toThrow('limite');
    const png = Buffer.from(fs.readFileSync('test/fixtures/watermark.png'));
    png.writeUInt32BE(XLSX_LIMITS.imagePixels + 1, 16);
    expect(() => validatePng(png)).toThrow('dimensões');
  });

  it('CVE-2026-78206: limita expansão real mesmo se o tamanho declarado na central ZIP for falso', async () => {
    const zip = new JSZip();
    zip.file('xl/sharedStrings.xml', '<sst>' + 'x'.repeat(4096) + '</sst>');
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    bytes.writeUInt32LE(1, central + 24);
    const { Workbook } = await loadWorkbookProvider();
    await expect(new Workbook().xlsx.load(bytes as unknown as ArrayBuffer, {
      maxEntryUncompressedSize: 128, maxTotalUncompressedSize: 256,
    })).rejects.toThrow('actual uncompressed size');
  });

  it.each(['../fora.xml', '/fora.xml', 'C:\\fora.xml'])(
    'CVE-2026-17514: não extrai nem aceita caminho ZIP externo %s', async (filename) => {
      const zip = new JSZip();
      zip.file(filename, 'invalido');
      const file = path.join(root, 'hostil.xlsx');
      fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
      const writer = new EvidenceWorkbookWriter();
      await expect(inspectXlsx(fs.readFileSync(file))).rejects.toThrow('ZIP inválido');
      expect(await writer.readWorkbookSignature(file)).toBeNull();
      expect(fs.existsSync(path.join(root, '..', 'fora.xml'))).toBe(false);
    },
  );

  it('recusa relações externas, XML com entidade e arquivos malformados sem aprovar a assinatura', async () => {
    for (const relation of [
      '<Relationships><Relationship Target="https://example.invalid/" TargetMode="External"/></Relationships>',
      '<!DOCTYPE x [<!ENTITY entity SYSTEM "file:///segredo">]><Relationships/>',
      '<Relationships><Relationship Target="../../../segredo"/></Relationships>',
    ]) {
      const zip = new JSZip();
      zip.file('xl/_rels/workbook.xml.rels', relation);
      await expect(inspectXlsx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow();
    }
    const file = path.join(root, 'invalido.xlsx');
    fs.writeFileSync(file, 'nao e ZIP');
    const writer = new EvidenceWorkbookWriter();
    expect(await writer.readWorkbookSignature(file)).toBeNull();
    expect(await writer.matchesEvidenceWorkbook(file, { owner: 'app', product: 'p', branding: {}, entries: [] }, 'sig')).toBe(false);
  });
});

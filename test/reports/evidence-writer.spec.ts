import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { workbookSignature, writeEvidenceWorkbook } from '../../src/adapters/reports/evidence-writer.js';
import type { TagEntry } from '../../src/application/apply/tagger.js';

const entry = (over: Partial<TagEntry>): TagEntry => ({
  id: 'reembolso-tipo-avancar', owner: 'mob', evento: 'click', acao: 'clique', elemento: 'botao', funcionalidade: 'reembolso',
  tela: 'tipo', telas: ['reembolso:tipo'], rotulo: 'avancar', rotuloDinamico: false, origem: '(click)', arquivo: 'a.html', linha: 1, ...over,
});

describe('planilha de evidência', () => {
  it('usa identidade neutra ou a cor configurada e invalida a assinatura quando a cor muda', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-brand-')), 'e.xlsx');
    const report = '{"entries":[]}';
    const input = { owner: 'app', product: 'produto', entries: [entry({})], branding: { primaryColor: '#123456' } };
    expect(workbookSignature(report, input.branding)).not.toBe(workbookSignature(report, {}));
    expect(workbookSignature(report, input.branding, 'v1')).not.toBe(workbookSignature(report, input.branding, 'v2'));
    await writeEvidenceWorkbook(file, input, workbookSignature(report, input.branding));
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.getWorksheet('Resumo')?.getCell('B1').font.color?.argb).toBe('FF123456');
    expect(String(workbook.getWorksheet('Resumo')?.getCell('B5').value)).not.toMatch(/marca-especifica|cliente-real/i);
    await expect(writeEvidenceWorkbook(file, { ...input, branding: { primaryColor: 'invalida' } }, 'sig')).rejects.toThrow('#RRGGBB');
  });
  it('identifica rótulo e opção dinâmicos sem apresentar o nome do handler como texto', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-dynamic-')), 'e.xlsx');
    await writeEvidenceWorkbook(file, {
      owner: 'mob', product: 'saude', branding: {},
      entries: [entry({ rotulo: 'on-cliked', rotuloDinamico: true, opcao_selecionada_1: 'dinâmica (opção selecionada)' })],
    }, 'sig');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const strings = await zip.file('xl/sharedStrings.xml')!.async('string');
    expect(strings).toContain('Opção selecionada');
    expect(strings).toContain('dinâmica (opção selecionada)');
    expect(strings).toContain('dinâmico (atributo acessível ou texto exibido)');
    expect(strings).not.toContain('on-cliked');
  });
  it('links de módulo e de volta ao resumo são hyperlinks internos nativos (sem relacionamento externo)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-xlsx-')), 'e.xlsx');
    const watermarkPng = path.resolve('test/fixtures/watermark.png');
    await writeEvidenceWorkbook(file, {
      owner: 'mob', product: 'saude', branding: { watermarkPng },
      entries: [entry({}), entry({ id: 'app-sair', telas: ['*'] }), entry({ id: 'morto', telas: [] })],
    }, 'sig');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const resumo = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(resumo).toContain(`location="&apos;Reembolso&apos;!A1"`);
    expect(resumo).not.toMatch(/<hyperlink[^>]*r:id=/);
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')?.async('string');
    expect(rels ?? '').not.toContain('TargetMode="External"');
    // só telas e módulos: casca do app e componente sem uso não entram
    expect(Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toHaveLength(2);
    const shared = await zip.file('xl/sharedStrings.xml')!.async('string');
    expect(shared).not.toContain('app-sair');
    expect(shared).not.toContain('morto');

    const sheets = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    for (const sheet of sheets) {
      const sheetXml = await zip.file(sheet)!.async('string');
      const relationshipId = /<picture r:id="(rId\d+)"\/>/.exec(sheetXml)?.[1];
      expect(relationshipId).toBeDefined();

      const relationshipFile = sheet.replace('worksheets/', 'worksheets/_rels/') + '.rels';
      const relationships = await zip.file(relationshipFile)!.async('string');
      const target = new RegExp(`<Relationship Id="${relationshipId}"[^>]*Target="([^"]+)"`).exec(relationships)?.[1];
      expect(target).toBeDefined();
      expect(zip.file(path.posix.normalize(path.posix.join('xl/worksheets', target!)))).not.toBeNull();
    }

    // O fundo é nativo (<picture>), nunca um desenho deslocável no XLSX.
    const drawingParts = Object.keys(zip.files).filter((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
    expect(drawingParts).toHaveLength(0);
    const mediaParts = Object.keys(zip.files).filter((name) => /^xl\/media\/image\d+\.png$/.test(name));
    expect(mediaParts).toHaveLength(1);
    const { PNG } = await import('pngjs');
    const bg = PNG.sync.read(await zip.file(mediaParts[0]!)!.async('nodebuffer'));
    expect(bg.width).toBe(880);
    expect(bg.height).toBe(560);
    const marks = [0, 0, 0, 0];
    for (let y = 0; y < bg.height; y++) for (let x = 0; x < bg.width; x++) {
      const offset = (y * bg.width + x) * 4;
      if (bg.data[offset + 1]! < 245) marks[Number(x >= bg.width / 2) + 2 * Number(y >= bg.height / 2)]++;
    }
    expect(marks.every((pixels) => pixels > 100)).toBe(true);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const summary = workbook.getWorksheet('Resumo')!;
    expect(summary.getCell('B1').alignment?.horizontal).toBe('center');
    expect(summary.getColumn('A').width).toBe(summary.getColumn('E').width);
    expect(summary.pageSetup.horizontalCentered).toBe(true);
    const moduleSheet = workbook.getWorksheet('Reembolso')!;
    expect(summary.getBackgroundImageId()).toBeDefined();
    expect(moduleSheet.getBackgroundImageId()).toBeDefined();
    expect(summary.getImages()).toHaveLength(0);
    expect(moduleSheet.getImages()).toHaveLength(0);
    // Nenhuma célula extra ou desenho flutuante é criado pela marca-d'água.
    expect(summary.rowCount).toBe(8);
    expect(moduleSheet.rowCount).toBe(3);
  }, 20000);
});

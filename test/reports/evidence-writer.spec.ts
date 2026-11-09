import { loadWorkbookProvider } from '../../src/adapters/reports/excel-workbook.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { EvidenceWorkbookWriter, workbookSignature, writeEvidenceWorkbook } from '../../src/adapters/reports/evidence-writer.js';
import type { TagEntry } from '../../src/application/apply/tagger.js';

const entry = (over: Partial<TagEntry>): TagEntry => ({
  id: 'reembolso-tipo-avancar', owner: 'mob', evento: 'click', acao: 'clique', elemento: 'botao', funcionalidade: 'reembolso',
  tela: 'tipo', telas: ['reembolso:tipo'], rotulo: 'avancar', origem: '(click)', arquivo: 'a.html', linha: 1, ...over,
});

describe('planilha de evidência', () => {
  it.each(['rotulo', 'cabecalho', 'duplicacao', 'remocao', 'aba-extra'])(
    'confere a evidência e rejeita %s que preserva a assinatura', async (mutation) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-integrity-'));
    try {
      const file = path.join(root, 'e.xlsx');
      const input = { owner: 'app', product: 'produto', entries: [entry({})], branding: {} };
      const writer = new EvidenceWorkbookWriter();
      await writer.writeEvidenceWorkbook(file, input, 'sig');
      expect(await writer.matchesEvidenceWorkbook(file, input, 'sig')).toBe(true);
      const ExcelJS = await loadWorkbookProvider();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const sheet = workbook.getWorksheet('Reembolso')!;
      if (mutation === 'rotulo') sheet.getCell('I3').value = 'rótulo adulterado';
      if (mutation === 'cabecalho') sheet.getCell('A2').value = 'Outro campo';
      if (mutation === 'duplicacao') sheet.addRow(sheet.getRow(3).values);
      if (mutation === 'remocao') sheet.spliceRows(3, 1);
      if (mutation === 'aba-extra') workbook.addWorksheet('Duplicada');
      await workbook.xlsx.writeFile(file);
      expect(await writer.readWorkbookSignature(file)).toBe('sig');
      expect(await writer.matchesEvidenceWorkbook(file, input, 'sig')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('usa identidade neutra ou a cor configurada e invalida a assinatura quando a cor muda', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-brand-')), 'e.xlsx');
    const report = '{"entries":[]}';
    const input = { owner: 'app', product: 'produto', entries: [entry({})], branding: { primaryColor: '#123456' } };
    expect(workbookSignature(report, input.branding)).not.toBe(workbookSignature(report, {}));
    expect(workbookSignature(report, input.branding, 'v1')).not.toBe(workbookSignature(report, input.branding, 'v2'));
    await writeEvidenceWorkbook(file, input, workbookSignature(report, input.branding));
    const ExcelJS = await loadWorkbookProvider();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.getWorksheet('Resumo')?.getCell('B1').font.color?.argb).toBe('FF123456');
    expect(String(workbook.getWorksheet('Resumo')?.getCell('B5').value)).not.toMatch(/marca-especifica|cliente-real/i);
    await expect(writeEvidenceWorkbook(file, { ...input, branding: { primaryColor: 'invalida' } }, 'sig')).rejects.toThrow('#RRGGBB');
  });
  it('subfuncionalidade é a tela; tela igual à funcionalidade não se repete', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-sub-')), 'e.xlsx');
    await writeEvidenceWorkbook(file, { owner: 'app', product: 'saude', branding: {},
      entries: [entry({}), entry({ id: 'menu-voltar', funcionalidade: 'menu', tela: 'menu', telas: ['menu:menu'] })] }, 'sig');
    const ExcelJS = await loadWorkbookProvider();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const row = (name: string) => {
      const sheet = workbook.getWorksheet(name)!;
      const labels = sheet.getRow(2).values as (string | undefined)[];
      return Object.fromEntries(labels.flatMap((label, index) => (label ? [[label, sheet.getRow(3).getCell(index).value]] : [])));
    };
    expect(row('Reembolso')).toMatchObject({ Subfuncionalidade: 'tipo', Tela: '{ambiente}:saude:reembolso:tipo' });
    expect(row('Menu')).toMatchObject({ Subfuncionalidade: 'menu', Tela: '{ambiente}:saude:menu', Categoria: '{ambiente}:saude:menu' });
  });
  it('mostra o rótulo exatamente como enviado e identifica a opção dinâmica', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-dynamic-')), 'e.xlsx');
    await writeEvidenceWorkbook(file, {
      owner: 'mob', product: 'saude', branding: {},
      entries: [entry({ rotulo: 'avaliar', opcao_selecionada_1: '[valor-selecionado]' })],
    }, 'sig');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const strings = await zip.file('xl/sharedStrings.xml')!.async('string');
    expect(strings).toContain('Opção selecionada');
    expect(strings).toContain('[valor-selecionado]');
    expect(strings).toContain('avaliar');
    expect(strings).not.toContain('dinâmico (atributo acessível ou texto exibido)');
  });
  it('links de módulo e de volta ao resumo são hyperlinks internos nativos (sem relacionamento externo)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-xlsx-')), 'e.xlsx');
    const watermarkPng = path.resolve('test/fixtures/watermark.png');
    await writeEvidenceWorkbook(file, {
      owner: 'mob', product: 'saude', branding: { watermarkPng },
      entries: [entry({}), entry({ id: 'app-sair', telas: ['*'] }), entry({ id: 'reutilizavel', telas: ['@origin'], vinculo_tela: 'origem' })],
    }, 'sig');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const resumo = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(resumo).toContain(`location="&apos;Reembolso&apos;!A1"`);
    expect(resumo).not.toMatch(/<hyperlink[^>]*r:id=/);
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')?.async('string');
    expect(rels ?? '').not.toContain('TargetMode="External"');
    // Evidências sem tela estática seguem visíveis e identificadas, sem atribuir uma rota fictícia.
    expect(Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toHaveLength(2);
    const shared = await zip.file('xl/sharedStrings.xml')!.async('string');
    expect(shared).toContain('app-sair');
    expect(shared).toContain('reutilizavel');
    expect(shared).toContain('{ambiente}:saude:{funcionalidade-de-origem}:{tela-de-origem}');
    expect(shared).not.toContain('Tela sem vínculo');

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
      if (bg.data[offset + 1]! < 245) marks[Number(x >= bg.width / 2) + 2 * Number(y >= bg.height / 2)]! += 1;
    }
    expect(marks.every((pixels) => pixels > 100)).toBe(true);
    const ExcelJS = await loadWorkbookProvider();
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
    expect(moduleSheet.rowCount).toBe(5);
    expect([3, 4, 5].map((row) => moduleSheet.getCell(`A${row}`).value).sort()).toEqual([
      'app-sair', 'reembolso-tipo-avancar', 'reutilizavel',
    ].sort((a, b) => a.localeCompare(b)));
  }, 20000);
});

  it('recusa gerar evidência sem vínculo em vez de exportar uma linha com erro', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'at-missing-screen-'));
    try {
      const file = path.join(directory, 'e.xlsx');
      await expect(writeEvidenceWorkbook(file, { owner: 'app', product: 'produto', branding: {},
        entries: [entry({ id: 'sem-origem', telas: [] })] }, 'sig')).rejects.toThrow("interação 'sem-origem' sem vínculo de tela");
      expect(fs.existsSync(file)).toBe(false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

it('eventos iguais na mesma tela viram uma linha', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-collapse-'));
    try {
      const file = path.join(root, 'e.xlsx');
      await new EvidenceWorkbookWriter().writeEvidenceWorkbook(file, { owner: 'app', product: 'produto', branding: {}, entries: [
        entry({ id: 'a', arquivo: 'a.ts', linha: 1 }), entry({ id: 'b', arquivo: 'b.ts', linha: 2 }), entry({ id: 'c', arquivo: 'b.ts', linha: 2 }),
        entry({ id: 'd', rotulo: 'outro' }), entry({ id: 'e', telas: ['reembolso:outra'] }),
      ] }, 'sig');
      const ExcelJS = await loadWorkbookProvider();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const sheet = workbook.getWorksheet('Reembolso')!;
      expect(sheet.rowCount).toBe(5); // título, cabeçalho e 3 eventos distintos
      expect(sheet.getCell('A4').value).toBe('a');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

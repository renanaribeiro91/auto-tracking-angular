import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { loadWorkbookProvider } from '../../src/adapters/reports/excel-workbook.js';
import { EvidenceWorkbookWriter } from '../../src/adapters/reports/evidence-writer.js';
import type { TagEntry } from '../../src/application/apply/tagger.js';

const entry = (over: Partial<TagEntry>): TagEntry => ({
  id: 'reembolso-resumo-enviar', owner: 'app', evento: 'click', acao: 'clique', elemento: 'botao', funcionalidade: 'reembolso',
  tela: 'resumo', telas: ['reembolso:solicitar:resumo'], rotulo: 'enviar', origem: '(click)', arquivo: 'a.html', linha: 3, ...over,
});

/** Planilha aberta fora do Numbers/Excel (Quick Look, prévias, importadores) com o mesmo conteúdo. */
describe('planilha legível em qualquer leitor', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-readable-'));
  const file = path.join(root, 'e.xlsx');
  const input = { owner: 'app', product: 'saude', branding: {}, entries: [
    entry({}), entry({ id: 'reembolso-resumo-enviar-2', arquivo: 'b.html', linha: 9, origem: '(onEnviar) em <app-rodape>' }),
  ] };
  const writer = new EvidenceWorkbookWriter();
  beforeAll(() => writer.writeEvidenceWorkbook(file, input, 'sig'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resumo simétrico em A:E, nome do módulo na própria célula com display e fontes completas', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const summary = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(summary).toMatch(/<dimension ref="A1:E\d+"\/>/);
    expect(summary).toMatch(/<c r="B8"[^>]* t="inlineStr"><is><t xml:space="preserve">Reembolso<\/t><\/is><\/c>/);
    expect(summary).toMatch(/<hyperlink ref="B8" location="[^"]*Reembolso[^"]*" display="Reembolso"\/>/);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    for (const font of styles.match(/<font>[\s\S]*?<\/font>/g)!) expect(font).toMatch(/<sz [\s\S]*<name /);
    expect(await writer.matchesEvidenceWorkbook(file, input, 'sig')).toBe(true);
  });

  it('o mesmo evento enviado por dois pontos do código é uma linha que lista as duas origens', async () => {
    const ExcelJS = await loadWorkbookProvider();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet('Reembolso')!;
    const header = (sheet.getRow(2).values as unknown[]).map(String);
    const column = (name: string) => header.indexOf(name);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(3).getCell(column('Arquivo')).value).toBe('a.html; b.html');
    expect(String(sheet.getRow(3).getCell(column('Linha')).value)).toBe('3; 9');
    expect(sheet.getRow(3).getCell(column('Origem no código')).value).toBe('(click); (onEnviar) em <app-rodape>');
  });
});

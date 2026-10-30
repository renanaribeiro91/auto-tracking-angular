import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { writeEvidenceWorkbook } from '../../src/adapters/reports/evidence-writer.js';
import type { TagEntry } from '../../src/application/apply/tagger.js';

it('centraliza o resumo e aplica o mesmo fundo a todas as abas', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-layout-'));
  const file = path.join(directory, 'e.xlsx');
  const item = (modulo: string): TagEntry => ({
    id: `${modulo}-botao`, owner: 'app', evento: 'click', acao: 'clique', elemento: 'botao',
    funcionalidade: modulo, tela: 'inicio', telas: [`${modulo}:inicio`], rotulo: 'botao',
    origem: '(click)', arquivo: 'a.html', linha: 1,
  });
  try {
    await writeEvidenceWorkbook(file, {
      owner: 'app', product: 'produto', entries: [item('primeiro'), item('segundo')],
      branding: { watermarkPng: path.resolve('test/fixtures/watermark.png') },
    }, 'sig');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const summary = workbook.getWorksheet('Resumo')!;
    expect(summary.pageSetup.printArea).toBe('A1:E9');
    expect(summary.getColumn('A').width).toBe(summary.getColumn('E').width);
    expect(summary.getColumn('A').width).toBeCloseTo((summary.getColumn('B').width! + summary.getColumn('C').width! + summary.getColumn('D').width!) * 0.6);
    expect(workbook.worksheets).toHaveLength(3);
    const background = summary.getBackgroundImageId();
    expect(background).toBeDefined();
    for (const sheet of workbook.worksheets) expect(sheet.getBackgroundImageId()).toBe(background);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

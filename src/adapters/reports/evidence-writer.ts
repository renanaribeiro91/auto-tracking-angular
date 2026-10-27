// T26 — planilha de evidência para o negócio: resumo + uma aba por módulo (funcionalidade), com a marca do preset
import * as fs from 'fs';
import { createHash } from 'crypto';
import type { Cell as ExcelCell, Workbook, Worksheet } from 'exceljs';
import { EVIDENCE_WRITER_VERSION, WORKBOOK_COLORS } from './evidence-writer.constants.js';
import { MODULE_WORKSHEET_COLUMNS, WORKBOOK_LAYOUT } from './evidence-writer.config.js';
import type { EvidenceRow as Row, ModuleRow, WorkbookBranding, WorkbookInput } from './evidence-writer.types.js';
import { createWorksheetBackground } from './watermark-background.js';

export type { WorkbookBranding, WorkbookInput } from './evidence-writer.types.js';

/** Gera e verifica a planilha de evidência e controla sua identidade de cache. */
export class EvidenceWorkbookWriter {
  private async excel() {
    const module = await import('exceljs');
    return (module as unknown as { default?: typeof module }).default ?? module;
  }

  /** Assinatura do conteúdo da planilha: relatório, imagens de marca e versão do layout. */
  workbookSignature(report: string, branding: WorkbookBranding, implementation = ''): string {
    const hash = createHash('sha256').update(EVIDENCE_WRITER_VERSION).update(implementation).update(report);
    hash.update(branding.primaryColor ?? '');
    for (const file of [branding.logoPng, branding.watermarkPng]) {
      hash.update(file && fs.existsSync(file) ? fs.readFileSync(file) : '');
    }
    return hash.digest('hex');
  }

  /** Lê a assinatura gravada na planilha; retorna null se ela estiver ausente ou ilegível. */
  async readWorkbookSignature(file: string): Promise<string | null> {
    if (!fs.existsSync(file)) return null;
    try {
      const workbook = new (await this.excel()).Workbook();
      await workbook.xlsx.readFile(file);
      return workbook.description || null;
    } catch {
      return null;
    }
  }

  async writeEvidenceWorkbook(file: string, input: WorkbookInput, signature: string): Promise<void> {
    if (input.branding.primaryColor && !/^#[0-9a-f]{6}$/i.test(input.branding.primaryColor)) {
      throw new Error('branding.primaryColor deve usar o formato #RRGGBB');
    }
    const brandColor = input.branding.primaryColor ? `FF${input.branding.primaryColor.slice(1).toUpperCase()}` : WORKBOOK_COLORS.brand;
    const ExcelJS = await this.excel();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'auto-tracking-angular';
    workbook.description = signature;
    workbook.created = workbook.modified = new Date(0);

    const logo = this.addImage(workbook, input.branding.logoPng);
    const watermark = this.addBackground(workbook, input.branding.watermarkPng);
    const rows = this.rowsOf(input);
    const modules = [...new Set(rows.map((row) => row.modulo))].sort((a, b) => a.localeCompare(b));
    const names = this.sheetNames(modules);

    this.writeSummary(workbook, input, rows, modules, names, logo, brandColor);
    this.writeModuleSheets(workbook, input, rows, modules, names, logo, brandColor);
    this.applyWatermark(workbook, watermark);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    fs.writeFileSync(file, await this.internalLinks(buffer));
  }

  private addImage(workbook: Workbook, file: string | undefined): number | null {
    if (!file || !fs.existsSync(file)) return null;
    return workbook.addImage({ buffer: fs.readFileSync(file) as unknown as ArrayBuffer, extension: 'png' });
  }

  private addBackground(workbook: Workbook, file: string | undefined): number | null {
    if (!file || !fs.existsSync(file)) return null;
    const image = createWorksheetBackground(fs.readFileSync(file));
    return workbook.addImage({ buffer: image as unknown as ArrayBuffer, extension: 'png' });
  }

  private rowsOf(input: WorkbookInput): Row[] {
    const rows: Row[] = [];
    for (const entry of input.entries) {
      for (const screenRef of entry.telas.filter((screen) => screen !== '*')) {
        const [modulo, screenName] = screenRef.split(':') as [string, string];
        const screen = `{ambiente}:${input.product}:${screenName}`;
        rows.push({
          modulo,
          id: entry.id,
          evento: entry.evento,
          acao: entry.acao,
          elemento: entry.elemento,
          tela: screen,
          categoria: entry.evento === 'click' ? screen : '',
          rotulo: entry.rotuloDinamico ? 'dinâmico (atributo acessível ou texto exibido)' : entry.rotulo,
          opcaoSelecionada: entry.opcao_selecionada_1 ?? '',
          origem: entry.origem,
          arquivo: entry.arquivo,
          linha: entry.linha,
        });
      }
    }
    return rows.sort(
      (a, b) => a.modulo.localeCompare(b.modulo) || a.tela.localeCompare(b.tela) || b.evento.localeCompare(a.evento) || a.id.localeCompare(b.id),
    );
  }

  private titleCase(value: string): string {
    return value.replace(/-/g, ' ').replace(/^./, (character) => character.toUpperCase());
  }

  private sheetNames(modules: readonly string[]): Map<string, string> {
    const used = new Set<string>([WORKBOOK_LAYOUT.summaryName.toLowerCase()]);
    return new Map(modules.map((module) => [module, this.sheetName(module, used)]));
  }

  /** Nome de aba válido no Excel (≤ 31 caracteres, sem []:*?/\) e único. */
  private sheetName(module: string, used: Set<string>): string {
    const base = this.titleCase(module).replace(/[[\]:*?/\\]/g, ' ').slice(0, WORKBOOK_LAYOUT.sheetNameBaseLength).trim() || WORKBOOK_LAYOUT.sheetNameFallback;
    let name = base;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base.slice(0, WORKBOOK_LAYOUT.sheetNameCollisionBaseLength)} ${suffix}`;
    used.add(name.toLowerCase());
    return name;
  }

  private writeSummary(
    workbook: Workbook,
    input: WorkbookInput,
    rows: readonly Row[],
    modules: readonly string[],
    names: ReadonlyMap<string, string>,
    logo: number | null,
    brandColor: string,
  ): void {
    const summary = workbook.addWorksheet(WORKBOOK_LAYOUT.summaryName, {
      properties: { tabColor: { argb: brandColor } },
      views: [{ state: 'frozen', ySplit: WORKBOOK_LAYOUT.summaryFrozenRows, showGridLines: false, zoomScale: 85, zoomScaleNormal: 85 }],
      pageSetup: { horizontalCentered: true, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const moduleWidth = this.fit(
      [...modules.map((module) => this.titleCase(module)), WORKBOOK_LAYOUT.moduleIndexHeaders[0]],
      WORKBOOK_LAYOUT.moduleTitleWidth.minimum,
      WORKBOOK_LAYOUT.moduleTitleWidth.maximum,
    );
    const marginWidth = (moduleWidth + WORKBOOK_LAYOUT.summaryColumnWidths[2] + WORKBOOK_LAYOUT.summaryColumnWidths[3]) * 0.6;
    summary.columns = WORKBOOK_LAYOUT.summaryColumnWidths.map((width, index) => ({
      width: index === 1 ? moduleWidth : index === 0 || index === 4 ? marginWidth : width,
    }));
    summary.pageSetup.printArea = `A1:E${Math.max(WORKBOOK_LAYOUT.summaryFrozenRows, WORKBOOK_LAYOUT.firstIndexRow + modules.length - 1)}`;

    summary.getRow(1).height = WORKBOOK_LAYOUT.rowHeights.summaryTitle;
    summary.mergeCells(WORKBOOK_LAYOUT.summaryHeaderRange);
    summary.getCell('B1').value = WORKBOOK_LAYOUT.summaryTitle;
    summary.getCell('B1').font = { bold: true, size: WORKBOOK_LAYOUT.fontSizes.summaryTitle, color: { argb: brandColor } };
    this.center(summary.getCell('B1'));
    if (logo !== null) summary.addImage(logo, { tl: { col: WORKBOOK_LAYOUT.logo.summaryLeft, row: WORKBOOK_LAYOUT.logo.top }, ext: { width: WORKBOOK_LAYOUT.logo.summaryWidth, height: WORKBOOK_LAYOUT.logo.summaryHeight } });

    summary.mergeCells(WORKBOOK_LAYOUT.summarySubtitleRange);
    summary.getCell('B2').value = WORKBOOK_LAYOUT.summarySubtitle.replace('{owner}', input.owner).replace('{product}', input.product);
    summary.getCell('B2').font = { size: WORKBOOK_LAYOUT.fontSizes.subtitle, color: { argb: WORKBOOK_COLORS.gray } };
    this.center(summary.getCell('B2'));
    summary.getRow(2).height = WORKBOOK_LAYOUT.rowHeights.summarySubtitle;

    this.writeIndicators(summary, rows, modules, brandColor);
    summary.mergeCells(WORKBOOK_LAYOUT.summaryDetailsRange);
    summary.getCell('B5').value = WORKBOOK_LAYOUT.screenNote.replace('{product}', input.product);
    summary.getCell('B5').font = { italic: true, size: WORKBOOK_LAYOUT.fontSizes.note, color: { argb: WORKBOOK_COLORS.gray } };
    this.center(summary.getCell('B5'));
    summary.getRow(5).height = WORKBOOK_LAYOUT.rowHeights.summaryDetails;

    summary.mergeCells(WORKBOOK_LAYOUT.summaryNavigationRange);
    summary.getCell('B6').value = WORKBOOK_LAYOUT.moduleNavigation;
    summary.getCell('B6').font = { bold: true, color: { argb: WORKBOOK_COLORS.gray } };
    this.center(summary.getCell('B6'));
    this.header(summary, WORKBOOK_LAYOUT.summaryFrozenRows, WORKBOOK_LAYOUT.moduleIndexHeaders, WORKBOOK_LAYOUT.moduleIndexColumn, brandColor);
    this.writeModuleIndex(summary, rows, modules, names, brandColor);
  }

  private writeIndicators(summary: Worksheet, rows: readonly Row[], modules: readonly string[], brandColor: string): void {
    const indicators: readonly number[] = [
      modules.length,
      new Set(rows.filter((row) => row.evento === 'screen_view').map((row) => `${row.modulo}|${row.tela}`)).size,
      new Set(rows.filter((row) => row.evento === 'click').map((row) => row.id)).size,
    ];
    indicators.forEach((value, index) => {
      const labelCell = summary.getRow(WORKBOOK_LAYOUT.summaryRows.indicatorLabels).getCell(WORKBOOK_LAYOUT.moduleIndexColumn + index);
      const valueCell = summary.getRow(WORKBOOK_LAYOUT.summaryRows.indicatorValues).getCell(WORKBOOK_LAYOUT.moduleIndexColumn + index);
      labelCell.value = WORKBOOK_LAYOUT.indicatorLabels[index];
      labelCell.font = { bold: true, color: { argb: WORKBOOK_COLORS.gray } };
      valueCell.value = value;
      valueCell.font = { bold: true, size: WORKBOOK_LAYOUT.fontSizes.indicatorValue, color: { argb: brandColor } };
      for (const cell of [labelCell, valueCell]) {
        this.center(cell);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_COLORS.zebra } };
        cell.border = { left: { style: 'thin', color: { argb: WORKBOOK_COLORS.line } }, right: { style: 'thin', color: { argb: WORKBOOK_COLORS.line } } };
      }
    });
    summary.getRow(WORKBOOK_LAYOUT.summaryRows.indicatorLabels).height = WORKBOOK_LAYOUT.rowHeights.indicatorLabel;
    summary.getRow(WORKBOOK_LAYOUT.summaryRows.indicatorValues).height = WORKBOOK_LAYOUT.rowHeights.indicatorValue;
  }

  private writeModuleIndex(summary: Worksheet, rows: readonly Row[], modules: readonly string[], names: ReadonlyMap<string, string>, brandColor: string): void {
    modules.forEach((module, index) => {
      const rowNumber = WORKBOOK_LAYOUT.firstIndexRow + index;
      const row = summary.getRow(rowNumber);
      const moduleRows = rows.filter((item) => item.modulo === module);
      this.link(row.getCell(WORKBOOK_LAYOUT.moduleIndexColumns.module), names.get(module)!, this.titleCase(module), brandColor);
      row.getCell(WORKBOOK_LAYOUT.moduleIndexColumns.screens).value = new Set(moduleRows.filter((item) => item.evento === 'screen_view').map((item) => item.tela)).size;
      row.getCell(WORKBOOK_LAYOUT.moduleIndexColumns.interactions).value = moduleRows.filter((item) => item.evento === 'click').length;
      for (let column = WORKBOOK_LAYOUT.moduleIndexColumns.module; column <= WORKBOOK_LAYOUT.moduleIndexColumns.last; column++) {
        row.getCell(column).border = { bottom: { style: 'thin', color: { argb: WORKBOOK_COLORS.line } } };
        if (column > 2) this.center(row.getCell(column));
      }
      if (index % 2 === 1) this.zebra(summary, rowNumber, 2, 4);
    });
  }

  private writeModuleSheets(
    workbook: Workbook,
    input: WorkbookInput,
    rows: readonly Row[],
    modules: readonly string[],
    names: ReadonlyMap<string, string>,
    logo: number | null,
    brandColor: string,
  ): void {
    for (const module of modules) {
      const moduleRows: ModuleRow[] = rows.filter((row) => row.modulo === module).map((row) => ({ ...row, produto: input.product }));
      const sheet = workbook.addWorksheet(names.get(module)!, { views: [{ state: 'frozen', ySplit: WORKBOOK_LAYOUT.moduleFrozenRows, showGridLines: false }] });
      sheet.columns = MODULE_WORKSHEET_COLUMNS.map((column) => ({
        key: column.key,
        width: this.fit([column.label, ...moduleRows.map((row) => row[column.key])], column.minimumWidth, column.maximumWidth),
      }));

      this.writeModuleHeading(sheet, module, logo, brandColor);
      this.header(sheet, WORKBOOK_LAYOUT.moduleRows.header, MODULE_WORKSHEET_COLUMNS.map((column) => column.label), 1, brandColor);
      this.writeModuleRows(sheet, moduleRows);
      sheet.autoFilter = { from: { row: WORKBOOK_LAYOUT.moduleRows.header, column: 1 }, to: { row: WORKBOOK_LAYOUT.moduleRows.header, column: MODULE_WORKSHEET_COLUMNS.length } };
    }
  }

  private writeModuleHeading(sheet: Worksheet, module: string, logo: number | null, brandColor: string): void {
    const lastColumn = MODULE_WORKSHEET_COLUMNS.length;
    sheet.mergeCells(WORKBOOK_LAYOUT.moduleRows.title, 1, WORKBOOK_LAYOUT.moduleRows.title, lastColumn - 2);
    sheet.getCell(WORKBOOK_LAYOUT.moduleRows.title, 1).value = `Módulo: ${this.titleCase(module)}`;
    sheet.getCell(WORKBOOK_LAYOUT.moduleRows.title, 1).font = { bold: true, size: WORKBOOK_LAYOUT.fontSizes.moduleTitle, color: { argb: brandColor } };
    sheet.getCell(WORKBOOK_LAYOUT.moduleRows.title, 1).alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(WORKBOOK_LAYOUT.moduleRows.title).height = WORKBOOK_LAYOUT.rowHeights.moduleTitle;
    if (logo !== null) sheet.addImage(logo, { tl: { col: lastColumn - 2.4, row: WORKBOOK_LAYOUT.logo.top }, ext: { width: WORKBOOK_LAYOUT.logo.moduleWidth, height: WORKBOOK_LAYOUT.logo.moduleHeight } });
    sheet.mergeCells(WORKBOOK_LAYOUT.moduleRows.title, lastColumn - 1, WORKBOOK_LAYOUT.moduleRows.title, lastColumn);
    this.link(sheet.getCell(WORKBOOK_LAYOUT.moduleRows.title, lastColumn - 1), WORKBOOK_LAYOUT.summaryName, WORKBOOK_LAYOUT.backToSummary, brandColor);
    sheet.getCell(WORKBOOK_LAYOUT.moduleRows.title, lastColumn - 1).alignment = { horizontal: 'right', vertical: 'middle' };
  }

  private writeModuleRows(sheet: Worksheet, rows: readonly ModuleRow[]): void {
    rows.forEach((rowData, index) => {
      const rowNumber = WORKBOOK_LAYOUT.firstModuleRow + index;
      const row = sheet.getRow(rowNumber);
      MODULE_WORKSHEET_COLUMNS.forEach((column, columnIndex) => {
        const cell = row.getCell(columnIndex + 1);
        cell.value = rowData[column.key];
        cell.alignment = { vertical: 'middle', horizontal: (WORKBOOK_LAYOUT.centeredModuleColumns as readonly string[]).includes(column.key) ? 'center' : 'left' };
      });
      if (index % 2 === 1) this.zebra(sheet, rowNumber, 1, MODULE_WORKSHEET_COLUMNS.length);
    });
  }

  /** Fundo nativo de planilha: não é um objeto DrawingML, portanto não pode
   * ser selecionado ou movido e não cobre a tinta do texto das células. */
  private applyWatermark(workbook: Workbook, watermark: number | null): void {
    if (watermark === null) return;
    for (const sheet of workbook.worksheets) sheet.addBackgroundImage(watermark);
  }

  private header(sheet: Worksheet, rowNumber: number, labels: readonly string[], firstColumn: number, brandColor: string): void {
    const row = sheet.getRow(rowNumber);
    labels.forEach((label, index) => {
      const cell = row.getCell(firstColumn + index);
      cell.value = label;
      cell.font = { bold: true, color: { argb: WORKBOOK_COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
      cell.alignment = { vertical: 'middle', horizontal: index === 0 ? 'left' : 'center' };
    });
    row.height = WORKBOOK_LAYOUT.rowHeights.header;
  }

  private zebra(sheet: Worksheet, rowNumber: number, firstColumn: number, lastColumn: number): void {
    for (let column = firstColumn; column <= lastColumn; column++) {
      sheet.getRow(rowNumber).getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_COLORS.zebra } };
    }
  }

  private fit(
    values: readonly unknown[],
    min: number = WORKBOOK_LAYOUT.columnWidth.minimum,
    max: number = WORKBOOK_LAYOUT.columnWidth.maximum,
  ): number {
    return Math.min(max, Math.max(min, ...values.map((value) => String(value ?? '').length + WORKBOOK_LAYOUT.columnWidth.padding)));
  }

  private center(cell: ExcelCell): void {
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  private link(cell: ExcelCell, sheet: string, text: string, brandColor: string): void {
    cell.value = { text, hyperlink: `#'${sheet}'!A1` };
    cell.font = { color: { argb: brandColor }, underline: true };
  }

  /** Reescreve hyperlinks como referências internas válidas para Excel e Numbers. */
  private async internalLinks(xlsx: Buffer): Promise<Buffer> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(xlsx);
    const worksheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));

    for (const name of worksheetFiles) {
      const ids: string[] = [];
      const xml = (await zip.file(name)!.async('string')).replace(
        /<hyperlink ref="([A-Z]+\d+)" r:id="(rId\d+)" location="#([^"]*)"\s*\/>/g,
        (_match, ref: string, id: string, location: string) => {
          ids.push(id);
          return `<hyperlink ref="${ref}" location="${location}"/>`;
        },
      );
      zip.file(name, xml);
      await this.removeExternalHyperlinkRelations(zip, name, ids);
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private async removeExternalHyperlinkRelations(zip: import('jszip'), worksheet: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const relationsName = worksheet.replace('worksheets/', 'worksheets/_rels/') + '.rels';
    const relations = zip.file(relationsName);
    if (!relations) return;
    let content = await relations.async('string');
    for (const id of ids) content = content.replace(new RegExp(`<Relationship Id="${id}"[^>]*/>`), '');
    zip.file(relationsName, content);
  }
}

const evidenceWorkbookWriter = new EvidenceWorkbookWriter();
export const workbookSignature = (report: string, branding: WorkbookBranding, implementation = ''): string => evidenceWorkbookWriter.workbookSignature(report, branding, implementation);
export const readWorkbookSignature = (file: string): Promise<string | null> => evidenceWorkbookWriter.readWorkbookSignature(file);
export const writeEvidenceWorkbook = (file: string, input: WorkbookInput, signature: string): Promise<void> =>
  evidenceWorkbookWriter.writeEvidenceWorkbook(file, input, signature);

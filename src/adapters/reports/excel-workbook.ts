import type { Workbook } from 'exceljs-hardened';

/** Usa a API de documento corrigida; a entrada principal carrega o writer streaming
 * CommonJS incompatível com archiver ESM no Node 18, API que este adapter não usa. */
export async function loadWorkbookProvider(): Promise<{ Workbook: typeof Workbook }> {
  const documentEntry = 'exceljs-hardened/lib/doc/workbook.js';
  const provider = await import(documentEntry) as { default: typeof Workbook };
  return { Workbook: provider.default };
}

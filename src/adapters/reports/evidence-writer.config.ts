import type { ModuleRow } from './evidence-writer.types.js';

/** Colunas exportadas em cada aba de módulo, na ordem contratual da planilha. */
export const MODULE_WORKSHEET_COLUMNS: readonly {
  readonly label: string;
  readonly key: keyof ModuleRow;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
}[] = [
  { label: 'ID', key: 'id', minimumWidth: 30, maximumWidth: 200 },
  { label: 'Evento', key: 'evento', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Ação', key: 'acao', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Elemento', key: 'elemento', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Produto', key: 'produto', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Tela', key: 'tela', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Categoria', key: 'categoria', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Rótulo', key: 'rotulo', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Opção selecionada', key: 'opcaoSelecionada', minimumWidth: 18, maximumWidth: 90 },
  { label: 'Origem no código', key: 'origem', minimumWidth: 9, maximumWidth: 90 },
  { label: 'Arquivo', key: 'arquivo', minimumWidth: 9, maximumWidth: 200 },
  { label: 'Linha', key: 'linha', minimumWidth: 9, maximumWidth: 90 },
];

/** Contrato visual, dimensões e rótulos da pasta de evidências. */
export const WORKBOOK_LAYOUT = {
  summaryName: 'Resumo',
  summaryHeaderRange: 'B1:D1',
  summarySubtitleRange: 'B2:D2',
  summaryDetailsRange: 'B5:D5',
  summaryNavigationRange: 'B6:D6',
  summaryColumnWidths: [51, 16, 16, 16, 51] as const,
  moduleIndexColumn: 2,
  moduleIndexHeaders: ['Módulo', 'Telas', 'Interações'] as const,
  moduleTitleWidth: { minimum: 30, maximum: 60 },
  columnWidth: { minimum: 8, maximum: 90, padding: 3 },
  summaryFrozenRows: 7,
  moduleFrozenRows: 2,
  firstModuleRow: 3,
  firstIndexRow: 8,
  summaryRows: { title: 1, subtitle: 2, indicatorLabels: 3, indicatorValues: 4, details: 5, navigation: 6, indexHeader: 7 },
  moduleRows: { title: 1, header: 2 },
  moduleIndexColumns: { module: 2, screens: 3, interactions: 4, last: 4 },
  maximumSheetNameLength: 31,
  sheetNameBaseLength: 28,
  sheetNameCollisionBaseLength: 26,
  sheetNameFallback: 'Módulo',
  rowHeights: { summaryTitle: 60, summarySubtitle: 22, summaryDetails: 30, indicatorLabel: 22, indicatorValue: 48, moduleTitle: 52, header: 24 },
  fontSizes: { summaryTitle: 20, subtitle: 12, note: 9, indicatorValue: 28, moduleTitle: 16 },
  logo: { summaryWidth: 120, summaryHeight: 42, moduleWidth: 110, moduleHeight: 46, top: 0.12, summaryLeft: 0.08 },
  indicatorLabels: ['Módulos', 'Telas', 'Interações'] as const,
  summaryTitle: 'Evidência de tagueamento',
  summarySubtitle: 'Aplicação {owner}  ·  Produto {product}',
  screenNote: 'Tela = {ambiente}:{product}:<tela>  ·  ambiente definido pela configuração do aplicativo',
  moduleNavigation: 'Clique no módulo para abrir a aba',
  backToSummary: '← Resumo',
  centeredModuleColumns: ['evento', 'acao', 'elemento', 'produto', 'linha'] as const,
} as const;

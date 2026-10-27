import type { TagEntry } from '../../application/apply/tagger.js';

export interface WorkbookBranding {
  readonly logoPng?: string | undefined;
  readonly watermarkPng?: string | undefined;
  readonly primaryColor?: string | undefined;
}

export interface WorkbookInput {
  readonly owner: string;
  readonly product: string;
  readonly entries: readonly TagEntry[];
  readonly branding: WorkbookBranding;
}

export interface EvidenceRow {
  readonly modulo: string;
  readonly id: string;
  readonly evento: string;
  readonly acao: string;
  readonly elemento: string;
  readonly tela: string;
  readonly categoria: string;
  readonly rotulo: string;
  readonly opcaoSelecionada: string;
  readonly origem: string;
  readonly arquivo: string;
  readonly linha: number;
}

export type ModuleRow = EvidenceRow & { readonly produto: string };

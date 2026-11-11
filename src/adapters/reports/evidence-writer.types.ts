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
  readonly funcionalidade: string;
  readonly subfuncionalidade: string;
  readonly tela: string;
  readonly categoria: string;
  readonly rotulo: string;
  readonly opcaoSelecionada: string;
  readonly origem: string;
  readonly arquivo: string;
  /** Uma ou mais linhas (`12; 30`) quando o mesmo evento sai de vários pontos do código. */
  readonly linha: number | string;
}

export type ModuleRow = EvidenceRow & { readonly ambiente: string; readonly produto: string };

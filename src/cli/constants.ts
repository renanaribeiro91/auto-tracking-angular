/** Somente falhas estruturais/operacionais comprovadas bloqueiam o gate.
 *  Bindings de outputs fora do suporte comprovado não são pendências de analytics.
 *  VISIBLE_LABEL_BEHAVIOR_CONFLICT é aviso sobre um gesto já rastreado. */
export const BLOCKING_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'SCREEN_MARKER_NOT_PLACEABLE',
  'INLINE_TEMPLATE_INTERPOLATED',
  'ROUTED_COMPONENT_AMBIGUOUS',
  'BOOTSTRAP_PROVIDER_MISSING', 'TRACKING_REFERENCE_UNKNOWN', 'OPTION_ACCESSIBLE_SOURCE_MISSING',
]);

/** Códigos de saída que o CLI mantém estáveis para scripts e pipelines. */
export const CLI_EXIT_CODES = {
  valid: 0,
  incomplete: 1,
  error: 2,
} as const;

/** Ajuda pública do comando auto-tracking. */
export const CLI_HELP_TEXT = `auto-tracking [comando] [opções]

  (sem comando)   garante o tagueamento: marca o que falta (telas, botões, componentes),
                  atualiza relatorio.json e evidencia-tagueamento.xlsx e valida — use na esteira ou no pre-commit
  verify          só confere, sem escrever; exit 1 se faltar marcação

Opções
  --root <dir>        raiz do projeto (padrão: diretório atual)
  --config <arquivo>  config relativa à raiz (padrão: auto-tracking.config.ts)
  --dry-run           mostra o que faria, sem escrever
  --json              uma linha JSON (padrão fora de terminal)
  --pretty            relatório legível também fora de terminal
  --help, --version

Exit: 0 tudo tagueado · 1 pendência · 2 erro`;

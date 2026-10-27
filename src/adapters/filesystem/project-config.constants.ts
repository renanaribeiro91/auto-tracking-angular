/** Diretórios do consumidor que o CLI não pode usar como destino de escrita. */
export const FORBIDDEN_OUTPUT_DIRECTORIES: ReadonlySet<string> = new Set(['src', 'node_modules', 'dist']);

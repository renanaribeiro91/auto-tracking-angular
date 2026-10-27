/** Pastas geradas, externas ou de teste que não pertencem ao índice de produção. */
export const PROJECT_INDEX_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules', 'dist', 'www', '.git', '.angular', 'coverage', '.auto-tracking', '__mocks__', 'testing',
]);

/** Dublês de teste não entram no catálogo de componentes da aplicação. */
export const TEST_DOUBLE_FILE_PATTERN = /\.(mock|mocks|stub|fake)\.ts$/;
export const TEST_DOUBLE_CLASS_PATTERN = /(Mock|Stub|Fake)(Component|Page)?$/;

/** Arquivos que inicializam ou exercitam testes não representam componentes de produção. */
export const TEST_INFRASTRUCTURE_FILE_PATTERN = /(?:\.spec|\.test|\.e2e|\.cy|setup-(?:jest|tests?)|test-setup)\.ts$/;

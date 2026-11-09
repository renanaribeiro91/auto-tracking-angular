/** Pastas geradas, externas ou de teste que não pertencem ao índice de produção. */
export const PROJECT_INDEX_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules', 'dist', 'www', '.git', '.angular', 'coverage', '.auto-tracking', '__mocks__', 'testing',
]);

/** Dublês de teste não entram no catálogo de componentes da aplicação. */
export const TEST_DOUBLE_FILE_PATTERN = /\.(mock|mocks|stub|fake)\.ts$/;
export const TEST_DOUBLE_CLASS_PATTERN = /(Mock|Stub|Fake)(Component|Page)?$/;

/** Arquivos que inicializam ou exercitam testes não representam componentes de produção. */
export const TEST_INFRASTRUCTURE_FILE_PATTERN = /(?:\.spec|\.test|\.e2e|\.cy|setup-(?:jest|tests?)|test-setup)\.ts$/;

/** Receptor de API que apresenta um componente como overlay (Ionic, Angular Material/CDK ou service do projeto). */
export const OVERLAY_API = /(modal|dialog|popover|sheet)/i;

/** Controller que apresenta overlay cujo conteúdo não é componente do projeto (design system, alerta, menu). */
export const OVERLAY_CONTROLLER = /(alert|action.?sheet|modal|popover|dialog|sheet)/i;
/** Onde a API de overlay recebe o título: raiz da chamada, `componentProps` (Ionic) ou `data` (Material). */
export const OVERLAY_TITLE_PROPERTIES: ReadonlySet<string> = new Set(['header', 'title', 'titulo']);
/** Opção que lista os gestos do overlay (`buttons`, `botoes`, `actions`, com ou sem prefixo). */
export const OVERLAY_BUTTON_LIST = /(?:buttons?|botoes|botões|actions?|acoes|ações)$/i;
/** Onde cada item da lista guarda o texto exibido. */
export const OVERLAY_BUTTON_TEXT = ['text', 'title', 'titulo', 'label', 'texto', 'rotulo'] as const;

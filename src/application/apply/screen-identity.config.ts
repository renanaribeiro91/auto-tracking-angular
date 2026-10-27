/** Marcadores de fronteira usados para derivar funcionalidade e tela dos caminhos. */
export const SCREEN_CONTAINERS: ReadonlySet<string> = new Set(['pages', 'components', 'modules', 'features', 'services']);

/** Pastas estruturais que não podem virar nomes de negócio. */
export const GENERIC_SCREEN_DIRECTORIES: ReadonlySet<string> = new Set([
  'src', 'app', 'core', 'shared', 'common', 'lib', 'mfe', 'projects', 'containers', 'container', 'pages', 'page',
  'components', 'component', 'modules', 'features', 'feature', 'services', 'modals', 'modal', 'dialogs', 'popovers',
  'widgets', 'ui', 'views', 'templates', 'layout', 'layouts',
]);

/** Níveis progressivos usados para eliminar colisões entre telas roteadas. */
export const SCREEN_IDENTITY_REFINEMENT_LEVELS = [1, 2, 3] as const;

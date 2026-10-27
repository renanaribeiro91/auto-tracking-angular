import type { TrackingSchema } from '../../../src/domain/contract/schema.js';

/** Versão do contrato de identidade deste preset; independente da versão do pacote npm. */
export const EXAMPLE_PRESET_VERSION = '0.1.0';

/** Contrato do consumidor de exemplo. */
export const EXAMPLE_TRACKING_SCHEMA: TrackingSchema = {
  click: {
    requiredParams: ['ambiente', 'produto', 'funcionalidade', 'tela', 'categoria', 'elemento', 'rotulo', 'acao'],
    allowedParams: ['ambiente', 'produto', 'funcionalidade', 'subfuncionalidade', 'tela', 'categoria', 'elemento', 'rotulo', 'acao', 'opcao_selecionada_1'],
  },
  screen_view: {
    requiredParams: ['ambiente', 'produto', 'funcionalidade', 'tela'],
    allowedParams: ['ambiente', 'produto', 'funcionalidade', 'subfuncionalidade', 'tela'],
  },
};

/** IDs de bundle (busca exata) → ambiente, do consumidor de exemplo. */
export const NATIVE_APP_ID_TO_ENVIRONMENT: Readonly<Record<string, string>> = {
  'com.exemplo.saude.mobile': 'app-x',
  'com.exemplo.saude.portal': 'app-x',
  'com.exemplo.servicos.mobile': 'app-y',
  'com.exemplo.servicos.portal': 'app-y',
  'com.exemplo.geral.app': 'app-z',
  'com.exemplo.geral.dev': 'app-z',
  'com.exemplo.geral.store': 'app-z',
};

/** Tema Web → ambiente, no tema Web do consumidor. */
export const WEB_THEME_TO_ENVIRONMENT: Readonly<Record<string, string>> = {
  saude: 'app-x',
  'servicos': 'app-y',
  '': 'app-z',
};

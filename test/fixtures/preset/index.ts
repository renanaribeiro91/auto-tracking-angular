import type { TrackingPreset } from '../../../src/config.js';
import {
  EXAMPLE_PRESET_VERSION,
  EXAMPLE_TRACKING_SCHEMA,
  NATIVE_APP_ID_TO_ENVIRONMENT,
  WEB_THEME_TO_ENVIRONMENT,
} from './config.js';

/** Preset público Exemplo Saúde para resolver ambiente e validar eventos. */
export const examplePreset: TrackingPreset = {
  id: 'example',
  version: EXAMPLE_PRESET_VERSION,
  schema: EXAMPLE_TRACKING_SCHEMA,
  nativeAppIdToEnvironment: NATIVE_APP_ID_TO_ENVIRONMENT,
  webThemeToEnvironment: WEB_THEME_TO_ENVIRONMENT,
};

/** Chave global compartilhada por bundles Host/MFE para impedir listeners duplicados. */
export const OWNER_REGISTRY_SYMBOL = Symbol.for('auto-tracking/owners');
export const TRACKING_OPTIONS_TOKEN_NAME = 'TRACKING_OPTIONS';
export const TRACKING_DISPATCHER_TOKEN_NAME = 'TRACKING_DISPATCHER';

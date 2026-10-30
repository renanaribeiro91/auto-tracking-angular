// Contratos de domínio — sem imports de frameworks externos

export type EventName = 'click' | 'screen_view' | 'visualizacao' | (string & {});

export interface TrackingEvent {
  readonly name: EventName;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

/** Regra de propriedades obrigatórias e permitidas para um tipo de evento */
export interface TrackingEventRule {
  readonly requiredParams: readonly string[];
  readonly allowedParams: readonly string[];
}

/** Mapa de regras por nome de evento */
export type TrackingSchema = Readonly<Record<string, TrackingEventRule>>;

/** Resultado de validação de um evento contra o schema */
export type ValidationResult =
  | { readonly kind: 'valid' }
  | { readonly kind: 'missing-params'; readonly params: readonly string[] }
  | { readonly kind: 'extra-params'; readonly params: readonly string[] };

export function validateEvent(event: TrackingEvent, schema: TrackingSchema): ValidationResult {
  const rule = schema[event.name];
  if (!rule) return { kind: 'valid' }; // evento não coberto pelo schema = permitido
  const keys = Object.keys(event.params);
  // Valor vazio chega ao analytics como "(not set)": equivale a parâmetro ausente.
  const missing = rule.requiredParams.filter((p) => {
    const value = event.params[p];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
  if (missing.length > 0) return { kind: 'missing-params', params: missing };
  const extra = keys.filter((k) => !rule.allowedParams.includes(k));
  if (extra.length > 0) return { kind: 'extra-params', params: extra };
  return { kind: 'valid' };
}

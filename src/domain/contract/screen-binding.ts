/** Referência à tela capturada no gesto/abertura, nunca o nome de uma rota inventada. */
export const ORIGIN_SCREEN = '@origin';

export function isStaticScreenReference(value: string): boolean {
  return value !== ORIGIN_SCREEN && value !== '*' && /^[^:]+:[^:]+$/.test(value);
}

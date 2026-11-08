/** Referência à tela capturada no gesto/abertura, nunca o nome de uma rota inventada. */
export const ORIGIN_SCREEN = '@origin';

export function isStaticScreenReference(value: string): boolean {
  return value !== ORIGIN_SCREEN && value !== '*' && /^[^:]+:[^:]+$/.test(value);
}

/** `funcionalidade:tela` sem repetir o nome quando a tela é a própria funcionalidade (`menu:menu` → `menu`). */
export function screenPath(funcionalidade: string, tela: string): string {
  return funcionalidade === tela ? tela : `${funcionalidade}:${tela}`;
}

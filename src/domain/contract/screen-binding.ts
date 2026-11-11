/** Referência à tela capturada no gesto/abertura, nunca o nome de uma rota inventada. */
export const ORIGIN_SCREEN = '@origin';

/** `funcionalidade:tela`, em que a tela pode descer a escadinha da rota (`reembolso:calcular-reembolso:dados`). */
export function isStaticScreenReference(value: string): boolean {
  return value !== ORIGIN_SCREEN && value !== '*' && /^[^:]+(?::[^:]+)+$/.test(value);
}

/** Separa a referência no primeiro nível: funcionalidade e o restante do caminho da tela. */
export function splitScreenReference(value: string): { funcionalidade: string; tela: string } {
  const separator = value.indexOf(':');
  return { funcionalidade: value.slice(0, separator), tela: value.slice(separator + 1) };
}

/** Submódulo: o nível logo abaixo da funcionalidade; na tela raiz do módulo não há subfuncionalidade. */
export function subfuncionalidadeOf(funcionalidade: string, tela: string): string | undefined {
  return tela === funcionalidade ? undefined : tela.split(':')[0];
}

/** `funcionalidade:tela` sem repetir o nome quando a tela é a própria funcionalidade (`menu:menu` → `menu`). */
export function screenPath(funcionalidade: string, tela: string): string {
  return funcionalidade === tela ? tela : `${funcionalidade}:${tela}`;
}

/** Tela de uma página roteada em mais de um caminho: padrão da rota no código e a identidade dele. */
export interface ScreenRoute {
  readonly pattern: string;
  readonly funcionalidade: string;
  readonly tela: string;
}

/**
 * Tela da rota ativa: o padrão do código casa com o fim do caminho ativo (`reembolso/opcao` em `saude/reembolso/opcao`),
 * o que vale também em microfrontend montado sob prefixo do host. O padrão mais longo vence; sem casamento, não há tela.
 */
export function screenForRoute(routes: readonly ScreenRoute[], activePattern: string | null | undefined): ScreenRoute | null {
  if (!activePattern) return null;
  const active = `/${activePattern.split('/').filter(Boolean).join('/')}`;
  const matches = routes.filter((route) => active.endsWith(`/${route.pattern}`));
  return matches.sort((a, b) => b.pattern.length - a.pattern.length)[0] ?? null;
}

/** `data-at-routes` do modo `classic`: `padrão|funcionalidade|tela` separados por `;`. */
export function encodeScreenRoutes(routes: readonly ScreenRoute[]): string {
  return routes.map((route) => [route.pattern, route.funcionalidade, route.tela].join('|')).join(';');
}

export function decodeScreenRoutes(value: string | null | undefined): ScreenRoute[] {
  return (value ?? '').split(';').map((item) => item.split('|')).filter((parts) => parts.length === 3 && parts.every(Boolean))
    .map(([pattern, funcionalidade, tela]) => ({ pattern: pattern!, funcionalidade: funcionalidade!, tela: tela! }));
}

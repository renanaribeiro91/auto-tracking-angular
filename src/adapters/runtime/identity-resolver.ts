// T05 + T06 — resolver de identidade nativa e tema Web
// Usa só a ponte global que o runtime nativo do Capacitor instala no WebView.
// Importar @capacitor/* carregaria/avaliaria cópias do pacote no meio do gesto
// (em microfrontends cada bundle tem a sua) e acoplaria a lib à versão do app.

import type { TrackingPreset } from '../../config.js';

export interface NativeIdentityResult {
  readonly bundleId: string;
  readonly environment: string;
}

/** Subconjunto estável (Capacitor 3+) de `window.Capacitor` usado pela lib. */
interface CapacitorBridge {
  isNativePlatform?(): boolean;
  nativePromise?(plugin: string, method: string, options?: object): Promise<unknown>;
  Plugins?: Record<string, { getInfo?(): Promise<unknown> } | undefined>;
}

export type IdentityResolution =
  | { readonly kind: 'native'; readonly result: NativeIdentityResult }
  | { readonly kind: 'web'; readonly environment: string }
  | { readonly kind: 'unknown'; readonly reason: string };

/** Resolve a identidade do ambiente a partir do Capacitor ou do tema Web. */
export class AppIdentityResolver {
  private nativeBundleId: Promise<string> | null = null;
  private nativeFailure: { message: string; retryAfter: number } | null = null;

  async resolve(
    preset: TrackingPreset,
    getWebTheme: (() => string | Promise<string>) | undefined,
  ): Promise<IdentityResolution> {
    const nativeResult = await this.tryNativeIdentity(preset);
    if (nativeResult) return nativeResult;
    if (!getWebTheme) return { kind: 'unknown', reason: 'plataforma não nativa e getWebTheme não configurado' };

    try {
      const theme = await getWebTheme();
      const environment = preset.webThemeToEnvironment[theme];
      return environment
        ? { kind: 'web', environment }
        : { kind: 'unknown', reason: `tema Web '${theme}' não mapeado no preset` };
    } catch (error) {
      return { kind: 'unknown', reason: `falha ao obter tema Web: ${String(error)}` };
    }
  }

  private async tryNativeIdentity(preset: TrackingPreset): Promise<IdentityResolution | null> {
    if (!this.isNativePlatform()) return null;
    try {
      const bundleId = await this.getNativeBundleId();
      const environment = preset.nativeAppIdToEnvironment[bundleId];
      if (!environment) return { kind: 'unknown', reason: `bundle ID '${bundleId}' não mapeado no preset` };
      return { kind: 'native', result: { bundleId, environment } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Plataforma nativa confirmada: não substituir identidade quebrada pelo
      // tema Web, isso mascararia uma configuração inválida.
      return { kind: 'unknown', reason: `erro ao obter identidade nativa: ${message}` };
    }
  }

  private async getNativeBundleId(): Promise<string> {
    // O identificador do bundle é imutável em uma sessão. Evitar chamadas
    // repetidas à ponte nativa em cada gesto; falhas transitórias expiram.
    const now = Date.now();
    if (this.nativeFailure && now < this.nativeFailure.retryAfter) {
      throw new Error(this.nativeFailure.message);
    }
    if (!this.nativeBundleId) {
      this.nativeFailure = null;
      this.nativeBundleId = this.nativeAppInfo()
        .then((info) => {
          const id = (info as { id?: unknown } | null)?.id;
          if (typeof id !== 'string' || !id) throw new Error('App.getInfo() sem id de bundle');
          return id;
        })
        .catch((error: unknown) => {
          this.nativeBundleId = null;
          this.nativeFailure = {
            message: error instanceof Error ? error.message : String(error),
            retryAfter: Date.now() + 5_000,
          };
          throw error;
        });
    }
    return this.nativeBundleId;
  }

  private bridge(): CapacitorBridge | undefined {
    return (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
  }

  /** Síncrono e sem import: apps web puros não têm `window.Capacitor`. */
  private isNativePlatform(): boolean {
    try { return this.bridge()?.isNativePlatform?.() === true; }
    catch { return false; }
  }

  /** Plugin App já registrado pelo app ou chamada direta à ponte nativa. */
  private nativeAppInfo(): Promise<unknown> {
    const bridge = this.bridge();
    try {
      const plugin = bridge?.Plugins?.['App'];
      if (plugin?.getInfo) return Promise.resolve(plugin.getInfo());
      if (bridge?.nativePromise) return Promise.resolve(bridge.nativePromise('App', 'getInfo', {}));
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error('plugin App do Capacitor indisponível na ponte nativa'));
  }
}

const appIdentityResolver = new AppIdentityResolver();
export const resolveIdentity = (preset: TrackingPreset, getWebTheme: (() => string | Promise<string>) | undefined): Promise<IdentityResolution> =>
  appIdentityResolver.resolve(preset, getWebTheme);

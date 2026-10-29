// T05 + T06 — resolver de identidade nativa e tema Web
// Carregamento opcional do plugin Capacitor; erro explícito se configurado mas ausente

import type { TrackingPreset } from '../../config.js';

export interface NativeIdentityResult {
  readonly bundleId: string;
  readonly environment: string;
}

export type IdentityResolution =
  | { readonly kind: 'native'; readonly result: NativeIdentityResult }
  | { readonly kind: 'web'; readonly environment: string }
  | { readonly kind: 'unknown'; readonly reason: string };

/** Resolve a identidade do ambiente a partir do Capacitor ou do tema Web. */
export class AppIdentityResolver {
  private platformProbe: Promise<boolean> | null = null;
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
    let nativePlatformConfirmed = false;
    try {
      nativePlatformConfirmed = await this.isNativePlatform();
      if (!nativePlatformConfirmed) return null;
      const bundleId = await this.getNativeBundleId();
      const environment = preset.nativeAppIdToEnvironment[bundleId];
      if (!environment) return { kind: 'unknown', reason: `bundle ID '${bundleId}' não mapeado no preset` };
      return { kind: 'native', result: { bundleId, environment } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Falha de módulo só indica Web sem Capacitor antes de a plataforma
      // nativa ser confirmada. Se já é nativo, não substituir identidade
      // quebrada pelo tema Web: isso mascararia uma configuração inválida.
      if (!nativePlatformConfirmed && this.isUnavailableOnWeb(message)) return null;
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
      this.nativeBundleId = import('@capacitor/app')
        .then(({ App }) => App.getInfo())
        .then((info) => info.id)
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

  private isNativePlatform(): Promise<boolean> {
    // Em Web, centenas de gestos não precisam repetir import/checagem da
    // ponte Capacitor. Falha de import não fica guardada como sucesso.
    if (!this.platformProbe) {
      this.platformProbe = import('@capacitor/core')
        .then(({ Capacitor }) => Capacitor.isNativePlatform())
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (this.isUnavailableOnWeb(message)) return false;
          this.platformProbe = null;
          throw error;
        });
    }
    return this.platformProbe;
  }

  private isUnavailableOnWeb(message: string): boolean {
    // Browser puro: o import opcional do Capacitor pode falhar com mensagens
    // distintas em Chrome, Safari/WebKit, Node e bundlers. Nesse caso, usar
    // o tema Web fornecido pelo consumidor sem esconder uma falha da bridge
    // nativa já instalada.
    return [
      'not implemented', 'not available', 'Cannot find module',
      'Failed to resolve module specifier', 'Unable to resolve specifier',
      'Cannot find package', 'ERR_MODULE_NOT_FOUND',
    ].some((phrase) => message.includes(phrase));
  }
}

const appIdentityResolver = new AppIdentityResolver();
export const resolveIdentity = (preset: TrackingPreset, getWebTheme: (() => string | Promise<string>) | undefined): Promise<IdentityResolution> =>
  appIdentityResolver.resolve(preset, getWebTheme);

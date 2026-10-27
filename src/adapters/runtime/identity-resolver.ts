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
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return null;
      const { App } = await import('@capacitor/app');

      const info = await App.getInfo();
      const bundleId = info.id;
      const environment = preset.nativeAppIdToEnvironment[bundleId];
      if (!environment) return { kind: 'unknown', reason: `bundle ID '${bundleId}' não mapeado no preset` };
      return { kind: 'native', result: { bundleId, environment } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isUnavailableOnWeb(message)) return null;
      return { kind: 'unknown', reason: `erro ao obter App.getInfo(): ${message}` };
    }
  }

  private isUnavailableOnWeb(message: string): boolean {
    return ['not implemented', 'not available', 'Cannot find module'].some((phrase) => message.includes(phrase));
  }
}

const appIdentityResolver = new AppIdentityResolver();
export const resolveIdentity = (preset: TrackingPreset, getWebTheme: (() => string | Promise<string>) | undefined): Promise<IdentityResolution> =>
  appIdentityResolver.resolve(preset, getWebTheme);

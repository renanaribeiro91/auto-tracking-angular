// Identidade tipada browser-safe — sem dependências de Node, Angular em runtime, filesystem ou XLSX
// A CLI lê esta configuração pela AST sem executar o módulo

import type { Injector } from '@angular/core';
import type { TrackingEvent, TrackingSchema } from './domain/contract/schema.js';
export type { TrackingEvent } from './domain/contract/schema.js';

export interface TrackingPreset {
  readonly id: string;
  readonly version: string;
  readonly schema: TrackingSchema;
  readonly nativeAppIdToEnvironment: Readonly<Record<string, string>>;
  readonly webThemeToEnvironment: Readonly<Record<string, string>>;
}

export type TrackingMode = 'classic' | 'ref';

export interface TrackingOptions {
  /** classic preserva os atributos originais (padrão); ref usa token autocontido. */
  readonly mode?: TrackingMode;
  readonly owner: string;
  readonly root: string;
  readonly product: string;
  readonly preset: TrackingPreset;
  readonly getWebTheme?: (injector: Injector) => string | Promise<string>;
  readonly send: (event: TrackingEvent, injector: Injector) => void | Promise<void>;
}

export interface AutoTrackingProjectConfig {
  readonly projects: readonly { angularProject: string; tsconfig: string }[];
  readonly output?: string;
  readonly branding?: { logoPng?: string; watermarkPng?: string; primaryColor?: string };
  readonly runtime: TrackingOptions;
}

/** Identidade tipada: retorna o argumento sem transformação para permitir leitura estática via TypeChecker */
export function defineAutoTrackingProject<T extends AutoTrackingProjectConfig>(config: T): T {
  return config;
}

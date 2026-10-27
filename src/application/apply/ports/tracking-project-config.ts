export interface ProjectConfig {
  readonly angularProject: string;
  readonly tsconfig: string;
}

export interface StaticTrackingConfig {
  readonly projects: readonly ProjectConfig[];
  readonly output: string;
  readonly owner: string;
  readonly root: string;
  readonly product: string;
  readonly hasPreset: boolean;
  readonly mode: 'classic' | 'ref';
  readonly configFile: string;
  readonly hasBranding: boolean;
  readonly branding: { readonly logoPng?: string; readonly watermarkPng?: string; readonly primaryColor?: string };
  readonly presetName: string;
}

export interface AngularWorkspace {
  readonly rootDir: string;
  readonly angularJsonPath: string;
  readonly projects: ReadonlyMap<string, { sourceRoot: string; tsconfig: string }>;
}

export interface TrackingProjectConfigReader {
  readTrackingConfigStatically(configFile: string): StaticTrackingConfig | null;
  readAngularWorkspace(rootDir: string): AngularWorkspace | null;
}

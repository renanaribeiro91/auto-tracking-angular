export interface ResolvedPaths {
  readonly configFile: string;
  readonly outputDir: string;
  readonly excelFile: string;
  readonly relatorioFile: string;
  readonly cacheDir: string;
}

export interface OutputPathResolverPort {
  resolve(consumerRoot: string, outputConfig: string | undefined): ResolvedPaths | null;
}

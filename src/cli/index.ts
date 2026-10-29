#!/usr/bin/env node
// CLI auto-tracking: apply | verify. Exit 0 válido, 1 incompleto, 2 erro.
// Terminal interativo: relatório legível. Esteira (stdout não-TTY) ou --json: uma linha JSON pura.
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { AngularProjectConfigReader, type StaticTrackingConfig } from '../adapters/angular-compiler/angular-index.js';
import { OutputPathResolver, type ResolvedPaths } from '../adapters/filesystem/project-config.js';
import type { PipelineResult, PlannedChange, TrackingPipeline } from '../application/apply/pipeline.js';
import type { EvidenceWorkbookWriter, WorkbookBranding } from '../adapters/reports/evidence-writer.js';
import { BLOCKING_DIAGNOSTIC_CODES, CLI_EXIT_CODES, CLI_HELP_TEXT } from './constants.js';

type Summary = Record<string, number>;

interface CacheState {
  readonly fingerprint: string;
  readonly relatorioSha: string;
  readonly planilhaSha: string;
  readonly summary: Summary;
}

interface Report {
  readonly command: 'apply' | 'verify';
  readonly status: 'valid' | 'incomplete';
  readonly summary: Summary;
  readonly cache: boolean;
  readonly planilha: string;
  readonly written?: readonly string[];
  readonly dryRun?: boolean;
  readonly pendencias?: readonly string[];
  readonly diagnosticos?: readonly { code: string; arquivo: string; linha: number; mensagem: string }[];
}

/** Converte relatórios de execução para os dois formatos públicos do CLI. */
class CliReportFormatter {
  toJson(report: Report): Record<string, unknown> {
    const output: Record<string, unknown> = { status: report.status, ...report.summary };
    if (report.command === 'apply') {
      Object.assign(output, { arquivosEscritos: report.written?.length ?? 0, dryRun: report.dryRun ?? false });
    }
    if (report.pendencias) output['pendencias'] = report.pendencias;
    if (report.diagnosticos?.length) output['diagnosticos'] = report.diagnosticos;
    if (report.cache) output['cache'] = 'hit';
    return output;
  }

  toText(report: Report, root: string, elapsedMs: number): string {
    const color = process.env['NO_COLOR'] === undefined;
    const paint = (code: string, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
    const brand = (text: string) => paint('1;36', text);
    const dim = (text: string) => paint('2', text);
    const bold = (text: string) => paint('1', text);
    const version = this.packageVersion();
    const mode = report.command === 'verify' ? 'verificação' : report.dryRun ? 'simulação' : 'tagueamento';
    const width = 52;
    const visibleLength = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const frameLine = (left: string, right = '') =>
      `  ${dim('│')}  ${left}${' '.repeat(Math.max(1, width - 4 - visibleLength(left) - visibleLength(right)))}${right}  ${dim('│')}`;
    const metric = (label: string, value: number | undefined, note: string) =>
      `  ${brand('▸')} ${label.padEnd(12)}${bold(String(value ?? 0).padStart(6))}   ${dim(note)}`;
    const summary = report.summary;
    const lines = [
      '',
      `  ${dim('╭' + '─'.repeat(width) + '╮')}`,
      frameLine(bold('auto-tracking'), dim(`v${version}`)),
      frameLine(dim(`${mode} · ${path.basename(root)}`)),
      `  ${dim('╰' + '─'.repeat(width) + '╯')}`,
      '',
      `  ${bold('Cobertura')}`,
      metric('Módulos', summary['modulos'], 'abas da planilha'),
      metric('Telas', summary['telas'], 'screen_view'),
      metric('Interações', summary['interacoes'], 'clique'),
      metric('Templates', summary['templates'], 'analisados'),
    ];

    this.appendExecution(lines, report, dim, bold);
    this.appendIssues(lines, report, paint);
    this.appendStatus(lines, report, elapsedMs, paint, dim);
    return lines.join('\n');
  }

  private appendExecution(lines: string[], report: Report, dim: (text: string) => string, bold: (text: string) => string): void {
    if (report.command !== 'apply') return;
    const written = report.written ?? [];
    lines.push('', `  ${bold('Nesta execução')}`);
    if (report.dryRun) {
      lines.push(`  ${dim('•')} nada gravado ${dim('(--dry-run)')}`);
      return;
    }
    if (written.length === 0) {
      lines.push(`  ${dim('•')} ${bold('Validação concluída')} ${dim('— marcações e evidências atualizadas, sem alterações necessárias')}`);
      return;
    }

    lines.push(`  ${dim('•')} ${bold(String(written.length))} arquivos atualizados`);
    for (const file of written.slice(0, 6)) lines.push(`    ${dim('↳ ' + file)}`);
    if (written.length > 6) lines.push(`    ${dim(`↳ … e mais ${written.length - 6}`)}`);
  }

  private appendIssues(lines: string[], report: Report, paint: (code: string, text: string) => string): void {
    const issues = [
      ...(report.pendencias ?? []),
      ...(report.diagnosticos ?? []).map((diagnostic) => `${diagnostic.code}  ${diagnostic.arquivo}:${diagnostic.linha}  ${diagnostic.mensagem}`),
    ];
    if (issues.length === 0) return;
    lines.push('', `  ${paint('1;33', 'Atenção')}`);
    for (const issue of issues) lines.push(`  ${paint('33', '•')} ${issue}`);
  }

  private appendStatus(
    lines: string[],
    report: Report,
    elapsedMs: number,
    paint: (code: string, text: string) => string,
    dim: (text: string) => string,
  ): void {
    const status = report.status === 'valid' ? paint('1;32', '✔ Tagueamento completo') : paint('1;33', '✖ Tagueamento incompleto');
    const cacheNote = report.cache ? ' · sem mudanças desde a última execução' : '';
    lines.push('', `  ${status}  ${dim(`${elapsedMs} ms${cacheNote}`)}`, `  ${dim('↳ planilha')}  ${report.planilha}`, '');
  }

  private packageVersion(): string {
    const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as { version: string }).version;
  }
}

/** Coordena apply/verify, cache, escrita protegida e ciclo de execução do CLI. */
class AutoTrackingCli {
  private readonly formatter = new CliReportFormatter();
  private readonly configReader = new AngularProjectConfigReader();
  private readonly outputPathResolver = new OutputPathResolver();

  private sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private fileSha(file: string): string | null {
    return fs.existsSync(file) ? this.sha256(fs.readFileSync(file)) : null;
  }

  private atomicWrite(file: string, content: string): void {
    const temporaryFile = `${file}.at-tmp-${process.pid}`;
    fs.writeFileSync(temporaryFile, content, 'utf-8');
    fs.renameSync(temporaryFile, file);
  }

  private applyChanges(changes: readonly PlannedChange[]): void {
    const completed: PlannedChange[] = [];
    try {
      for (const change of changes) {
        if ((fs.existsSync(change.file) ? fs.readFileSync(change.file, 'utf-8') : '') !== change.before) {
          throw new Error(`arquivo alterado durante a execução: ${change.file}`);
        }
        this.atomicWrite(change.file, change.after);
        completed.push(change);
      }
    } catch (error) {
      for (const change of completed.reverse()) {
        if (change.before === '') fs.rmSync(change.file, { force: true });
        else this.atomicWrite(change.file, change.before);
      }
      throw error;
    }
  }

  private resolveBranding(root: string, config: StaticTrackingConfig): WorkbookBranding {
    const configuredBranding = this.configuredBranding(root, config);
    if (configuredBranding) return configuredBranding;
    return {};
  }

  private configuredBranding(root: string, config: StaticTrackingConfig): WorkbookBranding | null {
    const { logoPng, watermarkPng, primaryColor } = config.branding;
    if (!config.hasBranding) return null;
    if (primaryColor && !/^#[0-9a-f]{6}$/i.test(primaryColor)) throw new Error('branding.primaryColor deve usar o formato #RRGGBB');
    for (const file of [logoPng, watermarkPng]) {
      if (file && (!fs.existsSync(path.resolve(root, file)) || !fs.statSync(path.resolve(root, file)).isFile())) {
        throw new Error(`imagem de branding não encontrada: ${file}`);
      }
    }
    return {
      logoPng: logoPng ? path.resolve(root, logoPng) : undefined,
      watermarkPng: watermarkPng ? path.resolve(root, watermarkPng) : undefined,
      primaryColor,
    };
  }

  private readCache(paths: ResolvedPaths): CacheState | null {
    const cacheFile = path.join(paths.cacheDir, 'estado.json');
    try {
      return fs.existsSync(cacheFile) ? (JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as CacheState) : null;
    } catch {
      return null;
    }
  }

  private async run(command: 'apply' | 'verify', root: string, configFile: string, dryRun: boolean): Promise<Report> {
    const config = this.configReader.readTrackingConfigStatically(configFile);
    if (!config) throw new Error(`config não encontrada ou sem runtime.owner/product: ${path.relative(root, configFile) || configFile}`);
    const paths = this.outputPathResolver.resolve(root, config.output);
    if (!paths) throw new Error(`output inválido: ${config.output}`);

    // Carrega o motor somente após validar a configuração e os caminhos de saída.
    const { TrackingPipelineFactory } = await import('./tracking-pipeline-composition.js');
    const pipeline = new TrackingPipelineFactory().create();
    const implementation = this.implementationFingerprint();
    const fingerprint = this.fingerprint(pipeline, root, configFile, implementation);

    const { EvidenceWorkbookWriter } = await import('../adapters/reports/evidence-writer.js');
    const workbook = new EvidenceWorkbookWriter();
    const result = pipeline.runPipeline(root, configFile);
    const summary = pipeline.summarize(result);
    const branding = this.resolveBranding(root, config);
    // A evidência Excel depende do contrato e do layout, não do código do
    // runtime/DOM. Corrigir um listener não deve regravar a planilha idêntica.
    const signature = workbook.workbookSignature(result.relatorio, branding);
    const reportChanged = this.fileContent(paths.relatorioFile) !== result.relatorio;
    const workbookChanged = (await workbook.readWorkbookSignature(paths.excelFile)) !== signature;
    const status = result.diagnostics.some((d) => BLOCKING_DIAGNOSTIC_CODES.has(d.code)) ? 'incomplete' : 'valid';
    // O cache reutiliza artefatos, nunca substitui a prova sobre o código e os
    // pacotes atualmente instalados (inclusive dependências locais sem lock novo).
    if (result.changes.length === 0 && !reportChanged && !workbookChanged) {
      const cachedReport = this.cachedReport(command, root, paths, fingerprint, dryRun);
      if (cachedReport) return { ...cachedReport, status, summary, diagnosticos: result.diagnostics };
    }

    if (command === 'verify') {
      // A evidência só está íntegra quando o fingerprint também corresponde
      // às fontes, dependências e implementação atual, mesmo sem novos tokens.
      const cacheValid = this.cachedReport('verify', root, paths, fingerprint, false) !== null;
      return this.verificationReport(root, paths, result, summary, status, reportChanged, workbookChanged, !cacheValid);
    }
    return this.applyReport(root, config, configFile, paths, result, summary, status, branding, signature, reportChanged, workbookChanged, dryRun, pipeline, workbook);
  }

  private cachedReport(
    command: 'apply' | 'verify',
    root: string,
    paths: ResolvedPaths,
    fingerprint: string,
    dryRun: boolean,
  ): Report | null {
    const cache = this.readCache(paths);
    const cacheMatches =
      cache?.fingerprint === fingerprint &&
      this.fileSha(paths.relatorioFile) === cache.relatorioSha &&
      this.fileSha(paths.excelFile) === cache.planilhaSha;
    if (!cacheMatches || !cache) return null;

    // Um hit de cache não transforma uma falha causal em relatório sem motivos.
    // A evidência já passou pela verificação de SHA acima; reaproveite os diagnósticos.
    let diagnostics: Report['diagnosticos'];
    try {
      const saved = JSON.parse(fs.readFileSync(paths.relatorioFile, 'utf-8')) as {
        diagnostics?: Report['diagnosticos'];
      };
      if (!Array.isArray(saved.diagnostics) || saved.diagnostics.length !== cache.summary['diagnosticos']) return null;
      diagnostics = saved.diagnostics;
    } catch {
      return null; // Evidência inválida obriga análise completa, nunca aprovação pelo cache.
    }

    return {
      command,
      status: diagnostics.some((d) => BLOCKING_DIAGNOSTIC_CODES.has(d.code)) ? 'incomplete' : 'valid',
      summary: cache.summary,
      cache: true,
      planilha: path.relative(root, paths.excelFile),
      written: [],
      pendencias: [],
      diagnosticos: diagnostics,
      dryRun,
    };
  }

  private verificationReport(
    root: string,
    paths: ResolvedPaths,
    result: PipelineResult,
    summary: Summary,
    status: Report['status'],
    reportChanged: boolean,
    workbookChanged: boolean,
    cacheInvalid: boolean,
  ): Report {
    const pending = [
      ...result.changes.map((change) => `marcação pendente: ${path.relative(root, change.file)}`),
      ...(reportChanged ? ['relatorio.json desatualizado'] : []),
      ...(workbookChanged ? ['evidencia-tagueamento.xlsx ausente ou desatualizada'] : []),
      ...(cacheInvalid ? ['cache/estado.json desatualizado ou inválido'] : []),
    ];
    return {
      command: 'verify',
      status: pending.length === 0 ? status : 'incomplete',
      summary,
      cache: false,
      planilha: path.relative(root, paths.excelFile),
      pendencias: pending,
      diagnosticos: result.diagnostics,
    };
  }

  private async applyReport(
    root: string,
    config: StaticTrackingConfig,
    configFile: string,
    paths: ResolvedPaths,
    result: PipelineResult,
    summary: Summary,
    status: Report['status'],
    branding: WorkbookBranding,
    signature: string,
    reportChanged: boolean,
    workbookChanged: boolean,
    dryRun: boolean,
    pipeline: TrackingPipeline,
    workbook: EvidenceWorkbookWriter,
  ): Promise<Report> {
    if (dryRun) return this.applyResult(root, paths, result, summary, status, [], true);

    const invalidManifest = result.diagnostics.find((d) => d.code === 'TRACKING_REFERENCE_UNKNOWN');
    if (invalidManifest) throw new Error(`${invalidManifest.code}: ${invalidManifest.mensagem}`);
    fs.mkdirSync(paths.outputDir, { recursive: true });
    this.applyChanges(result.changes);
    const written = result.changes.map((change) => path.relative(root, change.file));
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    if (reportChanged) {
      this.atomicWrite(paths.relatorioFile, result.relatorio);
      written.push(path.relative(root, paths.relatorioFile));
    }
    if (reportChanged || workbookChanged) {
      await workbook.writeEvidenceWorkbook(
        paths.excelFile,
        { owner: config.owner, product: config.product, entries: result.entries, branding },
        signature,
      );
      written.push(path.relative(root, paths.excelFile));
    }

    this.writeCache(root, configFile, paths, summary, result.relatorio, pipeline, written);
    return this.applyResult(root, paths, result, summary, status, written, false);
  }

  private implementationFingerprint(): string {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const hash = createHash('sha256').update(fs.readFileSync(path.join(root, '..', 'package.json')));
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && entry.name.endsWith('.js')) hash.update(path.relative(root, file)).update(fs.readFileSync(file));
      }
    };
    walk(root);
    return hash.digest('hex');
  }

  private fingerprint(pipeline: TrackingPipeline, root: string, configFile: string, implementation: string): string {
    return createHash('sha256').update(pipeline.inputFingerprint(root, configFile)).update(implementation).digest('hex');
  }

  private writeCache(
    root: string,
    configFile: string,
    paths: ResolvedPaths,
    summary: Summary,
    report: string,
    pipeline: TrackingPipeline,
    written: string[],
  ): void {
    const state: CacheState = {
      fingerprint: this.fingerprint(pipeline, root, configFile, this.implementationFingerprint()),
      relatorioSha: this.sha256(report),
      planilhaSha: this.fileSha(paths.excelFile)!,
      summary,
    };
    const cacheFile = path.join(paths.cacheDir, 'estado.json');
    const content = `${JSON.stringify(state, null, 2)}\n`;
    if (this.fileContent(cacheFile) === content) return;
    this.atomicWrite(cacheFile, content);
    written.push(path.relative(root, cacheFile));
  }

  private applyResult(
    root: string,
    paths: ResolvedPaths,
    result: PipelineResult,
    summary: Summary,
    status: Report['status'],
    written: readonly string[],
    dryRun: boolean,
  ): Report {
    return {
      command: 'apply',
      status,
      summary,
      cache: false,
      planilha: path.relative(root, paths.excelFile),
      written,
      dryRun,
      diagnosticos: result.diagnostics,
    };
  }

  private fileContent(file: string): string | null {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  }

  private option(args: readonly string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  }

  private normalizeCommand(args: readonly string[]): [string, string[]] {
    const [first, ...remaining] = args;
    if (!first || (first.startsWith('--') && first !== '--help' && first !== '--version')) return ['apply', [...args]];
    return [first, remaining];
  }

  private packageVersion(): string {
    const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as { version: string }).version;
  }

  async main(): Promise<number> {
    const [command, args] = this.normalizeCommand(process.argv.slice(2));
    if (command === '--help' || args.includes('--help')) {
      process.stdout.write(`${CLI_HELP_TEXT}\n`);
      return CLI_EXIT_CODES.valid;
    }
    if (command === '--version') {
      process.stdout.write(`${this.packageVersion()}\n`);
      return CLI_EXIT_CODES.valid;
    }
    if (command !== 'apply' && command !== 'verify') {
      throw new Error(`comando desconhecido: ${command} (rode sem comando, ou use verify)`);
    }

    const json = args.includes('--json') || (!process.stdout.isTTY && !args.includes('--pretty'));
    const root = path.resolve(this.option(args, '--root') ?? process.cwd());
    const configFile = path.resolve(root, this.option(args, '--config') ?? 'auto-tracking.config.ts');
    const startedAt = Date.now();
    const report = await this.run(command, root, configFile, args.includes('--dry-run'));
    const output = json
      ? `${JSON.stringify(this.formatter.toJson(report))}\n`
      : this.formatter.toText(report, root, Date.now() - startedAt);
    process.stdout.write(output);
    return report.status === 'valid' ? CLI_EXIT_CODES.valid : CLI_EXIT_CODES.incomplete;
  }
}

new AutoTrackingCli().main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (process.argv.includes('--json') || !process.stdout.isTTY) process.stdout.write(JSON.stringify({ status: 'error', message }) + '\n');
    else process.stderr.write(`\n  \x1b[31m✖ erro\x1b[0m  ${message}\n\n`);
    process.exit(CLI_EXIT_CODES.error);
  },
);

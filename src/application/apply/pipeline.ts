// T15–T26 — pipeline único usado por apply e verify: config estática → índice AST → marcações → relatório
import { createHash } from 'node:crypto';
import * as path from 'path';
import { TemplateTagger, type TagDiagnostic, type TagEntry } from './tagger.js';
import { numericSelectionMethods } from './selection-provenance.js';
import { ComponentScreenResolver } from './component-screen-resolver.js';
import type { ComponentInfo, ProjectIndex } from './ports/project-index.js';
import { ScreenIdentityResolver } from './screen-identity-resolver.js';
import { ENGINE_VERSION } from './constants.js';
import { SCREEN_IDENTITY_REFINEMENT_LEVELS } from './screen-identity.config.js';
import { decodeOutputBindings } from '../../domain/contract/output-bindings.js';
import { decodeTrackingToken } from '../../domain/contract/tracking-token.js';
import type { StaticTrackingConfig } from './ports/tracking-project-config.js';
import type { ResolvedPaths } from './ports/output-paths.js';
import type { TrackingPipelineDependencies } from './ports/tracking-pipeline-dependencies.js';

export interface PlannedChange {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

export interface PipelineResult {
  readonly config: StaticTrackingConfig;
  readonly paths: ResolvedPaths;
  readonly changes: readonly PlannedChange[];
  readonly entries: readonly TagEntry[];
  readonly diagnostics: readonly TagDiagnostic[];
  readonly relatorio: string;
  readonly templates: number;
}

export class PipelineError extends Error {}

/** Caso de uso de aplicação que indexa projetos, reconcilia templates e monta evidências. */
export class TrackingPipeline {
  private readonly configReader: TrackingPipelineDependencies['configReader'];
  private readonly projectIndexer: TrackingPipelineDependencies['projectIndexer'];
  private readonly componentCatalogBuilder: TrackingPipelineDependencies['componentCatalogBuilder'];
  private readonly outputPathResolver: TrackingPipelineDependencies['outputPathResolver'];
  private readonly fileSystem: TrackingPipelineDependencies['fileSystem'];
  private readonly tagger = new TemplateTagger();
  private readonly componentScreenResolver = new ComponentScreenResolver();
  private readonly screenIdentityResolver = new ScreenIdentityResolver();

  constructor(dependencies: TrackingPipelineDependencies) {
    this.configReader = dependencies.configReader;
    this.projectIndexer = dependencies.projectIndexer;
    this.componentCatalogBuilder = dependencies.componentCatalogBuilder;
    this.outputPathResolver = dependencies.outputPathResolver;
    this.fileSystem = dependencies.fileSystem;
  }

  private scanRootFor(consumerRoot: string, tsconfig: string, sourceRoot: string | undefined): string {
    const besideTsconfig = path.join(consumerRoot, path.dirname(tsconfig), 'src');
    if (this.fileSystem.exists(besideTsconfig)) return besideTsconfig;
    const fromWorkspace = path.join(consumerRoot, sourceRoot ?? 'src');
    if (this.fileSystem.exists(fromWorkspace)) return fromWorkspace;
    throw new PipelineError(`raiz de código não encontrada para ${tsconfig}`);
  }

  private relativePath(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
  }

  runPipeline(consumerRoot: string, configFile: string): PipelineResult {
    const config = this.configReader.readTrackingConfigStatically(configFile);
    if (!config) throw new PipelineError(`config não encontrada ou sem runtime.owner/product: ${configFile}`);
    if (config.projects.length === 0) throw new PipelineError('config sem projects[]');
    const paths = this.outputPathResolver.resolve(consumerRoot, config.output);
    if (!paths) throw new PipelineError(`output inválido: ${config.output}`);

    const workspace = this.configReader.readAngularWorkspace(consumerRoot);
    const changes: PlannedChange[] = [];
    const entries: TagEntry[] = [];
    const diagnostics: TagDiagnostic[] = [];
    let templates = 0;
    const claimedIds = new Set<string>();

    for (const project of config.projects) {
      const ws = workspace?.projects.get(project.angularProject);
      if (!ws) throw new PipelineError(`projeto '${project.angularProject}' não existe no angular.json`);
      const scanRoot = this.scanRootFor(consumerRoot, project.tsconfig, ws.sourceRoot);
      const index: ProjectIndex = this.projectIndexer.buildProjectIndex(scanRoot);
      for (const route of index.ambiguousRoutes) {
        diagnostics.push({
          code: 'ROUTED_COMPONENT_AMBIGUOUS',
          arquivo: this.relativePath(consumerRoot, route.file),
          linha: route.line,
          mensagem: `a rota '${route.className}' corresponde a mais de um componente; importe a declaração correta para marcar a tela com segurança`,
        });
      }
      const catalog = this.componentCatalogBuilder.buildCatalog(consumerRoot, index.components.map((c) => c.def));
      // identidade de analytics única por tela: refina só as telas que colidiriam com outra
      const refineOf = new Map<ComponentInfo, 1 | 2 | 3>();
      const routedComponents = index.components.filter((component) => index.routedComponents.has(component.key));
      const identityFor = (component: ComponentInfo, refine: 0 | 1 | 2 | 3 = 0) =>
        this.screenIdentityResolver.resolve(scanRoot, component.templateFile ?? component.tsFile, refine, refine === 3 ? component.className : '', index.routedComponents.has(component.key));
      for (const level of SCREEN_IDENTITY_REFINEMENT_LEVELS) {
        const seen = new Map<string, ComponentInfo[]>();
        for (const c of routedComponents) {
          const id = identityFor(c, refineOf.get(c) ?? 0);
          const key = `${id.funcionalidade}:${id.tela}`;
          seen.set(key, [...(seen.get(key) ?? []), c]);
        }
        for (const group of seen.values()) if (group.length > 1) for (const c of group) refineOf.set(c, level);
      }
      const finalScreenIds = new Map<string, ComponentInfo[]>();
      for (const component of routedComponents) {
        const identity = identityFor(component, refineOf.get(component) ?? 0);
        const key = `${identity.funcionalidade}:${identity.tela}`;
        finalScreenIds.set(key, [...(finalScreenIds.get(key) ?? []), component]);
      }
      const unresolvedCollision = [...finalScreenIds].find(([, components]) => components.length > 1);
      if (unresolvedCollision) {
        throw new PipelineError(`identidade de tela ambígua '${unresolvedCollision[0]}' em ${unresolvedCollision[1].map((component) => this.relativePath(consumerRoot, component.tsFile)).join(', ')}`);
      }
      const identity = (component: ComponentInfo) => identityFor(component, refineOf.get(component) ?? 0);
      const screensOf = this.componentScreenResolver.resolve(index, identity);
      if (index.providerCalls === 0) {
        diagnostics.push({ code: 'BOOTSTRAP_PROVIDER_MISSING', arquivo: this.relativePath(consumerRoot, scanRoot), linha: 1, mensagem: 'nenhum provideAutoTracking(<config>.runtime) no bootstrap: marcações não emitem em runtime' });
      }

      // um alvo por template: arquivo .html inteiro ou o literal inline dentro do .ts
      const targets = index.components
        .map((c) => {
          if (c.templateFile && this.fileSystem.exists(c.templateFile)) return { c, file: c.templateFile, inline: null };
          if (c.inline) return { c, file: c.tsFile, inline: c.inline };
          if (c.inlineTemplate) {
            diagnostics.push({ code: 'INLINE_TEMPLATE_INTERPOLATED', arquivo: this.relativePath(consumerRoot, c.tsFile), linha: 1, mensagem: `${c.className} monta o template com \${}; não editável com segurança` });
          }
          return null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
        // por arquivo, do fim para o início: editar um literal não desloca os anteriores
        .sort((a, b) => a.file.localeCompare(b.file) || (b.inline?.start ?? 0) - (a.inline?.start ?? 0));

      const original = new Map<string, string>();
      const current = new Map<string, string>();
      for (const t of targets) if (!original.has(t.file)) original.set(t.file, this.fileSystem.readText(t.file));
      for (const [f, text] of original) current.set(f, text);

      // ids existentes são reservados antes de gerar novos, para que a ordem de arquivos não troque ids
      const usedIds = new Set<string>(claimedIds);
      for (const text of original.values()) for (const m of text.matchAll(/data-at-(?:id|screen)=["']([^"']+)["']/g)) usedIds.add(m[1]!);
      for (const text of original.values()) {
        for (const match of text.matchAll(/data-at-(?:overlay-)?outputs=["']([^"']+)["']/g)) {
          for (const output of decodeOutputBindings(match[1])) usedIds.add(output.id);
        }
        for (const match of text.matchAll(/data-at-ref=["']([^"']+)["']/g)) {
          const element = decodeTrackingToken(match[1]!);
          if (element?.screenId) usedIds.add(element.screenId);
          if (element?.click) usedIds.add(element.click.id);
          for (const output of [...(element?.outputs ?? []), ...(element?.overlayOutputs ?? [])]) usedIds.add(output.id);
        }

      }

      for (const t of targets) {
        const text = current.get(t.file)!;
        // no literal inline, só a aspa delimitadora vem escapada: desescapa para o parser e reescapa ao gravar
        const quote = t.inline?.quote;
        const html = t.inline ? text.slice(t.inline.start, t.inline.end).split('\\' + quote).join(quote!) : text;
        templates++;
        const result = this.tagger.tagTemplate(html, {
          owner: config.owner,
          relFile: this.relativePath(consumerRoot, t.file),
          ...identity(t.c),
          isScreen: index.routedComponents.has(t.c.key),
          catalog,
          selectionMethods: numericSelectionMethods(t.c, index.components),
          usedIds,
          claimedIds,
          attrQuote: t.inline?.quote === '"' ? "'" : '"',
          lineOffset: t.inline?.line ?? 1,
          mode: config.mode,
        });
        // componente raiz (casca do app) aparece em todas as telas
        const resolved = screensOf(t.c);
        const telas = resolved.length === 0 && t.c.def.selectors.includes(config.root) ? ['*'] : resolved;
        entries.push(...result.entries.map((e) => ({ ...e, telas: e.evento === 'screen_view' ? [`${e.funcionalidade}:${e.tela}`] : telas })));
        diagnostics.push(...result.diagnostics);
        if (result.html !== html) {
          const body = t.inline ? result.html.split(quote!).join('\\' + quote) : result.html;
          current.set(t.file, t.inline ? text.slice(0, t.inline.start) + body + text.slice(t.inline.end) : body);
        }
      }
      for (const [file, before] of original) {
        const after = current.get(file)!;
        if (after !== before) changes.push({ file, before, after });
      }
    }

    const relatorio = JSON.stringify({ entries, diagnostics }, null, 2) + '\n';
    return { config, paths, changes, entries, diagnostics, relatorio, templates };
  }

/** Fingerprint de todas as entradas: config, motor e cada .ts/.html das raízes varridas */
  inputFingerprint(consumerRoot: string, configFile: string): string {
    const config = this.configReader.readTrackingConfigStatically(configFile);
    const hash = createHash('sha256').update(ENGINE_VERSION).update(this.fileSystem.exists(configFile) ? this.fileSystem.readBytes(configFile) : new Uint8Array());
    // versões de bibliotecas de componentes mudam o mapeamento de saídas
    const lock = path.join(consumerRoot, 'package-lock.json');
    if (this.fileSystem.exists(lock)) hash.update(this.fileSystem.readBytes(lock));
    const workspace = this.configReader.readAngularWorkspace(consumerRoot);
    for (const project of config?.projects ?? []) {
      const ws = workspace?.projects.get(project.angularProject);
      const scanRoot = this.scanRootFor(consumerRoot, project.tsconfig, ws?.sourceRoot);
      const walk = (dir: string): void => {
        for (const e of [...this.fileSystem.readDirectory(dir)].sort((a, b) => a.name.localeCompare(b.name))) {
          const full = path.join(dir, e.name);
          if (e.directory) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(full); }
          else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) hash.update(path.relative(consumerRoot, full).split(path.sep).join('/')).update(this.fileSystem.readBytes(full));
        }
      };
      walk(scanRoot);
    }
    return hash.digest('hex');
  }

  summarize(r: PipelineResult): Record<string, number> {
    return {
      templates: r.templates,
      interacoes: r.entries.filter((e) => e.evento === 'click').length,
      // módulos como na planilha: módulo de cada tela onde há interação, mais os componentes globais
      modulos: new Set(r.entries.flatMap((e) => e.telas.filter((t) => t !== '*').map((t) => t.split(':')[0]!))).size,
      telas: r.entries.filter((e) => e.evento === 'screen_view').length,
      diagnosticos: r.diagnostics.length,
    };
  }

}

/** Utilitário público do módulo de aplicação; toda execução de pipeline recebe dependências explícitas. */
export const screenIdentity = (scanRoot: string, template: string, refine: 0 | 1 | 2 | 3 = 0) =>
  new ScreenIdentityResolver().resolve(scanRoot, template, refine);

// T15–T26 — pipeline único usado por apply e verify: config estática → índice AST → marcações → relatório
import { createHash } from 'node:crypto';
import * as path from 'path';
import { TemplateTagger, type TagDiagnostic, type TagEntry } from './tagger.js';
import { listItemFields, numericSelectionMethods, staticListLabels } from './selection-provenance.js';
import { ComponentScreenResolver } from './component-screen-resolver.js';
import type { ComponentInfo, OverlaySite, ProjectIndex } from './ports/project-index.js';
import { ScreenIdentityResolver } from './screen-identity-resolver.js';
import { ENGINE_VERSION } from './constants.js';
import { overlayGestures, overlayHeading } from './overlay-gestures.js';
import { tagSurface, untagSurface } from './surface-tagger.js';
import { resolveProductionUsage } from './production-usage.js';
import { firedEvents } from './fired-events.js';
import { SCREEN_IDENTITY_REFINEMENT_LEVELS } from './screen-identity.config.js';
import { decodeOutputBindings } from '../../domain/contract/output-bindings.js';
import { decodeTrackingToken } from '../../domain/contract/tracking-token.js';
import { labelSlug, overlayActionLabel, overlayComponentName, slug } from '../../domain/contract/slug.js';
import { ORIGIN_SCREEN, isStaticScreenReference } from '../../domain/contract/screen-binding.js';
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
    /** Cliques de overlay sem template no projeto: não há onde gravar token, o contrato é o do runtime. */
    const runtimeContract = new Set<string>();
    let templates = 0;
    const claimedIds = new Set<string>();

    for (const project of config.projects) {
      const ws = workspace?.projects.get(project.angularProject);
      if (!ws) throw new PipelineError(`projeto '${project.angularProject}' não existe no angular.json`);
      const scanRoot = this.scanRootFor(consumerRoot, project.tsconfig, ws.sourceRoot);
      const original = new Map<string, string>();
      const current = new Map<string, string>();
      let index: ProjectIndex = this.projectIndexer.buildProjectIndex(scanRoot);
      for (const file of index.trackingFiles ?? []) {
        const source = this.fileSystem.readText(file);
        const reconciled = this.projectIndexer.reconcileTrackingSource?.(source, file) ?? source;
        if (reconciled !== source) { original.set(file, source); current.set(file, reconciled); }
      }
      if (current.size) index = this.projectIndexer.buildProjectIndex(scanRoot, current);
      const usage = resolveProductionUsage(index, config.root);
      diagnostics.push(...usage.diagnostics.map((diagnostic) => ({ ...diagnostic, arquivo: this.relativePath(consumerRoot, diagnostic.arquivo) })));
      for (const error of index.surfaceErrors ?? []) diagnostics.push({ code: 'SURFACE_DECLARATION_UNPROVEN',
        arquivo: this.relativePath(consumerRoot, error.file), linha: error.line, mensagem: error.message });
      for (const route of index.ambiguousRoutes) {
        diagnostics.push({
          code: 'ROUTED_COMPONENT_AMBIGUOUS',
          arquivo: this.relativePath(consumerRoot, route.file),
          linha: route.line,
          mensagem: `a rota '${route.className}' corresponde a mais de um componente; importe a declaração correta para marcar a tela com segurança`,
        });
      }
      const catalog = this.componentCatalogBuilder.buildCatalog(consumerRoot, index.components.map((c) => c.def),
        (index.overlaySites ?? []).flatMap((site) => [site, ...(site.variantes ?? [])].flatMap((item) => item.componente ?? [])));
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
      const screensOf = this.componentScreenResolver.resolve(index, identity, usage.methods);
      if (index.providerCalls === 0) {
        diagnostics.push({ code: 'BOOTSTRAP_PROVIDER_MISSING', arquivo: this.relativePath(consumerRoot, scanRoot), linha: 1, mensagem: 'nenhum provideAutoTracking(<config>.runtime) no bootstrap: marcações não emitem em runtime' });
      }

      // um alvo por template: arquivo .html inteiro ou o literal inline dentro do .ts
      const targets = index.components
        .map((c) => {
          if (c.templateFile && this.fileSystem.exists(c.templateFile)) return { c, file: c.templateFile, inline: null };
          if (c.inline) return { c, file: c.tsFile, inline: c.inline };
          if (c.inlineTemplate && usage.components.has(c.key)) {
            diagnostics.push({ code: 'INLINE_TEMPLATE_INTERPOLATED', arquivo: this.relativePath(consumerRoot, c.tsFile), linha: 1, mensagem: `${c.className} monta o template com \${}; não editável com segurança` });
          }
          return null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
        // por arquivo, do fim para o início: editar um literal não desloca os anteriores
        .sort((a, b) => a.file.localeCompare(b.file) || (b.inline?.start ?? 0) - (a.inline?.start ?? 0));

      for (const t of targets) if (!original.has(t.file)) original.set(t.file, this.fileSystem.readText(t.file));
      for (const [f, text] of original) if (!current.has(f)) current.set(f, text);

      // ids existentes são reservados antes de gerar novos, para que a ordem de arquivos não troque ids
      const usedIds = new Set<string>(claimedIds);
      // Superfícies têm IDs públicos determinísticos; um HTML novo não pode tomá-los.
      for (const surface of index.surfaces ?? []) {
        if (!usage.surfaces.has(surface.componentKey)) continue;
        for (const action of surface.definition.actions) usedIds.add(`${slug(surface.definition.id)}-${slug(action.id)}`);
      }
      for (const text of original.values()) for (const m of text.matchAll(/data-at-(?:id|screen)=["']([^"']+)["']/g)) usedIds.add(m[1]!);
      for (const text of original.values()) {
        for (const match of text.matchAll(/data-at-(?:overlay-)?outputs=["']([^"']+)["']/g)) {
          for (const output of decodeOutputBindings(match[1])) usedIds.add(output.id);
        }
        // Reservar também IDs de tokens declarados em bindings dinâmicos:
        // esses IDs já publicados não podem ser tomados por outros elementos.
        const references = [
          ...[...text.matchAll(/data-at-ref=["']([^"']+)["']/g)].map((match) => match[1]!),
          ...[...text.matchAll(/\[attr\.data-at-ref\]\s*=\s*(["'])([\s\S]*?)\1/g)]
            .flatMap((match) => [...match[2]!.matchAll(/['"](v1\.[A-Za-z0-9_-]+)['"]/g)].map((value) => value[1]!)),
        ];
        for (const reference of references) {
          const element = decodeTrackingToken(reference);
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
        const active = usage.components.has(t.c.key);
        if (active) templates++;
        const result = active ? this.tagger.tagTemplate(html, {
          owner: config.owner,
          relFile: this.relativePath(consumerRoot, t.file),
          ...identity(t.c),
          isScreen: index.routedComponents.has(t.c.key),
          catalog,
          selectionMethods: numericSelectionMethods(t.c, index.components),
          listLabels: staticListLabels(t.c),
          displayTexts: (expression) => index.displayTexts?.(t.c.key, expression) ?? null,
          listItemFields: listItemFields(t.c),
          usedIds,
          claimedIds,
          attrQuote: t.inline?.quote === '"' ? "'" : '"',
          lineOffset: t.inline?.line ?? 1,
          mode: config.mode,
          ...(index.overlayComponents?.has(t.c.key) && !index.routedComponents.has(t.c.key) ? { overlay: {
            elemento: index.overlayComponents.get(t.c.key)!, nome: overlayComponentName(t.c.def.selectors[0] ?? t.c.className) } } : {}),
        }) : { html: this.tagger.untagTemplate(html), entries: [], diagnostics: [] };
        // componente raiz (casca do app) aparece em todas as telas
        const resolved = screensOf(t.c);
        const telas = resolved.length ? resolved : [t.c.def.selectors.includes(config.root) ? '*' : ORIGIN_SCREEN];
        entries.push(...result.entries.filter((e) => e.evento !== 'screen_view' || !index.shellComponents?.has(t.c.key)).map((e) => ({ ...e,
          telas: e.evento === 'screen_view' ? [`${e.funcionalidade}:${e.tela}`] : telas,
          vinculo_tela: e.evento === 'screen_view' || index.routedComponents.has(t.c.key) ? 'rota' as const : 'origem' as const,
        })));
        diagnostics.push(...result.diagnostics);
        if (result.html !== html) {
          const body = t.inline ? result.html.split(quote!).join('\\' + quote) : result.html;
          current.set(t.file, t.inline ? text.slice(0, t.inline.start) + body + text.slice(t.inline.end) : body);
        }
      }
      for (const site of index.overlaySites ?? []) {
        if (!usage.components.has(site.componentKey)) continue;
        const component = index.components.find((item) => item.key === site.componentKey)!;
        const resolved = screensOf(component);
        const name = slug(component.className.replace(/([a-z0-9])([A-Z])/g, '$1-$2'), 120);
        const uniqueId = (base: string): string => {
          let id = base;
          for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
          usedIds.add(id);
          return id;
        };
        // Cada chamada comprova título e botões nas telas de onde parte; só o que nenhuma chamada cobre fica como a abertura declara.
        const variants = (site.variantes ?? []).filter((variant) => usage.methods.get(variant.ownerKey)?.has(variant.method)).map((variant) => {
          const owner = index.components.find((item) => item.key === variant.ownerKey);
          return { declaration: { ...site, ...variant }, telas: owner ? screensOf(owner).filter((screen) => resolved.includes(screen)) : [] };
        }).filter((variant) => variant.telas.length);
        const covered = new Set(variants.flatMap((variant) => variant.telas));
        const remaining = resolved.filter((screen) => !covered.has(screen));
        const groups: { declaration: OverlaySite; telas: string[] }[] = [...variants];
        if (!variants.length) groups.push({ declaration: site, telas: resolved.length ? resolved : [ORIGIN_SCREEN] });
        else if (remaining.length) groups.push({ declaration: site, telas: remaining });

        const rows = new Map<string, { evento: 'visualizacao' | 'click'; rotulo: string; telas: Set<string> }>();
        const addRow = (evento: 'visualizacao' | 'click', rotulo: string, telas: readonly string[]): void => {
          const row = rows.get(`${evento}\0${rotulo}`) ?? { evento, rotulo, telas: new Set<string>() };
          for (const screen of telas) row.telas.add(screen);
          rows.set(`${evento}\0${rotulo}`, row);
        };
        for (const { declaration, telas } of groups) {
          const presented = declaration.componente ? catalog.ofClass?.(declaration.componente) : undefined;
          // Mesma ordem do runtime: título declarado, cabeçalho do componente e, só na visualização, o nome do componente.
          const heading = declaration.titulo ?? (declaration.semTitulo ? overlayHeading(presented) : null);
          const placeholder = `[titulo-do-${site.elemento}-exibido]`;
          addRow('visualizacao', heading ? labelSlug(heading) : (heading === undefined && overlayComponentName(presented?.selectors[0] ?? '')) || placeholder, telas);
          // O que só existe em runtime aparece como marcador, nunca some.
          const context = heading ? labelSlug(heading) : heading === undefined ? site.elemento : placeholder;
          for (const text of overlayGestures(declaration, presented)) {
            const action = text === null ? '' : labelSlug(text);
            addRow('click', action && !context.startsWith('[') ? overlayActionLabel(action, context)
              : `${action ? overlayActionLabel(action, '') : '[rotulo-do-botao-exibido]'}-${context}`, telas);
          }
        }
        const many = [...rows.values()].filter((row) => row.evento === 'visualizacao').length > 1;
        for (const row of [...rows.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo))) {
          const entry = { owner: config.owner, elemento: site.elemento, origem: site.origem, ...identity(component), telas: [...row.telas].sort(),
            vinculo_tela: 'origem' as const, arquivo: this.relativePath(consumerRoot, site.file), linha: site.line };
          if (row.evento === 'visualizacao') {
            entries.push({ ...entry, id: uniqueId(`${name}-visualizacao${many ? `-${slug(row.rotulo)}` : ''}`), evento: 'visualizacao', acao: 'visualizacao', rotulo: row.rotulo });
            continue;
          }
          const id = uniqueId(`${name}-clique-${slug(row.rotulo)}`);
          runtimeContract.add(id);
          entries.push({ ...entry, id, evento: 'click', acao: 'clique', rotulo: row.rotulo });
        }
      }
      for (const surface of index.surfaces ?? []) {
        if (!original.has(surface.file)) {
          const source = this.fileSystem.readText(surface.file);
          original.set(surface.file, source);
          current.set(surface.file, source);
        }
        if (!usage.surfaces.has(surface.componentKey)) {
          current.set(surface.file, current.get(surface.file)!.split(surface.text).join(untagSurface(surface)));
          continue;
        }
        try {
          const component = index.components.find((component) => component.key === surface.componentKey)!;
          const resolved = screensOf(component);
          const tagged = tagSurface(surface, config.owner, identity(component), resolved.length ? resolved : [ORIGIN_SCREEN],
            this.relativePath(consumerRoot, surface.file), claimedIds);
          const source = current.get(surface.file)!;
          const offset = source.indexOf(surface.text);
          if (offset < 0 || source.indexOf(surface.text, offset + surface.text.length) >= 0) throw new Error('declaração sem localização única');
          current.set(surface.file, source.slice(0, offset) + tagged.text + source.slice(offset + surface.text.length));
          entries.push(...tagged.entries.map((entry) => ({ ...entry, vinculo_tela: 'origem' as const })));
        } catch (error) {
          diagnostics.push({ code: 'SURFACE_DECLARATION_UNPROVEN', arquivo: this.relativePath(consumerRoot, surface.file),
            linha: surface.line, mensagem: String(error) });
        }
      }
      for (const [file, before] of original) {
        const after = current.get(file)!;
        if (after !== before) changes.push({ file, before, after });
      }
    }

    for (const entry of entries) {
      const validReferences = entry.telas.length && entry.telas.every((screen) =>
        screen === '*' || screen === ORIGIN_SCREEN || isStaticScreenReference(screen));
      const requiresOrigin = entry.vinculo_tela === 'origem';
      const validContract = config.mode !== 'ref' || !requiresOrigin || (entry.evento === 'visualizacao' && !entry.ref) || runtimeContract.has(entry.id)
        || (entry.ref && decodeTrackingToken(entry.ref)?.requireOrigin === true);
      if (!validReferences || !entry.vinculo_tela || !validContract) diagnostics.push({
        code: 'TRACKING_SCREEN_BINDING_MISSING', arquivo: entry.arquivo, linha: entry.linha,
        mensagem: `interação '${entry.id}' sem contrato de vínculo com a tela de origem`,
      });
    }
    // O relatório diz onde está no código e o que dispara: parâmetro do evento só existe em `eventos`, sem segunda versão.
    const relatorio = JSON.stringify({ entries: entries.map((entry) => ({
      id: entry.id, owner: entry.owner, evento: entry.evento, origem: entry.origem, arquivo: entry.arquivo, linha: entry.linha, telas: entry.telas,
      ...(entry.vinculo_tela ? { vinculo_tela: entry.vinculo_tela } : {}), ...(entry.tab_bar ? { tab_bar: entry.tab_bar } : {}), ...(entry.ref ? { ref: entry.ref } : {}),
      eventos: firedEvents(entry, config.product).map((fired) => fired.params) })), diagnostics }, null, 2) + '\n';
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
      modulos: new Set(r.entries.flatMap((e) => e.telas.filter(isStaticScreenReference).map((t) => t.split(':')[0]!))).size,
      telas: r.entries.filter((e) => e.evento === 'screen_view').length,
      diagnosticos: r.diagnostics.length,
    };
  }

}

/** Utilitário público do módulo de aplicação; toda execução de pipeline recebe dependências explícitas. */
export const screenIdentity = (scanRoot: string, template: string, refine: 0 | 1 | 2 | 3 = 0) =>
  new ScreenIdentityResolver().resolve(scanRoot, template, refine);

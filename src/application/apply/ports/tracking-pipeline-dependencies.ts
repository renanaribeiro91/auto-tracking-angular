import type { ComponentCatalog, ComponentDef } from './component-catalog.js';
import type { ProjectIndex } from './project-index.js';
import type { OutputPathResolverPort } from './output-paths.js';
import type { WorkspaceFileSystem } from './workspace-file-system.js';
import type { TrackingProjectConfigReader } from './tracking-project-config.js';

export interface TrackingProjectIndexer {
  reconcileTrackingSource?(source: string, file: string): string;
  buildProjectIndex(scanRoot: string, sources?: ReadonlyMap<string, string>): ProjectIndex;
}

export interface TrackingComponentCatalogBuilder {
  buildCatalog(consumerRoot: string, definitions: readonly ComponentDef[], overlayClasses?: readonly string[]): ComponentCatalog;
}

export interface TrackingPipelineDependencies {
  readonly configReader: TrackingProjectConfigReader;
  readonly projectIndexer: TrackingProjectIndexer;
  readonly componentCatalogBuilder: TrackingComponentCatalogBuilder;
  readonly outputPathResolver: OutputPathResolverPort;
  readonly fileSystem: WorkspaceFileSystem;
}

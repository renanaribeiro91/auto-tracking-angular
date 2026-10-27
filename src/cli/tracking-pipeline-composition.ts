import { AngularProjectConfigReader } from '../adapters/angular-compiler/angular-index.js';
import { AngularProjectIndexer } from '../adapters/angular-compiler/project-index.js';
import { AngularComponentCatalogBuilder } from '../adapters/angular-compiler/component-catalog.js';
import { OutputPathResolver } from '../adapters/filesystem/project-config.js';
import { NodeWorkspaceFileSystem } from '../adapters/filesystem/node-workspace-file-system.js';
import { TrackingPipeline } from '../application/apply/pipeline.js';

/** Raiz de composição CLI: conecta portas da aplicação aos adapters de produção. */
export class TrackingPipelineFactory {
  create(): TrackingPipeline {
    return new TrackingPipeline({
      configReader: new AngularProjectConfigReader(),
      projectIndexer: new AngularProjectIndexer(),
      componentCatalogBuilder: new AngularComponentCatalogBuilder(),
      outputPathResolver: new OutputPathResolver(),
      fileSystem: new NodeWorkspaceFileSystem(),
    });
  }
}

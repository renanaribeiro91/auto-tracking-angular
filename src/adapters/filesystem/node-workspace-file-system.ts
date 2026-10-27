import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { WorkspaceEntry, WorkspaceFileSystem } from '../../application/apply/ports/workspace-file-system.js';

/** Adapta o filesystem do Node ao contrato usado pelo caso de uso de aplicação. */
export class NodeWorkspaceFileSystem implements WorkspaceFileSystem {
  exists(file: string): boolean {
    return existsSync(file);
  }

  readText(file: string): string {
    return readFileSync(file, 'utf-8');
  }

  readBytes(file: string): Uint8Array {
    return readFileSync(file);
  }

  readDirectory(directory: string): readonly WorkspaceEntry[] {
    return readdirSync(directory, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  }
}

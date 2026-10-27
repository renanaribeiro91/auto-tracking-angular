import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve a raiz da biblioteca a partir da localização do script de release. */
export function releaseRoot(scriptUrl) {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), '..');
}

// T15 (filesystem) — carrega/valida config e paths; resolve output canônico

import * as fs from 'fs';
import * as path from 'path';
import { FORBIDDEN_OUTPUT_DIRECTORIES } from './project-config.constants.js';
import type { ResolvedPaths } from '../../application/apply/ports/output-paths.js';
export type { ResolvedPaths } from '../../application/apply/ports/output-paths.js';

/** Resolve caminhos de saída do CLI e impede gravações fora da raiz permitida. */
export class OutputPathResolver {
  resolve(consumerRoot: string, outputConfig: string | undefined): ResolvedPaths | null {
    const outputRelative = outputConfig ?? '.auto-tracking';
    const root = fs.realpathSync(consumerRoot);
    const outputDir = path.resolve(consumerRoot, outputRelative);
    const canonicalCandidate = path.resolve(root, outputRelative);

    if (outputRelative.split(/[\\/]/).includes('..')) return null;
    const relativePath = path.relative(root, canonicalCandidate);
    if (!this.isInside(root, canonicalCandidate) || this.containsSymlink(root, relativePath)) return null;

    const canonicalOutput = this.resolveFuturePath(canonicalCandidate);
    if (!canonicalOutput || !this.isInside(root, canonicalOutput)) return null;

    const firstSegment = path.relative(root, canonicalOutput).split(path.sep)[0];
    if (FORBIDDEN_OUTPUT_DIRECTORIES.has(firstSegment ?? '')) return null;

    return {
      configFile: path.join(consumerRoot, 'auto-tracking.config.ts'),
      outputDir,
      excelFile: path.join(outputDir, 'evidencia-tagueamento.xlsx'),
      relatorioFile: path.join(outputDir, 'relatorio.json'),
      cacheDir: path.join(outputDir, 'cache'),
    };
  }

  private isInside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  private containsSymlink(root: string, relativePath: string): boolean {
    let current = root;
    for (const segment of relativePath.split(path.sep)) {
      current = path.join(current, segment);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    return false;
  }

  /** Canonicaliza o caminho existente mais próximo e mantém a parte ainda não criada. */
  private resolveFuturePath(target: string): string | null {
    let existing = target;
    const missing: string[] = [];
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
    return path.resolve(fs.realpathSync(existing), ...missing);
  }
}

const outputPathResolver = new OutputPathResolver();
export const resolveOutputPaths = (consumerRoot: string, outputConfig: string | undefined): ResolvedPaths | null =>
  outputPathResolver.resolve(consumerRoot, outputConfig);

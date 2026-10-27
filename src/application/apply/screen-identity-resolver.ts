import * as fs from 'fs';
import * as path from 'path';
import { slug } from '../../domain/contract/slug.js';
import { GENERIC_SCREEN_DIRECTORIES, SCREEN_CONTAINERS } from './screen-identity.config.js';

export interface ScreenIdentity {
  readonly funcionalidade: string;
  readonly tela: string;
}

/** Resolve módulo e tela a partir da estrutura de pastas e do arquivo de template. */
export class ScreenIdentityResolver {
  resolve(scanRoot: string, template: string, refine: 0 | 1 | 2 | 3 = 0, discriminator = '', routed = false): ScreenIdentity {
    const fileName = slug(path.basename(template).replace(/\.(html|ts)$/, '').replace(/\.(page|component|modal|container|dialog|popover)$/, ''));
    const folderName = slug(path.basename(path.dirname(template)));
    const relativeFile = path.relative(scanRoot, template).split(path.sep).filter(Boolean);
    const tela = refine === 3
      ? slug([...relativeFile.map((part) => part.replace(/\.(page|component|modal|container|dialog|popover)?\.(html|ts)$/, '')), discriminator].filter(Boolean).join('-'))
      : refine === 2 && !GENERIC_SCREEN_DIRECTORIES.has(folderName) ? folderName : fileName;
    const telaDir = path.dirname(template);
    const parts = path.relative(scanRoot, telaDir).split(path.sep).filter(Boolean);
    const container = parts.findIndex((part) => SCREEN_CONTAINERS.has(part));
    const floor = path.join(scanRoot, ...parts.slice(0, container + 1));

    // O primeiro nível preserva a funcionalidade da rota/módulo. Somente
    // colisões reais permitem refinar a identidade para níveis mais específicos.
    if (refine === 0) {
      const moduleWithCommon = this.moduleWithCommonDirectory(telaDir, floor);
      if (moduleWithCommon) return { funcionalidade: slug(moduleWithCommon), tela };
      if (routed) {
        const namedRouting = this.namedRoutingBoundary(telaDir, floor);
        if (namedRouting) return { funcionalidade: slug(namedRouting), tela };
      }
    }

    const telaFolder = parts[parts.length - 1];
    const parent = [...parts.slice(0, -1)].reverse().find((part) => !GENERIC_SCREEN_DIRECTORIES.has(part.toLowerCase()));
    const modulo = parent && parts.indexOf(parent) > container ? parent : telaFolder && !GENERIC_SCREEN_DIRECTORIES.has(telaFolder.toLowerCase()) ? telaFolder : tela;
    return { funcionalidade: slug(modulo), tela };
  }

  private moduleWithCommonDirectory(telaDir: string, floor: string): string | null {
    for (let directory = path.dirname(telaDir); directory.length > floor.length && directory.startsWith(floor); directory = path.dirname(directory)) {
      if (GENERIC_SCREEN_DIRECTORIES.has(path.basename(directory).toLowerCase())) continue;
      if (this.hasCommonDirectory(directory, 'constants') || this.hasCommonDirectory(directory, 'enums')) return path.basename(directory);
    }
    return null;
  }

  /** Sem diretórios de contrato, usa evidência de módulo Angular roteado,
   *  nunca estruturas vazias criadas por ferramentas locais. */
  private namedRoutingBoundary(telaDir: string, floor: string): string | null {
    for (let directory = path.dirname(telaDir); directory.length > floor.length && directory.startsWith(floor); directory = path.dirname(directory)) {
      const name = path.basename(directory);
      // Comum em módulos lazy: arquivo de rotas e NgModule correspondentes.
      if (fs.existsSync(path.join(directory, `${name}.routing.ts`))
        && fs.existsSync(path.join(directory, `${name}.module.ts`))) return name;
    }
    const relative = path.relative(floor, telaDir).split(path.sep);
    const first = relative[0];
    if (path.basename(floor) === 'modules' && first
      && fs.existsSync(path.join(floor, first, `${first}.module.ts`))) return first;
    return null;
  }

  private hasCommonDirectory(directory: string, name: 'constants' | 'enums'): boolean {
    const commonPath = path.join(directory, 'common', name);
    // A presença da pasta não é evidência de código: ferramentas podem criar
    // diretórios vazios/ignorados em qualquer máquina sem mudar o aplicativo.
    // Apenas arquivos-fonte diretos (incluídos no inventário TS) justificam
    // usar esta fronteira para determinar a funcionalidade da tela.
    try {
      return fs.readdirSync(commonPath, { withFileTypes: true }).some((entry) =>
        entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)
        && !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name)
        && !entry.name.endsWith('.d.ts'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

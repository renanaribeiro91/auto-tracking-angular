// Integração com hooks git nativos: a lib é a única dona da lógica; o hook do
// consumidor só chama o CLI. Funciona com .git/hooks, core.hooksPath e Husky.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type GitHookName = 'pre-commit' | 'pre-push';
export const GIT_HOOK_NAMES: readonly GitHookName[] = ['pre-commit', 'pre-push'];

const BLOCK_START = '# >>> auto-tracking';
const BLOCK_END = '# <<< auto-tracking';
/** Script da lib que o bloco chama: o shell o executa mesmo sem Node no PATH. */
const HOOK_SCRIPT = 'node_modules/auto-tracking-angular/hooks/hook.sh';
const TRACKING_INPUT_PATTERN = /\.(?:html|ts)$|(?:^|\/)(?:angular\.json|package\.json|tsconfig[^/]*\.json)$/;

/** SHA nulo do protocolo do pre-push: ref removida, nada a verificar. */
const DELETED_REF = /^0+$/;

/**
 * Bloco do hook no app: só chama `hooks/hook.sh` da lib instalada, que acha o Node e roda `auto-tracking hook`; toda a
 * lógica (inclusive conferir a versão instalada contra o package.json) fica na lib. Lib anterior ao `hook.sh` é mais velha
 * que o bloco: pede `npm install`. `project` é o caminho do app relativo à raiz git ('' quando coincidem), para monorepos.
 */
export function hookBlock(hook: GitHookName, project = ''): string {
  const projectPath = project ? `/${project.split(path.sep).join('/')}` : '';
  return [
    `${BLOCK_START} (gerado por \`auto-tracking hooks install\`; não editar dentro do bloco)`,
    `auto_tracking_projeto="$(git rev-parse --show-toplevel)${projectPath}"`,
    `[ -f "$auto_tracking_projeto/${HOOK_SCRIPT}" ] || { echo "[auto-tracking] biblioteca ausente ou desatualizada: execute npm install." >&2; exit 1; }`,
    `sh "$auto_tracking_projeto/${HOOK_SCRIPT}" ${hook} "$auto_tracking_projeto" || exit 1`,
    BLOCK_END,
  ].join('\n');
}

/**
 * Insere ou atualiza o bloco sem alterar o restante do hook. O bloco vai logo
 * após o shebang (e a linha `husky.sh`, se houver) para rodar antes de qualquer
 * `exit` do conteúdo existente.
 */
export function upsertHookBlock(existing: string | null, hook: GitHookName, project = ''): string {
  const block = hookBlock(hook, project);
  if (existing === null || existing.trim() === '') return `#!/bin/sh\n${block}\n`;
  // sh (inclusive Git Bash no Windows) não executa linhas com \r: hook sempre LF.
  existing = existing.replace(/\r\n/g, '\n');
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start >= 0 && end > start) return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
  const lines = existing.split('\n');
  let insertAt = lines[0]?.startsWith('#!') ? 1 : 0;
  // Husky 4–8 carrega husky.sh no início; o bloco vem depois dele.
  const huskyLine = lines.findIndex((line, index) => index < 4 && line.includes('husky.sh'));
  if (huskyLine >= insertAt) insertAt = huskyLine + 1;
  lines.splice(insertAt, 0, block);
  return lines.join('\n');
}

/** O que cada hook faz, exibido por `auto-tracking hooks status`. */
export const GIT_HOOK_PURPOSE: Readonly<Record<GitHookName, string>> = {
  'pre-commit': 'atualiza o tagueamento do projeto inteiro e inclui no commit as fontes alteradas; evidências e cache ficam locais',
  'pre-push': 'verifica o tagueamento exatamente dos commits enviados; alterações locais fora deles não bloqueiam',
};

/** Commits locais enviados, lidos da entrada padrão do pre-push (`<ref> <sha> <ref remota> <sha remoto>`). */
export function pushedCommits(input: string): string[] {
  return [...new Set(input.split('\n').map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter((sha) => /^[0-9a-f]{7,64}$/i.test(sha) && !DELETED_REF.test(sha)))];
}

export type HookState = 'instalado' | 'desatualizado' | 'ausente';

export class GitRepository {
  constructor(readonly root: string) {}

  static at(directory: string): GitRepository {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf-8' }).trim();
    return new GitRepository(root);
  }

  private git(args: readonly string[]): string {
    return execFileSync('git', args as string[], { cwd: this.root, encoding: 'utf-8' });
  }

  /** Diretório efetivo de hooks (respeita core.hooksPath). */
  hooksDir(): string {
    return path.resolve(this.root, this.git(['rev-parse', '--git-path', 'hooks']).trim());
  }

  /** Arquivos com alterações no working tree ainda não preparadas para commit. */
  unstagedFiles(): Set<string> {
    return new Set(this.git(['diff', '--name-only', '-z']).split('\0').filter(Boolean));
  }

  untrackedFiles(): Set<string> {
    return new Set(this.git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  }

  /** Fontes e configurações do projeto cujo conteúdo no disco difere do commit atual. */
  uncommittedTrackingInputs(projectRoot: string): string[] {
    const tracked = this.git(['diff', '--no-renames', '--name-only', '-z', 'HEAD']).split('\0');
    return this.trackingInputs(projectRoot, [...tracked, ...this.untrackedFiles()]);
  }

  /** Arquivos que entram na derivação do tagueamento do projeto (fontes, templates e configurações). */
  trackingInputs(projectRoot: string, files: Iterable<string>): string[] {
    const project = this.relative(projectRoot);
    return [...new Set(files)].filter((file) => TRACKING_INPUT_PATTERN.test(file) && (!project || file.startsWith(`${project}/`)));
  }

  head(): string {
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  /**
   * Executa `run` sobre uma cópia limpa do commit (worktree temporário): o disco local,
   * com arquivos staged ou não, nunca entra na verificação do que é enviado.
   */
  async atCommit<T>(sha: string, projectRoot: string, run: (projectRoot: string) => Promise<T>): Promise<T> {
    return this.inCopy(projectRoot, (checkout) => this.git(['worktree', 'add', '--detach', '--quiet', checkout, sha]), run, (checkout) => {
      try { this.git(['worktree', 'remove', '--force', checkout]); } catch { /* a pasta é removida em seguida; prune limpa o registro */ }
      try { this.git(['worktree', 'prune']); } catch { /* registro órfão não afeta o push */ }
    });
  }

  /** Executa `run` sobre uma cópia exata do índice: o conteúdo que o commit vai gravar. */
  async atIndex<T>(projectRoot: string, run: (projectRoot: string) => Promise<T>): Promise<T> {
    return this.inCopy(projectRoot, (checkout) => this.git(['checkout-index', '--all', '--force', `--prefix=${checkout.split(path.sep).join('/')}/`]), run);
  }

  /** Grava `content` no índice para `file`, mantendo o modo; o working tree não é tocado. */
  stageContent(file: string, content: Buffer): void {
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: this.root, input: content, encoding: 'utf-8' }).trim();
    const mode = /^(\d{6})\s/.exec(this.git(['ls-files', '--stage', '--', file]))?.[1] ?? '100644';
    this.git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${file}`]);
  }

  /** Cópia temporária do repositório com as dependências instaladas do projeto (por link). */
  private async inCopy<T>(projectRoot: string, fill: (checkout: string) => void, run: (projectRoot: string) => Promise<T>,
    release: (checkout: string) => void = () => {}): Promise<T> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-tracking-'));
    const checkout = path.join(directory, 'copia');
    try {
      fill(checkout);
      for (const base of new Set([this.root, projectRoot])) {
        const modules = path.join(base, 'node_modules');
        const link = path.join(checkout, path.relative(this.root, base), 'node_modules');
        if (fs.existsSync(modules) && !fs.existsSync(link)) fs.symlinkSync(modules, link, 'junction');
      }
      return await run(path.join(checkout, path.relative(this.root, projectRoot)));
    } finally {
      release(checkout);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  /** Caminho relativo à raiz git, no formato que o próprio git reporta. */
  relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/');
  }

  /** Remove caminhos que o projeto ignora: `git add` explícito os recusaria. */
  trackable(files: readonly string[]): string[] {
    if (files.length === 0) return [];
    let ignored = '';
    try {
      ignored = execFileSync('git', ['check-ignore', '-z', '--stdin'], { cwd: this.root, encoding: 'utf-8', input: files.join('\0') });
    } catch (error) {
      // Status 1 = nenhum caminho ignorado; qualquer outro é falha real.
      if ((error as { status?: number }).status !== 1) throw error;
    }
    const skip = new Set(ignored.split('\0').filter(Boolean));
    return files.filter((file) => !skip.has(file));
  }

  stage(files: readonly string[]): void {
    if (files.length) this.git(['add', '--', ...files]);
  }

  /** Arquivos sob `directory` com diferença em relação ao HEAD (preparados ou não). */
  uncommitted(directory: string): string[] {
    return this.git(['status', '--porcelain', '-z', '--', this.relative(directory) || '.']).split('\0').filter(Boolean);
  }

  installHooks(projectRoot: string): string[] {
    const project = path.relative(this.root, projectRoot);
    if (project.startsWith('..') || path.isAbsolute(project)) throw new Error(`projeto fora do repositório git: ${projectRoot}`);
    const directory = this.hooksDir();
    // core.hooksPath global vale para todos os repositórios da máquina: o bloco bloquearia commits onde a lib não existe.
    if (!this.ownsHooksDir(directory)) {
      throw new Error(`o git usa hooks fora deste repositório (${directory}, core.hooksPath global): instalar ali afetaria todos os repositórios. `
        + 'Configure os hooks no projeto (ex.: npx husky install ou git config core.hooksPath .githooks) e repita.');
    }
    fs.mkdirSync(directory, { recursive: true });
    return GIT_HOOK_NAMES.map((hook) => {
      const file = path.join(directory, hook);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
      const next = upsertHookBlock(current, hook, project);
      if (next !== current) fs.writeFileSync(file, next, 'utf-8');
      fs.chmodSync(file, 0o755); // sem efeito no Windows; o Git Bash não exige o bit.
      return path.relative(this.root, file);
    }).concat(this.ensureLfAttributes(directory));
  }

  /** Diretório de hooks dentro do repositório (`.husky`, `.githooks`) ou do seu diretório git (`.git/hooks`, worktrees). */
  private ownsHooksDir(directory: string): boolean {
    const real = (target: string) => { try { return fs.realpathSync(target); } catch { return path.resolve(target); } };
    const gitDir = path.resolve(this.root, this.git(['rev-parse', '--git-common-dir']).trim());
    return [this.root, gitDir].some((base) => {
      const relative = path.relative(real(base), real(directory));
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  /** Estado de cada hook: bloco atual, bloco de outra versão ou não instalado. */
  hookStatus(projectRoot: string): { hooksDir: string; hooks: { hook: GitHookName; file: string; state: HookState }[] } {
    const project = path.relative(this.root, projectRoot);
    const directory = this.hooksDir();
    return {
      hooksDir: this.relative(directory) || '.',
      hooks: GIT_HOOK_NAMES.map((hook) => {
        const file = path.join(directory, hook);
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n') : null;
        const state: HookState = current === null || !current.includes(BLOCK_START) ? 'ausente'
          : current.includes(hookBlock(hook, project)) ? 'instalado' : 'desatualizado';
        return { hook, file: this.relative(file), state };
      }),
    };
  }

  /**
   * Hooks versionados (Husky, core.hooksPath no repositório) com autocrlf no
   * Windows chegariam com CRLF e o sh falharia. A regra garante LF no checkout.
   */
  private ensureLfAttributes(directory: string): string[] {
    const relative = this.relative(directory);
    if (relative.startsWith('..') || relative.startsWith('.git/') || relative === '.git' || path.isAbsolute(relative)) return [];
    const file = path.join(this.root, '.gitattributes');
    const rule = `${relative}/* text eol=lf`;
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    if (current.split(/\r?\n/).some((line) => line.trim() === rule)) return [];
    fs.writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${rule}\n`, 'utf-8');
    return ['.gitattributes'];
  }
}

/**
 * A lib instalada precisa atender à versão declarada no package.json do consumidor: outra versão
 * geraria ou leria um contrato diferente do da esteira (ex.: branch nova sem `npm install`).
 * Aceita `x.y.z`, `^x.y.z`, `~x.y.z` e `>=x.y.z`; outra forma de faixa não é conferida.
 */
export function installedVersionMismatch(root: string, packageName: string, installedVersion: string): string | null {
  let declared: string | undefined;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as Record<string, Record<string, string> | undefined>;
    declared = (manifest['dependencies']?.[packageName] ?? manifest['devDependencies']?.[packageName])?.trim();
  } catch {
    return null;
  }
  const range = declared ? /^(\^|~|>=)?v?(\d+)\.(\d+)\.(\d+)$/.exec(declared) : null;
  const installed = /^(\d+)\.(\d+)\.(\d+)$/.exec(installedVersion);
  if (!range || !installed) return null;
  const [major, minor, patch] = range.slice(2).map(Number) as [number, number, number];
  const [iMajor, iMinor, iPatch] = installed.slice(1).map(Number) as [number, number, number];
  const atLeast = iMajor - major || iMinor - minor || iPatch - patch;
  const satisfied = range[1] === '>=' ? atLeast >= 0
    : range[1] === '^' ? atLeast >= 0 && iMajor === major && (major > 0 || iMinor === minor)
      : range[1] === '~' ? atLeast >= 0 && iMajor === major && iMinor === minor
        : atLeast === 0;
  return satisfied ? null
    : `${packageName} instalado ${installedVersion}, mas o package.json pede ${declared}: execute npm install e repita o comando`;
}

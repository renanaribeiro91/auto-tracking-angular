// Integração com hooks git nativos: a lib é a única dona da lógica; o hook do
// consumidor só chama o CLI. Funciona com .git/hooks, core.hooksPath e Husky.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type GitHookName = 'pre-commit' | 'pre-push';
export const GIT_HOOK_NAMES: readonly GitHookName[] = ['pre-commit', 'pre-push'];

const BLOCK_START = '# >>> auto-tracking';
const BLOCK_END = '# <<< auto-tracking';

const HOOK_DESCRIPTION: Readonly<Record<GitHookName, string>> = {
  'pre-commit': 'Atualiza o tagueamento e inclui no próprio commit o que mudou.',
  'pre-push': 'Só verifica: bloqueia o push se o tagueamento estiver pendente ou fora do commit.',
};

/**
 * Bloco shell do hook, organizado em funções nomeadas para quem abrir o
 * arquivo entender o que roda. `project` é o caminho do app relativo à raiz
 * git ('' quando coincidem), para monorepos. POSIX sh: roda no Git Bash do
 * Windows, macOS e Linux.
 */
export function hookBlock(hook: GitHookName, project = ''): string {
  const projectPath = project ? `/${project.split(path.sep).join('/')}` : '';
  return [
    `${BLOCK_START} (gerado por \`auto-tracking hooks install\`; não editar dentro do bloco)`,
    '# Tagueamento automático do auto-tracking-angular.',
    `# ${hook}: ${HOOK_DESCRIPTION[hook]}`,
    '# Ver o que está instalado: npx auto-tracking hooks status',
    '',
    '# Clientes Git gráficos iniciam sem o PATH do terminal: procura o Node nos gerenciadores comuns.',
    'auto_tracking_localizar_node() {',
    '  command -v node >/dev/null 2>&1 && return 0',
    '  PATH="$HOME/.volta/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    '  command -v node >/dev/null 2>&1 && return 0',
    '  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then',
    '    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1',
    '    nvm use --silent >/dev/null 2>&1 || nvm use default --silent >/dev/null 2>&1',
    '  fi',
    '  command -v node >/dev/null 2>&1 || { echo "[auto-tracking] Node.js não encontrado no PATH do Git." >&2; return 1; }',
    '}',
    '',
    '# Executa o hook da biblioteca instalada no projeto; toda a lógica fica na lib.',
    'auto_tracking_executar() {',
    `  auto_tracking_projeto="$(git rev-parse --show-toplevel)${projectPath}"`,
    '  auto_tracking_cli="$auto_tracking_projeto/node_modules/auto-tracking-angular/dist/cli/index.js"',
    '  if [ ! -f "$auto_tracking_cli" ]; then',
    '    echo "[auto-tracking] biblioteca não instalada: execute npm install." >&2',
    '    return 1',
    '  fi',
    '  node "$auto_tracking_cli" hook "$1" --root "$auto_tracking_projeto"',
    '}',
    '',
    `auto_tracking_localizar_node && auto_tracking_executar ${hook} || exit 1`,
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
  'pre-commit': 'atualiza o tagueamento; se algo mudou, inclui no próprio commit (templates escritos agora + relatório, planilha e cache)',
  'pre-push': 'só verifica; bloqueia o push se houver tagueamento pendente ou artefato não commitado',
};

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
 * Versão exata declarada pelo consumidor e versão instalada precisam coincidir:
 * hooks rodando outra versão da lib gerariam contrato diferente do da esteira.
 */
export function installedVersionMismatch(root: string, packageName: string, installedVersion: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as Record<string, Record<string, string> | undefined>;
    const declared = manifest['dependencies']?.[packageName] ?? manifest['devDependencies']?.[packageName];
    if (!declared || !/^\d+\.\d+\.\d+$/.test(declared) || declared === installedVersion) return null;
    return `${packageName} instalado ${installedVersion}, package.json exige ${declared}: execute npm install`;
  } catch {
    return null;
  }
}

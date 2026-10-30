import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { hookBlock, upsertHookBlock } from '../../src/cli/git-hooks.js';

describe('hooks git: bloco gerenciado pela lib', () => {
  it('cria hook novo e é idempotente', () => {
    const created = upsertHookBlock(null, 'pre-commit');
    expect(created.startsWith('#!/bin/sh\n')).toBe(true);
    expect(created).toContain('auto_tracking_executar pre-commit || exit 1');
    expect(created).toContain('# pre-commit: Atualiza o tagueamento');
    expect(upsertHookBlock(created, 'pre-commit')).toBe(created);
  });

  it('em hook existente (Husky) entra depois de husky.sh e antes de qualquer exit', () => {
    const husky = '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nnpx eslint\nexit 0\n';
    const result = upsertHookBlock(husky, 'pre-push');
    const lines = result.split('\n');
    expect(lines[1]).toContain('husky.sh');
    expect(lines[2]).toContain('# >>> auto-tracking');
    expect(result.indexOf('auto_tracking_executar pre-push')).toBeLessThan(result.indexOf('exit 0'));
    expect(result).toContain('npx eslint');
  });

  it('atualiza bloco antigo no lugar, sem duplicar nem tocar o restante', () => {
    const old = '#!/bin/sh\n# >>> auto-tracking antigo\necho velho\n# <<< auto-tracking\nnpm test\n';
    const result = upsertHookBlock(old, 'pre-commit');
    expect(result.match(/# >>> auto-tracking/g)).toHaveLength(1);
    expect(result).not.toContain('echo velho');
    expect(result.endsWith('npm test\n')).toBe(true);
  });

  it('hook com CRLF (checkout no Windows) é regravado em LF', () => {
    const result = upsertHookBlock('#!/bin/sh\r\nnpm test\r\n', 'pre-commit');
    expect(result).not.toContain('\r');
  });

  it('monorepo: o bloco aponta para a pasta do app dentro do repositório', () => {
    expect(hookBlock('pre-commit', path.join('apps', 'saude'))).toContain('auto_tracking_projeto="$(git rev-parse --show-toplevel)/apps/saude"');
  });
});

describe('hooks git: fluxo real de commit e push', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (message: string) => spawnSync('git', ['commit', '-m', message], { cwd: root, encoding: 'utf8' });
  const write = (file: string, content: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const cli = (...args: string[]) => spawnSync(process.execPath, [path.resolve('dist/cli/index.js'), ...args, '--root', root], { encoding: 'utf8' });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-hooks-')));
    git('init', '-q');
    git('config', 'user.email', 'teste@exemplo.invalid');
    git('config', 'user.name', 'Teste');
    git('config', 'core.hooksPath', '.githooks');
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}');
    write('package.json', JSON.stringify({ dependencies: {} }));
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      runtime: { owner: 'app', root: 'app-root', product: 'saude', preset: examplePreset, mode: 'ref', send: () => {} }
    });`);
    write('src/app.ts', `@Component({selector: 'app-root', templateUrl: './app.html'}) export class App {}
      const routes = [{ path: '', component: App }]; const providers = [provideAutoTracking(config.runtime)];`);
    write('src/app.html', '<h1>Início</h1>');
    write('.gitignore', 'node_modules\n');
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync(path.resolve('.'), path.join(root, 'node_modules', 'auto-tracking-angular'), 'dir');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('instala, gera no commit, deixa commit sem mudança intacto e protege edição não preparada e o push', () => {
    const install = cli('hooks', 'install');
    expect(install.status).toBe(0);
    expect(fs.readFileSync(path.join(root, '.githooks/pre-commit'), 'utf8')).toContain('auto_tracking_executar pre-commit');
    expect(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')).toContain('.githooks/* text eol=lf');
    expect(cli('hooks', 'install').status).toBe(0); // idempotente
    const status = cli('hooks', 'status');
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/pre-commit\s+instalado\s+\.githooks\/pre-commit/);
    expect(status.stdout).toContain('inclui no próprio commit');
    expect(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8').match(/eol=lf/g)).toHaveLength(1);

    // Commit inicial: a lib marca a tela e o botão e inclui tudo no mesmo commit.
    write('src/app.html', '<h1>Início</h1><button (click)="salvar()">Salvar</button>');
    git('add', '-A');
    const first = commit('feat: tela');
    expect(first.status).toBe(0);
    expect(first.stderr).toContain('incluídos neste commit');
    expect(git('show', 'HEAD:src/app.html')).toContain('data-at-ref=');
    expect(git('ls-files', '.auto-tracking')).toContain('relatorio.json');
    expect(git('status', '--porcelain')).toBe('');

    // Artefatos gerados por uma execução manual (não preparados) nunca bloqueiam.
    write('src/app.html', `${git('show', 'HEAD:src/app.html')}<a routerLink="/ajuda">Ajuda</a>`);
    expect(cli('apply', '--json').status).toBe(0);
    git('add', 'src/app.html');
    const manual = commit('feat: ajuda');
    expect(manual.status).toBe(0);
    expect(git('status', '--porcelain')).toBe('');

    // Commit sem relação com tagueamento: nada é escrito nem adicionado.
    write('README.md', 'doc');
    git('add', 'README.md');
    const second = commit('docs: readme');
    expect(second.status).toBe(0);
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('README.md');

    // Edição não preparada num template: o commit não leva a edição pela metade.
    write('src/app.html', `${git('show', 'HEAD:src/app.html')}<button (click)="cancelar()">Cancelar</button>`);
    write('NOTAS.md', 'x');
    git('add', 'NOTAS.md');
    const blocked = commit('chore: notas');
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('alterações não preparadas: src/app.html');

    // Revisado e preparado: o commit passa com a marcação nova.
    git('add', '-A');
    expect(commit('feat: cancelar').status).toBe(0);
    expect(git('status', '--porcelain')).toBe('');
    expect(cli('hook', 'pre-push').status).toBe(0);

    // Artefato alterado fora de commit: o push é bloqueado.
    fs.appendFileSync(path.join(root, '.auto-tracking/relatorio.json'), ' ');
    const push = cli('hook', 'pre-push');
    expect(push.status).toBe(1);
    expect(push.stderr).toContain('push bloqueado');
  });
});

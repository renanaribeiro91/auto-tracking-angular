import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = ['current', 'patch', 'minor', 'major'];
const args = process.argv.slice(2);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stream ? 'inherit' : 'pipe',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${commandArgs.join(' ')} falhou (código ${result.status})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function packageInfo() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function nextVersion(current, mode) {
  if (mode === 'current') return current;
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!parts) throw new Error(`Versão ${current} não é semver estável. Altere manualmente antes de publicar.`);
  let [major, minor, patch] = parts.slice(1).map(Number);
  if (mode === 'major') { major++; minor = 0; patch = 0; }
  if (mode === 'minor') { minor++; patch = 0; }
  if (mode === 'patch') patch++;
  return `${major}.${minor}.${patch}`;
}

function assertCleanGit() {
  const status = run('git', ['status', '--porcelain', '--untracked-files=normal']);
  if (status) throw new Error('A árvore Git tem alterações. Revise e registre a versão em um commit antes de publicar.');
}

function assertNotAlreadyPublished(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--registry=https://registry.npmjs.org/', '--json'],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status === 0 && result.stdout.trim()) throw new Error(`${name}@${version} já existe no npm.`);
  if (result.status !== 0 && !/E404|404 Not Found/i.test(`${result.stderr}\n${result.stdout}`)) {
    throw new Error(`Não foi possível consultar o npm: ${result.stderr.trim().slice(0, 250)}`);
  }
}

function assertNotStaged(name, version) {
  const staged = run('npm', ['stage', 'list', name]);
  const blocks = staged.split(/\n\s*\n/);
  if (blocks.some((block) => block.includes(`version: ${version}`) && /status: (?:staged|validating)/i.test(block))) {
    throw new Error(`${name}@${version} já está em estágio. Confira: npm stage list ${name}`);
  }
}

async function main() {
  if (args[0] === '--help' || args[0] === '-h') {
    console.log('Uso: npm run publish:npm [-- current|patch|minor|major]');
    console.log('current publica a versão do package.json; patch/minor/major incrementam-na.');
    console.log('Exige Git limpo e autenticação npm. Executa os gates prepublishOnly e cria um stage; a aprovação 2FA é separada.');
    return;
  }
  const mode = args[0] ?? 'current';
  if (!modes.includes(mode) || args.length > 1) throw new Error(`Modo inválido: ${args.join(' ')}. Use current, patch, minor ou major.`);
  const pkg = packageInfo();
  if (pkg.private || pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') {
    throw new Error('O pacote não está configurado explicitamente para publicação no npm público.');
  }
  assertCleanGit();
  const proposed = nextVersion(pkg.version, mode);
  run('npm', ['whoami', '--registry=https://registry.npmjs.org/']);
  assertNotAlreadyPublished(pkg.name, proposed);
  assertNotStaged(pkg.name, proposed);
  if (mode !== 'current') {
    run('npm', ['version', mode, '--no-git-tag-version', '--ignore-scripts'], { stream: true });
    if (packageInfo().version !== proposed) throw new Error('A atualização do package.json falhou. Não publique.');
  }
  console.log(`Enviando ${pkg.name}@${proposed} para revisão do npm. A validação prepublishOnly será executada automaticamente.`);
  run('npm', ['stage', 'publish'], { stream: true });
  console.log(`Versão ${proposed} enviada para estágio. Acesse npm stage list ${pkg.name} para obter o ID e aprove com 2FA.`);
  console.log('O script não faz commit, push ou aprovação sem sua autorização.');
}

main().catch((error) => {
  console.error(`Falha na publicação: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

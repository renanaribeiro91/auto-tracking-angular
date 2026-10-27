import { spawnSync } from 'node:child_process';

/** Executa os gates e o pack usando o npm que iniciou o próprio release. */
export class NpmRunner {
  constructor(root) {
    this.root = root;
  }

  run(args, capture = false) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Execute este fluxo por `npm run release` para localizar o npm corretamente.');
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      cwd: this.root,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
    });
    if (capture && result.stdout) process.stdout.write(result.stdout);
    if (capture && result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args.join(' ')} terminou com código ${result.status ?? 'desconhecido'}`);
    return result.stdout ?? '';
  }
}

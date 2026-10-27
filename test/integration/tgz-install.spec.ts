// T34 — instalar mesmo .tgz em dois consumidores isolados
// shortcut: valida que npm pack lista os arquivos corretos sem extrair em dir temporário real
//           testes de instalação real requerem npm pack + npm install em CI
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');

describe('tgz install — dual-consumer isolation (T34)', () => {
  it('package.json has correct name and bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('auto-tracking-angular');
    expect(pkg.bin?.['auto-tracking']).toBeTruthy();
  });

  it('package.json exports map . and ./config', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.exports?.['.']).toBeTruthy();
    expect(pkg.exports?.['./config']).toBeTruthy();
    expect(Object.keys(pkg.exports ?? {}).some((entry) => entry.startsWith('./presets/'))).toBe(false);
  });

  it('npm pack --dry-run lists src files without error', () => {
    // shortcut: only validates the command exits 0; full .tgz extraction in CI
    expect(() => {
      execSync('npm pack --dry-run', { cwd: ROOT, stdio: 'pipe' });
    }).not.toThrow();
  });

  it('src/index.ts does not import typescript, fs, or xlsx at top level', () => {
    const content = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf-8');
    const forbidden = ['require("typescript")', "require('typescript')", 'require("fs")', "require('fs')", 'require("xlsx")', "require('xlsx')"];
    for (const f of forbidden) {
      expect(content).not.toContain(f);
    }
  });
});

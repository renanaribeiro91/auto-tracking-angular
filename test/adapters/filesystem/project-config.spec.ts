import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveOutputPaths } from '../../../src/adapters/filesystem/project-config.js';

describe('resolução do diretório de saída', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-paths-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('aceita saída relativa fora das pastas reservadas', () => {
    expect(resolveOutputPaths(root, '.auto-tracking')?.outputDir).toBe(path.join(root, '.auto-tracking'));
    expect(resolveOutputPaths(root, 'src-generated')).not.toBeNull();
  });

  it('rejeita raiz, traversal e pastas reservadas sem bloquear nomes semelhantes', () => {
    expect(resolveOutputPaths(root, '')).toBeNull();
    expect(resolveOutputPaths(root, '../outside')).toBeNull();
    expect(resolveOutputPaths(root, 'src')).toBeNull();
    expect(resolveOutputPaths(root, 'src/reports')).toBeNull();
    expect(resolveOutputPaths(root, 'dist-cache')).not.toBeNull();
  });

  it('rejeita saída que atravessa um symlink', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'at-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'linked-output'), 'dir');
      expect(resolveOutputPaths(root, 'linked-output/reports')).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

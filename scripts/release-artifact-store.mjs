import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Protege artefatos locais contra sobrescrita e registra checksum de integridade. */
export class ReleaseArtifactStore {
  constructor(directory) {
    this.directory = directory;
  }

  paths(packageName, version) {
    const filename = `${packageName}-${version}.tgz`;
    const tarball = path.join(this.directory, filename);
    return { filename, tarball, checksum: `${tarball}.sha256` };
  }

  assertNew(tarball, checksum) {
    if (existsSync(tarball) || existsSync(checksum)) {
      throw new Error(`O artefato de ${path.basename(tarball)} já existe em release/; nenhum arquivo foi sobrescrito.`);
    }
  }

  writeChecksum(tarball, checksum, filename) {
    if (!existsSync(tarball)) throw new Error(`npm pack não gerou o artefato esperado: ${filename}`);
    const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    writeFileSync(checksum, `${digest}  ${filename}\n`);
  }

  remove(tarball, checksum) {
    if (existsSync(tarball)) unlinkSync(tarball);
    if (existsSync(checksum)) unlinkSync(checksum);
  }
}

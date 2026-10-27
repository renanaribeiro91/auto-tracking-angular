import { readFileSync, writeFileSync } from 'node:fs';

/** Fonte única da versão: package.json; package-lock.json é sincronizado pelo release. */
export class PackageManifestStore {
  constructor(packageFile, lockFile) {
    this.packageFile = packageFile;
    this.lockFile = lockFile;
  }

  read() {
    const packageBytes = readFileSync(this.packageFile);
    const lockBytes = readFileSync(this.lockFile);
    const packageJson = JSON.parse(packageBytes.toString('utf8'));
    const packageLock = JSON.parse(lockBytes.toString('utf8'));

    if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) throw new Error('package.json precisa declarar name.');
    if (packageJson.private !== true) throw new Error('O pacote precisa permanecer privado; release gera somente o arquivo .tgz.');
    if (!packageLock.packages?.['']) throw new Error('package-lock.json não contém os metadados da raiz do pacote.');
    if (packageJson.version !== packageLock.version || packageJson.version !== packageLock.packages[''].version) {
      throw new Error('package.json e package-lock.json estão com versões divergentes.');
    }
    return { packageBytes, lockBytes, packageJson, packageLock };
  }

  writeVersion(snapshot, version) {
    snapshot.packageJson.version = version;
    snapshot.packageLock.version = version;
    snapshot.packageLock.packages[''].version = version;
    writeFileSync(this.packageFile, `${JSON.stringify(snapshot.packageJson, null, 2)}\n`);
    writeFileSync(this.lockFile, `${JSON.stringify(snapshot.packageLock, null, 2)}\n`);
  }

  restore(snapshot) {
    writeFileSync(this.packageFile, snapshot.packageBytes);
    writeFileSync(this.lockFile, snapshot.lockBytes);
  }
}

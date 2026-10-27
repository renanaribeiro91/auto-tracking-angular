import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_CONFIG } from './release.config.mjs';
import { ReleaseArtifactStore } from './release-artifact-store.mjs';
import { NpmRunner } from './npm-runner.mjs';
import { PackageManifestStore } from './package-manifest-store.mjs';
import { ReleaseVersionPolicy } from './release-version-policy.mjs';
import { releaseRoot } from './release.paths.mjs';

/** Coordena validação e empacotamento privado; cada regra pertence ao serviço de domínio correspondente. */
export class ReleaseManager {
  constructor(args = process.argv.slice(2), root = releaseRoot(import.meta.url)) {
    this.root = root;
    this.args = args;
    this.packageStore = new PackageManifestStore(path.join(root, 'package.json'), path.join(root, 'package-lock.json'));
    this.versionPolicy = new ReleaseVersionPolicy();
    this.artifacts = new ReleaseArtifactStore(path.join(root, 'release'));
    this.npm = new NpmRunner(root);
  }

  async run() {
    const mode = this.versionPolicy.parseMode(this.args);
    if (!mode) return;

    const snapshot = this.packageStore.read();
    const releaseVersion = this.versionPolicy.next(snapshot.packageJson.version, mode);
    const paths = this.artifacts.paths(snapshot.packageJson.name, releaseVersion);
    this.artifacts.assertNew(paths.tarball, paths.checksum);

    console.log(`Validando release ${snapshot.packageJson.version} → ${releaseVersion}.`);
    for (const gate of RELEASE_CONFIG.gates) this.npm.run([...gate]);

    let versionUpdated = false;
    try {
      mkdirSync(this.artifacts.directory, { recursive: true });
      if (mode !== RELEASE_CONFIG.currentMode) {
        versionUpdated = true;
        this.packageStore.writeVersion(snapshot, releaseVersion);
      }

      console.log('Gerando o pacote .tgz local e seu checksum SHA-256.');
      this.npm.run(['pack', '--ignore-scripts', '--pack-destination', this.artifacts.directory], true);
      this.artifacts.writeChecksum(paths.tarball, paths.checksum, paths.filename);
      console.log(`Release concluído: release/${paths.filename}`);
      console.log(`Checksum de integridade: release/${path.basename(paths.checksum)}`);
    } catch (error) {
      this.artifacts.remove(paths.tarball, paths.checksum);
      if (versionUpdated) this.packageStore.restore(snapshot);
      throw error;
    }
  }
}

const runningScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (runningScript === fileURLToPath(import.meta.url)) {
  new ReleaseManager().run().catch((error) => {
    console.error(`Falha no release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

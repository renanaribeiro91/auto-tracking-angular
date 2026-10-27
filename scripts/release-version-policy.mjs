import { RELEASE_CONFIG } from './release.config.mjs';

/** Interpreta a intenção do release e calcula a próxima versão numérica. */
export class ReleaseVersionPolicy {
  parseMode(args) {
    if (args.includes('--help')) {
      console.log(`${RELEASE_CONFIG.usage}\nPadrão: incremento minor, com virada de 9 para o próximo major. --current é reservado ao CI.`);
      return null;
    }
    const flags = args.filter((arg) => arg.startsWith('--'));
    const valid = flags.length <= 1 && args.length === flags.length && flags.every((arg) => RELEASE_CONFIG.supportedModes.includes(arg.slice(2)));
    if (!valid) throw new Error(RELEASE_CONFIG.usage);
    return flags[0]?.slice(2) ?? RELEASE_CONFIG.defaultMode;
  }

  next(version, mode) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
    if (!match) throw new Error(`versão SemVer numérica inválida: ${version}`);
    const [major, minor, patch] = match.slice(1).map(Number);
    if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error(`versão fora do limite suportado: ${version}`);

    if (mode === RELEASE_CONFIG.currentMode) return version;
    if (mode === 'patch') return `${major}.${minor}.${patch + 1}`;
    if (mode === 'major' || minor === RELEASE_CONFIG.maxMinorBeforeMajor) return `${major + 1}.0.0`;
    return `${major}.${minor + 1}.0`;
  }
}

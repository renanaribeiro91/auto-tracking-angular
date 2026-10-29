/** Política de artefatos locais, sem publicação; versão vigente em package.json. */
export const RELEASE_CONFIG = Object.freeze({
  defaultMode: 'minor',
  currentMode: 'current',
  maxMinorBeforeMajor: 9,
  supportedModes: Object.freeze(['patch', 'minor', 'major', 'current']),
  usage: 'Uso: npm run release [-- --patch | --minor | --major | --current]',
  gates: Object.freeze([
    Object.freeze(['run', 'typecheck']),
    Object.freeze(['run', 'build']),
    Object.freeze(['test']),
  ]),
});

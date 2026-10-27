import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AngularProjectConfigReader } from '../../../src/adapters/angular-compiler/angular-index.js';

it('lê identidade visual literal sem executar a configuração do consumidor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-branding-'));
  try {
    const file = path.join(dir, 'auto-tracking.config.ts');
    fs.writeFileSync(file, `throw new Error('não executar'); export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      branding: { logoPng: 'assets/logo.png', primaryColor: '#123456' },
      runtime: { owner: 'app', product: 'produto', root: 'app-root', preset: customPreset }
    });`);
    const config = new AngularProjectConfigReader().readTrackingConfigStatically(file);
    expect(config?.branding).toEqual({ logoPng: 'assets/logo.png', primaryColor: '#123456' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

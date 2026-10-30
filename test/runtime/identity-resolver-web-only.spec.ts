import { AppIdentityResolver } from '../../src/adapters/runtime/identity-resolver.js';
import { examplePreset } from '../fixtures/preset/index.js';

describe('Angular puro, sem Capacitor', () => {
  it('usa o tema Web quando não há ponte nativa', async () => {
    const resolver = new AppIdentityResolver();
    const getWebTheme = jest.fn(() => 'saude');
    const results = await Promise.all(Array.from({ length: 50 }, () =>
      resolver.resolve(examplePreset, getWebTheme)));
    expect(results).toEqual(Array(50).fill({ kind: 'web', environment: 'app-x' }));
    expect(getWebTheme).toHaveBeenCalledTimes(50);
  });

  it('Capacitor em modo web (isNativePlatform falso ou com erro) também usa o tema', async () => {
    const globals = globalThis as { Capacitor?: unknown };
    for (const bridge of [{ isNativePlatform: () => false }, { isNativePlatform: () => { throw new Error('x'); } }]) {
      globals.Capacitor = bridge;
      expect(await new AppIdentityResolver().resolve(examplePreset, () => 'saude')).toEqual({ kind: 'web', environment: 'app-x' });
    }
    delete globals.Capacitor;
  });
});

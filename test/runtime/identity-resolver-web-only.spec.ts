import { AppIdentityResolver } from '../../src/adapters/runtime/identity-resolver.js';
import { examplePreset } from '../fixtures/preset/index.js';

jest.mock('@capacitor/core', () => {
  throw new Error('Failed to resolve module specifier "@capacitor/core"');
});

describe('Angular puro, sem dependência de runtime Capacitor', () => {
  it('recupera ambiente Web quando o pacote Capacitor não está disponível', async () => {
    const resolver = new AppIdentityResolver();
    const getWebTheme = jest.fn(() => 'saude');
    const results = await Promise.all(Array.from({ length: 50 }, () =>
      resolver.resolve(examplePreset, getWebTheme)));
    expect(results).toEqual(Array(50).fill({ kind: 'web', environment: 'app-x' }));
    expect(getWebTheme).toHaveBeenCalledTimes(50);
  });
});

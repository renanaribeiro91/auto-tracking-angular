import { AppIdentityResolver } from '../../src/adapters/runtime/identity-resolver.js';
import { App } from '@capacitor/app';
import { examplePreset } from '../fixtures/preset/index.js';

jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
jest.mock('@capacitor/app', () => ({ App: { getInfo: jest.fn() } }));

const native = App.getInfo as jest.Mock;

describe('ponte nativa: resoluções concorrentes e falhas não causam tempestade de chamadas', () => {
  beforeEach(() => { native.mockReset(); });

  it('100 eventos simultâneos fazem uma consulta de identidade, sem ler tema web', async () => {
    native.mockResolvedValue({ id: 'com.exemplo.saude.mobile' });
    const resolver = new AppIdentityResolver();
    const readTheme = jest.fn(() => 'saude');
    const results = await Promise.all(Array.from({ length: 100 }, () =>
      resolver.resolve(examplePreset, readTheme)));
    expect(results.every((result) =>
      result.kind === 'native' && result.result.environment === 'app-x')).toBe(true);
    expect(native).toHaveBeenCalledTimes(1);
    expect(readTheme).not.toHaveBeenCalled();
  });

  it('bundle sem mapeamento dá diagnóstico, mas não repete chamada à bridge a cada clique', async () => {
    native.mockResolvedValue({ id: 'com.exemplo.desconhecido' });
    const resolver = new AppIdentityResolver();
    const first = await resolver.resolve(examplePreset, () => 'saude');
    const second = await resolver.resolve(examplePreset, () => 'saude');
    expect(first).toEqual({ kind: 'unknown', reason: expect.stringContaining('não mapeado') });
    expect(second).toEqual(first);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('quando a plataforma é nativa, a falha do plugin não vira tema Web silenciosamente', async () => {
    native.mockRejectedValue(new Error('Cannot find module Capacitor/App'));
    const resolver = new AppIdentityResolver();
    const getWebTheme = jest.fn(() => 'saude');
    const result = await resolver.resolve(examplePreset, getWebTheme);
    expect(result).toEqual({
      kind: 'unknown',
      reason: expect.stringContaining('Cannot find module Capacitor/App'),
    });
    expect(getWebTheme).not.toHaveBeenCalled();
  });

  it('falha transitória tem cooldown e o diagnóstico permanece visível', async () => {
    native.mockRejectedValueOnce(new Error('bridge unavailable'));
    native.mockResolvedValue({ id: 'com.exemplo.saude.mobile' });
    const resolver = new AppIdentityResolver();
    const first = await resolver.resolve(examplePreset, () => 'saude');
    const second = await resolver.resolve(examplePreset, () => 'saude');
    expect(first).toEqual({ kind: 'unknown', reason: expect.stringContaining('bridge unavailable') });
    expect(second).toEqual(first);
    expect(native).toHaveBeenCalledTimes(1);
  });
});

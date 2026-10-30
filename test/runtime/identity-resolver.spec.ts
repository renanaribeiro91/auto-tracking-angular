import { AppIdentityResolver } from '../../src/adapters/runtime/identity-resolver.js';
import { examplePreset } from '../fixtures/preset/index.js';

// Ponte instalada pelo runtime nativo do Capacitor no WebView; a lib não importa @capacitor/*.
const native = jest.fn();
const globals = globalThis as { Capacitor?: unknown };
beforeAll(() => { globals.Capacitor = { isNativePlatform: () => true, Plugins: { App: { getInfo: native } } }; });
afterAll(() => { delete globals.Capacitor; });

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
    native.mockRejectedValue(new Error('"App" plugin is not implemented on android'));
    const resolver = new AppIdentityResolver();
    const getWebTheme = jest.fn(() => 'saude');
    const result = await resolver.resolve(examplePreset, getWebTheme);
    expect(result).toEqual({
      kind: 'unknown',
      reason: expect.stringContaining('not implemented on android'),
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

  it('sem plugin App registrado, chama a ponte nativa diretamente', async () => {
    const nativePromise = jest.fn().mockResolvedValue({ id: 'com.exemplo.saude.mobile' });
    globals.Capacitor = { isNativePlatform: () => true, nativePromise, Plugins: {} };
    const result = await new AppIdentityResolver().resolve(examplePreset, () => 'saude');
    expect(result).toEqual({ kind: 'native', result: { bundleId: 'com.exemplo.saude.mobile', environment: 'app-x' } });
    expect(nativePromise).toHaveBeenCalledWith('App', 'getInfo', {});
  });

  it('nativo sem ponte para App gera diagnóstico, nunca exceção', async () => {
    globals.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    const result = await new AppIdentityResolver().resolve(examplePreset, () => 'saude');
    expect(result).toEqual({ kind: 'unknown', reason: expect.stringContaining('indisponível') });
  });
});

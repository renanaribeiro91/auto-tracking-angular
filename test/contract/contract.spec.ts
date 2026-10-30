import { defineAutoTrackingProject, type TrackingOptions } from '../../src/config.js';
import { validateEvent } from '../../src/domain/contract/schema.js';
import { examplePreset } from '../fixtures/preset/index.js';

const click = {
  ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso',
  tela: 'app-x:saude:tipo-documento', categoria: 'app-x:saude:tipo-documento',
  elemento: 'botao', rotulo: 'anexar-recibo', acao: 'clique',
};

describe('contrato público', () => {
  it('defineAutoTrackingProject é identidade tipada (lida por AST sem executar)', () => {
    const runtime = { owner: 'mob', root: 'app-root', product: 'saude', preset: examplePreset, send: () => undefined } satisfies TrackingOptions;
    const cfg = { projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }], runtime };
    expect(defineAutoTrackingProject(cfg)).toBe(cfg);
  });

  describe('validateEvent + schema do consumidor', () => {
    const schema = examplePreset.schema;
    it('click completo (payload do runtime) é válido', () => {
      expect(validateEvent({ name: 'click', params: click }, schema)).toEqual({ kind: 'valid' });
      expect(validateEvent({ name: 'click', params: { ...click, opcao_selecionada_1: 'recibo' } }, schema)).toEqual({ kind: 'valid' });
    });
    it('campo obrigatório ausente é rejeitado', () => {
      const { categoria: _omit, ...semCategoria } = click;
      expect(validateEvent({ name: 'click', params: semCategoria }, schema)).toEqual({ kind: 'missing-params', params: ['categoria'] });
    });
    it('campo obrigatório vazio é rejeitado: chegaria ao analytics como (not set)', () => {
      expect(validateEvent({ name: 'click', params: { ...click, rotulo: '' } }, schema)).toEqual({ kind: 'missing-params', params: ['rotulo'] });
      expect(validateEvent({ name: 'click', params: { ...click, tela: '  ' } }, schema)).toEqual({ kind: 'missing-params', params: ['tela'] });
    });
    it('campo fora do contrato do Builder é rejeitado', () => {
      expect(validateEvent({ name: 'click', params: { ...click, label: 'x' } }, schema)).toEqual({ kind: 'extra-params', params: ['label'] });
    });
    it('screen_view leva só ambiente, produto, funcionalidade e tela', () => {
      const tela = { ambiente: 'app-x', produto: 'saude', funcionalidade: 'reembolso', tela: 'app-x:saude:tipo-documento' };
      expect(validateEvent({ name: 'screen_view', params: tela }, schema)).toEqual({ kind: 'valid' });
      expect(validateEvent({ name: 'screen_view', params: { ...tela, categoria: tela.tela } }, schema)).toEqual({ kind: 'extra-params', params: ['categoria'] });
    });
  });

  describe('identidade de app (busca exata, sem heurística de substring)', () => {
    it.each([
      ['com.exemplo.saude.mobile', 'app-x'],
      ['com.exemplo.saude.portal', 'app-x'],
      ['com.exemplo.servicos.mobile', 'app-y'],
      ['com.exemplo.servicos.portal', 'app-y'],
      ['com.exemplo.geral.app', 'app-z'],
      ['com.exemplo.geral.dev', 'app-z'],
      ['com.exemplo.geral.store', 'app-z'],
    ])('%s → %s', (id, env) => expect(examplePreset.nativeAppIdToEnvironment[id]).toBe(env));
    it('id desconhecido não resolve', () => expect(examplePreset.nativeAppIdToEnvironment['com.exemplo.geral.nao-mapeado']).toBeUndefined());
    it('tema Web segue apenas o mapa explícito do preset de teste', () => {
      expect(examplePreset.webThemeToEnvironment).toEqual({ saude: 'app-x', 'servicos': 'app-y', '': 'app-z' });
    });
  });
});

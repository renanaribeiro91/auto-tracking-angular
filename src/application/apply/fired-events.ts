import { isStaticScreenReference, screenPath, subfuncionalidadeOf } from '../../domain/contract/screen-binding.js';
import type { TagEntry } from './tagger.js';

/** Parâmetros do evento com os nomes enviados ao Firebase; campo ausente é campo que o evento não leva. */
export interface FiredEventParams {
  readonly ambiente: string;
  readonly produto: string;
  readonly funcionalidade: string;
  readonly subfuncionalidade?: string;
  readonly tela: string;
  readonly categoria?: string;
  readonly elemento?: string;
  readonly rotulo?: string;
  readonly acao?: string;
  readonly opcao_selecionada_1?: string;
}

export interface FiredEvent {
  readonly modulo: string;
  readonly params: FiredEventParams;
}

/** Evento que a entrada dispara em cada tela: fonte única do relatório e da planilha. */
export function firedEvents(entry: TagEntry, product: string): FiredEvent[] {
  const screens = entry.telas.filter(isStaticScreenReference);
  return (screens.length ? screens : [null]).map((screenRef) => {
    const [funcionalidade, nomeTela = ''] = screenRef?.split(':') ?? [];
    const subfuncionalidade = screenRef ? subfuncionalidadeOf(funcionalidade!, nomeTela) : '{tela-de-origem}';
    const tela = `{ambiente}:${product}:${screenRef ? screenPath(funcionalidade!, nomeTela) : '{funcionalidade-de-origem}:{tela-de-origem}'}`;
    return {
      modulo: funcionalidade ?? entry.funcionalidade,
      params: {
        ambiente: '{ambiente}',
        produto: product,
        funcionalidade: funcionalidade ?? '{funcionalidade-de-origem}',
        ...(subfuncionalidade ? { subfuncionalidade } : {}),
        tela,
        // screen_view não envia ação, elemento, rótulo nem categoria.
        ...(entry.evento === 'screen_view' ? {} : {
          categoria: tela,
          elemento: entry.elemento,
          rotulo: entry.rotulos?.length ? `Um de: ${entry.rotulos.join('; ')}` : entry.rotulo,
          acao: entry.acao,
          ...(entry.opcao_selecionada_1 ? { opcao_selecionada_1: entry.opcao_selecionada_1 } : {}),
        }),
      },
    };
  });
}

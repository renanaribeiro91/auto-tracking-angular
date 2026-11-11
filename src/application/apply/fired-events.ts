import { isStaticScreenReference, screenPath, splitScreenReference, subfuncionalidadeOf } from '../../domain/contract/screen-binding.js';
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

/** Aba do que dispara na tela em que a pessoa está: serviço ou componente não é módulo do produto. */
export const ORIGIN_MODULE = 'tela-de-origem';

export interface FiredEvent {
  readonly modulo: string;
  readonly params: FiredEventParams;
}

/** Alternativas provadas: uma só é o próprio rótulo; várias, o conjunto. */
function alternatives(labels: readonly string[] | undefined): string | undefined {
  return !labels?.length ? undefined : labels.length === 1 ? labels[0] : `Um de: ${labels.join('; ')}`;
}

/** Evento que a entrada dispara em cada tela: fonte única do relatório e da planilha. */
export function firedEvents(entry: TagEntry, product: string): FiredEvent[] {
  // Tela cuja rota não traz a lista não renderiza o elemento: o evento não existe nela.
  const screens = entry.telas.filter((screen) => isStaticScreenReference(screen) && entry.rotulosPorTela?.[screen]?.length !== 0);
  return (screens.length ? screens : [null]).map((screenRef) => {
    const { funcionalidade, tela: nomeTela } = screenRef ? splitScreenReference(screenRef) : { funcionalidade: undefined, tela: '' };
    const subfuncionalidade = screenRef ? subfuncionalidadeOf(funcionalidade!, nomeTela) : '{tela-de-origem}';
    const tela = `{ambiente}:${product}:${screenRef ? screenPath(funcionalidade!, nomeTela) : '{funcionalidade-de-origem}:{tela-de-origem}'}`;
    return {
      modulo: funcionalidade ?? ORIGIN_MODULE,
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
          rotulo: alternatives(screenRef ? entry.rotulosPorTela?.[screenRef] ?? entry.rotulos : entry.rotulos) ?? entry.rotulo,
          acao: entry.acao,
          ...(entry.opcao_selecionada_1 ? { opcao_selecionada_1: entry.opcao_selecionada_1 } : {}),
        }),
      },
    };
  });
}

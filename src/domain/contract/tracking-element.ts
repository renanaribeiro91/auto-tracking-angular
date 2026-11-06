import type { OutputBinding } from './output-bindings.js';

/** Contrato browser-safe: uma referência representa todos os eventos de um nó. */
export interface TrackingElement {
  readonly owner: string;
  readonly funcionalidade: string;
  readonly tela: string;
  readonly screenId?: string;
  readonly click?: {
    readonly id: string;
    readonly event: string;
    readonly elemento: string;
    readonly rotulo: string;
    readonly opcaoPermitida?: string;
    /** Regra comprovada pelo template: extrair o único número permitido do aria-label atual. */
    /** O JSON importado tipa strings amplamente; o runtime aceita somente o valor conhecido. */
    readonly opcaoFonte?: string;
  };
  readonly outputs?: readonly OutputBinding[];
  readonly overlayOutputs?: readonly OutputBinding[];
  /** Rótulos literais provados no código (item de lista estática); o visível só é enviado se estiver aqui. */
  readonly rotulos?: readonly string[];
  /**
   * IDs dos gestos cujo texto visível vem de interpolação sem indício de dado pessoal
   * (ex.: menu do serviço). O runtime lê o texto atual no clique só nesses gestos;
   * `rotulo`/`label` ficam como fallback. Voltar/fechar do componente nunca entram.
   */
  readonly rotuloDinamico?: readonly string[];
  /** Regras completas da superfície TS; impede usar ref anterior a uma alteração. */
  readonly surfaceContract?: string;
  /** O gesto só pode sair com a tela capturada no owner ou provada pela rota ancestral. */
  readonly requireOrigin?: boolean;
}

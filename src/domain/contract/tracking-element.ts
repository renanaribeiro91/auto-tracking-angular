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
}

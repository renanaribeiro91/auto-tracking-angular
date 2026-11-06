/** Contrato público e estático de interações de uma superfície criada por código. */
export interface TrackingSurfaceDefinition {
  readonly id: string;
  /** Gerada pelo CLI no próprio TypeScript; não preencher manualmente. */
  readonly ref?: string;
  readonly actions: readonly {
    readonly id: string;
    readonly selector: string;
    readonly elemento: string;
    readonly rotulo: string;
    /** Variações públicas comprovadas nos chamadores. */
    readonly rotulos?: readonly string[];
    readonly event?: 'click' | 'change' | 'ionChange' | 'submit';
    /** Atributo público da opção; nunca usar valores pessoais. */
    readonly optionAttribute?: string;
    /** Significado público comprovado no consumidor, em colchetes; só para a evidência. */
    readonly optionPlaceholder?: string;
    /** Atributo público com o rótulo da ação apresentado no gesto. */
    readonly labelAttribute?: string;
    readonly allowedOptions?: readonly string[];
  }[];
}

/** Mantém a declaração legível pelo compilador e pelo runtime, sem executar configuração. */
export function defineTrackingSurface<T extends TrackingSurfaceDefinition>(definition: T): T {
  return definition;
}

/** Contrato canônico: qualquer alteração semântica da superfície invalida sua ref. */
export function trackingSurfaceContract(definition: TrackingSurfaceDefinition): string {
  return JSON.stringify([definition.id, definition.actions.map((action) => [
    action.id, action.selector, action.elemento, action.rotulo, action.rotulos ?? null,
    action.event ?? 'click', action.optionAttribute ?? null, action.allowedOptions ?? null,
    action.optionPlaceholder ?? null, action.labelAttribute ?? null,
  ])]);
}

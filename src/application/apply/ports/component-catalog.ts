/** Metadados descobertos pelo adapter Angular e consumidos pelo caso de uso de marcação. */
export interface ComponentDef {
  readonly selectors: readonly string[];
  /** `projeto` ou nome do pacote npm */
  readonly source: string;
  /** nome público do output → propriedade da classe */
  readonly outputs: ReadonlyMap<string, string>;
  readonly inputs: ReadonlySet<string>;
  readonly template: string;
  /** nome do método → texto do corpo */
  readonly methods: ReadonlyMap<string, string>;
  /** listeners no próprio host (@HostListener / host: { '(click)': ... }) */
  readonly hostListeners: readonly { readonly event: string; readonly expr: string }[];
}

/** Catálogo de componentes disponível durante a marcação. */
export interface ComponentCatalog {
  get(tag: string, output?: string): ComponentDef | undefined;
}

/** Gesto DOM observável pelo runtime; `:host` representa o próprio componente. */
export interface OutputTrigger {
  readonly event: ObservableEvent;
  readonly selector: string;
  /** O próprio template do projeto recebe a marcação deste gesto. */
  readonly coveredByChild?: boolean;
  /** Overlay que recebe conteúdo projetado de um componente host. */
  readonly portal?: 'ion-modal';
}

/** Evento DOM publicado pelo componente Angular/Ionic. */
export type ObservableEvent = string;

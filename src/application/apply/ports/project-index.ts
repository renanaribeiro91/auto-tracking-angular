import type { ComponentDef } from './component-catalog.js';

/** Trecho editável de um template inline e sua localização no arquivo TypeScript. */
export interface InlineTemplate {
  readonly start: number;
  readonly end: number;
  readonly quote: '`' | '"' | "'";
  readonly line: number;
}

/** Componente Angular normalizado para as regras de descoberta e marcação. */
export interface ComponentInfo {
  /** Identidade de declaração, distinta mesmo quando há classes homônimas. */
  readonly key: string;
  readonly className: string;
  readonly tsFile: string;
  readonly templateFile: string | null;
  readonly inlineTemplate: boolean;
  /** null quando o template inline tem interpolação ${} e não pode ser editado com segurança */
  readonly inline: InlineTemplate | null;
  readonly def: ComponentDef;
  /** texto completo da classe: referências a outros componentes e serviços */
  readonly classText: string;
  /** Propriedade injetada → identidade da classe de serviço correspondente. */
  readonly serviceDependencies: ReadonlyMap<string, string>;
  /** Métodos e efeitos da classe usados para relacionar chamadas e ações. */
  readonly methods: ReadonlyMap<string, string>;
  /** Referências TypeScript resolvidas para outras declarações de componente. */
  readonly referencedComponents: ReadonlySet<string>;
}

export interface ServiceInfo {
  readonly key: string;
  readonly className: string;
  readonly tsFile: string;
  readonly text: string;
  readonly methods: ReadonlyMap<string, string>;
  /** Propriedade injetada → identidade da classe de serviço correspondente. */
  readonly dependencies: ReadonlyMap<string, string>;
  /** Método → componentes que o método abre diretamente. */
  readonly openedComponents: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Resultado da leitura estrutural do projeto Angular, independente do compilador usado. */
export interface ProjectIndex {
  readonly components: readonly ComponentInfo[];
  /** Identidades de componentes usados em rotas, sem colisões por nome de classe. */
  readonly routedComponents: ReadonlySet<string>;
  /** Rotas sem importação resolvível cujo nome aponta para mais de uma declaração. */
  readonly ambiguousRoutes: readonly { readonly file: string; readonly className: string; readonly line: number }[];
  /** identidade do componente que abre → identidades dos componentes abertos. */
  readonly opens: ReadonlyMap<string, ReadonlySet<string>>;
  /** Identidade de declaração do serviço → contrato estático usado pelo resolver. */
  readonly services: ReadonlyMap<string, ServiceInfo>;
  /** chamadas provideAutoTracking(<config>.runtime) encontradas (prova de ligação no bootstrap) */
  readonly providerCalls: number;
}

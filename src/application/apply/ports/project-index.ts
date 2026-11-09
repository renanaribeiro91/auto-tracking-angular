import type { ComponentDef } from './component-catalog.js';
import type { TrackingSurfaceDefinition } from '../../../domain/contract/tracking-surface.js';

export interface SurfaceDeclaration {
  readonly ownerKey?: string;
  readonly method?: string;
  readonly componentKey: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly refStart?: number;
  readonly refEnd?: number;
  readonly definition: TrackingSurfaceDefinition;
}

/** Trecho editável de um template inline e sua localização no arquivo TypeScript. */
export interface InlineTemplate {
  readonly start: number;
  readonly end: number;
  readonly quote: '`' | '"' | "'";
  readonly line: number;
}

/** Componente Angular normalizado para as regras de descoberta e marcação. */
export interface ComponentInfo {
  readonly baseClass?: string;
  readonly initializers?: ReadonlySet<string>;
  readonly methodComponents?: ReadonlyMap<string, ReadonlySet<string>>;
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
  readonly baseClass?: string;
  readonly initializers?: ReadonlySet<string>;
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

export type OverlayDeclaration = Pick<OverlaySite, 'titulo' | 'semTitulo' | 'botoes' | 'listas' | 'componente' | 'props'>;
export type OverlayVariant = OverlayDeclaration & { readonly ownerKey: string; readonly method: string };

/** Resultado da leitura estrutural do projeto Angular, independente do compilador usado. */
export interface OverlaySite {
  readonly componentKey: string;
  readonly elemento: string;
  /** Título literal da chamada; ausente quando só é conhecido em runtime. */
  readonly titulo?: string;
  /** A chamada comprovadamente não define título: em runtime o contexto é o tipo do overlay. */
  readonly semTitulo?: boolean;
  /** Textos dos botões declarados na abertura (`null` = só conhecido em runtime); ausente se a abertura não os define. */
  readonly botoes?: readonly (string | null)[];
  /** Propriedades de onde `botoes` foi lido. */
  readonly listas?: readonly string[];
  /** Classe do componente de biblioteca apresentado. */
  readonly componente?: string;
  /** Opções conhecidas: literal de texto, `false` ou `true` (presente com outro valor). Ausente se não forem conhecidas. */
  readonly props?: ReadonlyMap<string, string | boolean>;
  /** Abertura por método com parâmetros: o que cada chamada comprova, com a classe e o método de onde ela parte. */
  readonly variantes?: readonly OverlayVariant[];
  /** Método de serviço que abre o overlay; sem chamada em produção, a abertura nunca acontece. */
  readonly abertura?: { readonly ownerKey: string; readonly method: string };
  readonly origem: string;
  readonly file: string;
  readonly line: number;
}

export interface ProjectIndex {
  readonly dynamicMethodValues?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly eagerServices?: ReadonlySet<string>;
  /** Arquivos que importam a API pública, para reconciliação AST do contrato de integração. */
  readonly trackingFiles?: readonly string[];
  readonly surfaces?: readonly SurfaceDeclaration[];
  readonly surfaceErrors?: readonly { readonly file: string; readonly line: number; readonly message: string }[];
  readonly components: readonly ComponentInfo[];
  /** Identidades de componentes usados em rotas, sem colisões por nome de classe. */
  readonly routedComponents: ReadonlySet<string>;
  /** Textos que o código comprova para uma expressão do template do componente; `null` se algum caminho só existe em runtime. */
  readonly displayTexts?: (componentKey: string, expression: string) => readonly string[] | null;
  /** Rotas-casca: sempre descem para um filho, logo não emitem screen_view próprio. */
  readonly shellComponents?: ReadonlySet<string>;
  /** Rotas sem importação resolvível cujo nome aponta para mais de uma declaração. */
  readonly ambiguousRoutes: readonly { readonly file: string; readonly className: string; readonly line: number }[];
  /** identidade do componente que abre → identidades dos componentes abertos. */
  readonly opens: ReadonlyMap<string, ReadonlySet<string>>;
  /** Identidade de declaração do serviço → contrato estático usado pelo resolver. */
  readonly services: ReadonlyMap<string, ServiceInfo>;
  /** Alias de import TypeScript → identidade do módulo/action, para vincular effects sem colisões. */
  readonly actionImports?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Componente aberto por API de overlay (modal, dialog, popover, sheet) → tipo enviado em `elemento`. */
  readonly overlayComponents?: ReadonlyMap<string, string>;
  /** Aberturas de overlay sem template no projeto: a visualização entra no relatório pelo ponto do código. */
  readonly overlaySites?: readonly OverlaySite[];
  /** chamadas provideAutoTracking(<config>.runtime) encontradas (prova de ligação no bootstrap) */
  readonly providerCalls: number;
}

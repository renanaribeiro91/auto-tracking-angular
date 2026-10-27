# Arquitetura e contrato

## Visão geral

A biblioteca tem duas metades, que compartilham só o domínio (`src/domain/`):

| Metade | Onde roda | Código | Responsabilidade |
|---|---|---|---|
| **Motor (CLI)** | Node, na máquina do dev e na esteira | `src/cli/`, `src/application/`, `src/adapters/angular-compiler/`, `src/adapters/filesystem/`, `src/adapters/reports/` | Ler a config por AST, indexar componentes e rotas, gravar as marcações `data-at-*` nos templates, gerar `relatorio.json` e a planilha |
| **Runtime** | Bundle do app (browser/WebView) | `src/index.ts`, `src/angular/`, `src/adapters/runtime/`, `src/domain/` | Ouvir gestos, resolver owner e ambiente, montar o payload, validar pelo schema e enviar pelo `send` do app |

O runtime nunca importa `fs`, `typescript` ou `exceljs`. O pacote expõe duas entradas: `.` (runtime) e `./config` (`defineAutoTrackingProject`). O aplicativo fornece o preset com schema e mapas de ambiente.

```
auto-tracking.config.ts ──AST──▶ CLI apply ──▶ templates com data-at-*  ──build──▶ app
                                     │                                          │
                                     ├──▶ .auto-tracking/relatorio.json         └─ provideAutoTracking ─▶ click / screen_view ─▶ send()
                                     └──▶ .auto-tracking/evidencia-tagueamento.xlsx
```

## Fluxo do `apply`

1. **Config:** `auto-tracking.config.ts` é lido por parse sintático; nada é executado. São extraídos `projects`, `output`, `runtime.owner`, `runtime.product`, `preset` e `branding`.
2. **Índice AST** (`project-index.ts`): para cada projeto, a raiz varrida é a pasta `src/` ao lado do `tsconfig` informado (ou o `sourceRoot` do `angular.json`). O índice coleta componentes (`templateUrl` e `template` inline), classes roteadas (`component:` e `loadComponent`) e chamadas `provideAutoTracking(<config>.runtime)`.
3. **Marcação** (`tagger.ts`): cada elemento com `(click)` ou `(ionChange)` recebe os atributos de interação; o primeiro elemento renderizado de um componente roteado recebe o marcador de tela.
4. **Escrita protegida:** só arquivos que mudaram são gravados, de forma atômica. Se um arquivo mudou durante a execução, o lote inteiro é desfeito.
5. **Saídas:** `relatorio.json` e a planilha são regravados só quando o conteúdo muda; `cache/estado.json` guarda o fingerprint das entradas.

O `verify` executa o mesmo cálculo em memória e não escreve nada. O cache reutiliza os artefatos somente depois de reanalisar as fontes e as dependências instaladas; não substitui a prova atual por um fingerprint antigo. Avisos e falhas usam a mesma política com ou sem cache.

O relatório e a planilha registram `opcao_selecionada_1` como dinâmica quando o gesto comprovado fornece uma escolha. No runtime, esse parâmetro é separado do `rotulo`: controles de mudança usam o texto da opção correspondente; objetos sem opção correspondente não são convertidos em texto inventado. Em componentes repetidos, um clique pode fornecer opção numérica quando a análise comprova a emissão direta de um input numérico e uma origem literal nos consumidores. Outras origens não são inferidas por essa regra. Rótulos dinâmicos não são conhecidos em tempo de geração; o runtime lê o atributo acessível ou o texto disponível no momento do evento.

Formulários com `(ngSubmit)` ou `(submit)` são capturados pelo evento DOM `submit`, inclusive por teclado. Inputs continuam excluídos. A cobertura no template filho é explícita, evitando marcar novamente o output no pai. IDs duplicados são reconciliados e o tipo de evento é atualizado quando o binding muda.

Seletores internos devem identificar a mesma ação em todos os elementos que alcançam. Posições são usadas somente para irmãos estáticos comprovados; estruturas dinâmicas ambíguas permanecem sem prova. Bindings de outputs sem produtor, gesto DOM ou âncora comprovados ficam fora do escopo instrumentado e não geram evento, diagnóstico nem bloqueio. Ausência de provider impede o funcionamento do tagueamento suportado e bloqueia a validação. O contrato atual não certifica qualquer estrutura Angular/Ionic nem substitui validação real de overlays, Shadow DOM e navegação.

## Compatibilidade com bibliotecas de componentes

O motor descobre componentes Angular por metadados publicados no pacote (`ɵɵngDeclareComponent`) e Web Components Stencil pelo `dist/docs.json` instalado. No caso Stencil, somente eventos com `bubbles: true` e `composed: true` são considerados observáveis por delegação; evento público não equivale automaticamente a clique de negócio. O runtime instala listeners dos eventos realmente presentes em `data-at-event`/`data-at-outputs`, sem tabela fixa de marcas ou versões.

- Inputs nativos e controles de **digitação** do Design System não geram ações de analytics por foco, blur, input, teclas ou alteração de texto. Um componente composto com `input` no nome, como um card de documento ou chip removível, **não** é excluído sem verificar seu gesto real.
- `click`, navegação, seleção de uma opção e comandos públicos de botões podem ser rastreados quando o fluxo DOM→componente→owner é comprovado. Outputs de estado, dismiss, abertura ou transição não são cliques apenas por terem sido emitidos.
- O nome e a semântica de CustomEvents públicos vêm dos metadados da versão instalada. Novos pacotes não devem exigir regras hardcoded no motor; evento não propagado fica fora do escopo até existir integração pública verificável; nunca recebe emissão inventada.
- Overlays explicitamente marcados carregam sua tela/owner de origem; uma tela global de outro MFE não pode atribuir um clique a uma origem diferente. Sem origem confiável, o runtime não envia.
- A validação de compatibilidade deve usar a versão **resolvida em node_modules** e testar, além de `apply × 2`/`verify`, CustomEvents com owner concorrente, inputs excluídos, eventos técnicos ignorados e overlays com/sem origem. Testes de unidade não equivalem a certificação E2E.

## Contrato dos atributos

| Atributo | Onde | Valor |
|---|---|---|
| `data-at-id` | elemento interativo | ID estável da interação |
| `data-at-owner` | todos os marcados | `runtime.owner` do projeto (ex.: `app`, `mfe`) |
| `data-at-funcionalidade` | todos os marcados | derivado do caminho do template |
| `data-at-subfuncionalidade` | todos os marcados | nome do componente |
| `data-at-elemento` | elemento interativo | `botao`, `link`, `dropdown`, `checkbox`, `accordion`, `lista` ou `filtro` |
| `data-at-event` | `ion-select`, `ion-checkbox`, `ion-toggle`, `ion-segment`… | `ionChange` (padrão: `click`) |
| `data-at-screen` | 1º elemento renderizado do componente roteado | ID da tela |

**Reconciliação:**
- IDs e rótulos existentes são preservados; ajustes manuais nesses valores são suportados.
- `data-at-owner`, funcionalidade e tela são derivados da configuração/estrutura atuais e sempre são reconciliados pelo comando.
- Atributos ausentes são repostos.
- Um atributo sem prova atual sai do template: o handler foi removido, o componente deixou de ser roteado ou o atributo foi descontinuado.

### Derivação (válida para qualquer projeto Angular)

- **Tela** (`data-at-tela`): nome do arquivo da tela, sem `.page`/`.component`.
- **Módulo** (`data-at-funcionalidade`, aba da planilha): a pasta mais próxima acima da tela que tenha `common/constants` ou `common/enums` (padrão do time); sem ela, a pasta-mãe da tela. Pastas técnicas do Angular/Ionic (`pages`, `components`, `modals`, `shared`, `core`, `containers`, `features`…) nunca viram módulo.
- **Unicidade**: duas telas nunca compartilham `módulo:tela`. Se colidirem, só as envolvidas são refinadas — primeiro pela pasta da tela e depois pelo caminho completo. Se uma rota usa um nome de classe homônimo sem import que identifique a declaração, o CLI registra `ROUTED_COMPONENT_AMBIGUOUS` em vez de associar as telas por engano.
- Módulo e tela são sempre regravados a partir da estrutura atual (mudou a pasta, o template acompanha). O `data-at-id` é estável entre execuções.
- **ID**: `<módulo>-<tela>-<nome>`, `nome` = primeiras palavras do texto visível estático (sem `@if`/`@for`, sem URL) ou do handler. O owner não compõe o ID; trocar `runtime.owner` atualiza todos os atributos de ownership mantendo IDs estáveis.
- **Tela de um componente**: o motor sobe até a rota por todos os caminhos de Angular — seletor em template, referência na classe, cadeia de serviços (inclusive `ModalService`/use-cases) e effects NgRx (pela action despachada). Componente sem nenhum uso e a casca do app (`app-root`) não entram na planilha; no runtime, emitem com a tela onde o usuário está.

## Runtime

- Um listener de captura por owner na página. Os bundles do host e dos MFEs compartilham um registro global, então carregar o módulo várias vezes não duplica listener.
- Em cada `click`/`ionChange`, `composedPath()` localiza o elemento marcado mais interno. Isso atravessa Shadow DOM aberto; em Shadow DOM fechado o evento é retargetado ao host marcado.
- Só a instância cujo owner está gravado no elemento emite. Isso vale também para modais teleportados para o `body`.
- **`screen_view`:** a cada `NavigationEnd` com URL nova, o runtime localiza o componente roteado mais profundo (`reflectComponentType`) e emite pelo marcador do primeiro filho do host, se o owner for o seu.
- **Ambiente:**
  - nativo: `App.getInfo().id` com busca exata no preset, com cache;
  - Web: `getWebTheme` relido a cada evento.

  Se o ambiente não resolve, o runtime não envia e avisa no console.
- **Validação:** todo evento passa pelo schema do preset antes do `send`; evento inválido é descartado com aviso.

### Payload

| Campo | `click` | `screen_view` |
|---|---|---|
| `ambiente` | resolvido pelo preset do aplicativo | idem |
| `produto` | `runtime.product` | idem |
| `funcionalidade`, `subfuncionalidade` | dos atributos | idem |
| `tela` | `<ambiente>:<produto>:<funcionalidade>:<subfuncionalidade>` | idem |
| `categoria` | igual a `tela` | — |
| `acao` | `clique` | `visualizacao` |
| `elemento` | `data-at-elemento` | `tela` |
| `rotulo` | texto visível no instante do gesto | — |
| `opcao_selecionada_1` | opção escolhida (`ionChange`) | — |

### Identidade de ambiente

O preset informado pelo aplicativo define os IDs nativos e temas Web aceitos, com busca exata. O schema também pertence ao preset.

## Saídas

| Arquivo | Conteúdo |
|---|---|
| `relatorio.json` | `entries[]` (uma por interação/tela) e `diagnostics[]`; sem timestamp, determinístico |
| `evidencia-tagueamento.xlsx` | **Resumo** (indicadores e índice de módulos) e **uma aba por módulo**; componentes que nenhuma rota alcança ficam em **Componentes globais**. Identidade visual configurável; sem dado de usuário |
| `cache/estado.json` | Fingerprint das entradas e hashes do relatório e da planilha; independe de máquina |

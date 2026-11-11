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

O relatório e a planilha registram `opcao_selecionada_1` como dinâmica quando o gesto comprovado fornece uma escolha. No runtime, esse parâmetro é separado do `rotulo`: controles de mudança usam o texto da opção correspondente; objetos sem opção correspondente não são convertidos em texto inventado. Em componentes repetidos, um clique pode fornecer opção numérica quando a análise comprova a emissão direta de um input numérico e uma origem literal nos consumidores. Outras origens não são inferidas por essa regra. O `rotulo` enviado é sempre o da planilha: texto variável (interpolação, `@Input`, store, API) não é enviado, pois pode conter dados pessoais; nesses casos o rótulo é o nome da ação. Quando o rótulo vem de um item de `*ngFor`/`@for` sobre uma lista literal da classe (`[title]="item.titulo"`), o CLI grava os valores possíveis e o runtime envia o do item clicado somente se for um deles.

Um select marcado para `change` ou `ionChange` emite a abertura no clique do controle e a escolha no evento de mudança. Radio e checkbox emitem somente a mudança. Se uma biblioteca renderiza as opções fora do controle, como em um portal, a mudança Angular do host não prova o clique físico na opção. Nesse caso o consumidor declara as ações com `defineTrackingSurface` no método TypeScript que cria o portal. O CLI gera a `ref` nessa declaração e as mesmas entradas no relatório e na planilha. `AutoTrackingSurfaces.attach` vincula a raiz pública do portal à declaração e à tela capturada antes do primeiro `await`. A opção só é enviada se pertencer à lista de valores públicos permitidos; valores desconhecidos não produzem evento. O vínculo termina no fechamento do portal. Para modal aberto por código, o mesmo registro preserva a origem nas ações já marcadas pelo CLI; a abertura propriamente dita exige evento programático explícito pelo `TRACKING_DISPATCHER`. Essa integração não associa overlays por ordem de abertura, classe global ou tela atual do documento.

Formulários com `(ngSubmit)` ou `(submit)` são capturados pelo evento DOM `submit`, inclusive por teclado. Inputs continuam excluídos. A cobertura no template filho é explícita, evitando marcar novamente o output no pai. IDs duplicados são reconciliados e o tipo de evento é atualizado quando o binding muda.

Seletores internos devem identificar a mesma ação em todos os elementos que alcançam. Posições são usadas somente para irmãos estáticos comprovados; estruturas dinâmicas ambíguas permanecem sem prova. Bindings de outputs sem produtor, gesto DOM ou âncora comprovados ficam fora do escopo instrumentado e não geram evento, diagnóstico nem bloqueio. Ausência de provider impede o funcionamento do tagueamento suportado e bloqueia a validação. O contrato atual não certifica qualquer estrutura Angular/Ionic nem substitui validação real de overlays, Shadow DOM e navegação.

## Compatibilidade com bibliotecas de componentes

O motor descobre componentes Angular por metadados publicados no pacote (`ɵɵngDeclareComponent`) e Web Components Stencil pelo `dist/docs.json` instalado. No caso Stencil, somente eventos com `bubbles: true` e `composed: true` são considerados observáveis por delegação; evento público não equivale automaticamente a clique de negócio. No modo `classic` o runtime instala listeners para `data-at-event` e `data-at-outputs`; no modo `ref` decodifica o token de `data-at-ref` uma vez (cache LRU) e instala listeners para os gestos nele descritos.

- Inputs nativos e controles de **digitação** do Design System não geram ações de analytics por foco, blur, input, teclas ou alteração de texto. Um componente composto com `input` no nome, como um card de documento ou chip removível, **não** é excluído sem verificar seu gesto real.
- `click`, navegação, seleção de uma opção e comandos públicos de botões podem ser rastreados quando o fluxo DOM→componente→owner é comprovado. Outputs de estado, dismiss, abertura ou transição não são cliques apenas por terem sido emitidos.
- O nome e a semântica de CustomEvents públicos vêm dos metadados da versão instalada. Novos pacotes não devem exigir regras hardcoded no motor; evento não propagado fica fora do escopo até existir integração pública verificável; nunca recebe emissão inventada.
- Overlays explicitamente marcados carregam sua tela/owner de origem; uma tela global de outro MFE não pode atribuir um clique a uma origem diferente. Sem origem confiável, o runtime não envia.
- A validação de compatibilidade deve usar a versão **resolvida em node_modules** e testar, além de `apply × 2`/`verify`, CustomEvents com owner concorrente, inputs excluídos, eventos técnicos ignorados e overlays com/sem origem. Testes de unidade não equivalem a certificação E2E.

## Contrato de atributos do modo `classic`

| Atributo | Onde | Valor |
|---|---|---|
| `data-at-id` | elemento interativo | ID estável da interação |
| `data-at-owner` | todos os marcados | `runtime.owner` do projeto (ex.: `app`, `mfe`) |
| `data-at-funcionalidade` | todos os marcados | derivado do caminho do template |
| `data-at-elemento` | elemento interativo | `botao`, `link`, `dropdown`, `checkbox`, `accordion`, `lista` ou `filtro` |
| `data-at-event` | `ion-select`, `ion-checkbox`, `ion-toggle`, `ion-segment`… | `ionChange` (padrão: `click`) |
| `data-at-screen` | 1º elemento renderizado do componente roteado | ID da tela |

**Reconciliação:**
- IDs existentes são preservados. No modo `classic`, rótulo manual legível é preservado; rótulo técnico (`btn-…`, `on-…`, `click…`) é regenerado.
- `data-at-owner`, funcionalidade e tela são derivados da configuração/estrutura atuais e sempre são reconciliados pelo comando.
- Atributos ausentes são repostos no modo `classic`; em `ref`, apenas o token inteiro é recalculado quando o contrato semântico muda.
- Um atributo sem prova atual sai do template: o handler foi removido, o componente deixou de ser roteado ou o atributo foi descontinuado.

### Derivação (válida para qualquer projeto Angular)

- **Escadinha pela rota** (fonte de verdade): o CLI monta a árvore de rotas só pelo código — `RouterModule.forRoot/forChild`, `provideRouter`, `children` (literal, constante ou import), arrays espalhados (`[...a, ...b]`), `loadChildren` (módulo com routing module próprio, arquivo de rotas com export nomeado ou `default`) e `loadComponent`. O `path` pode ser literal, template, constante, membro de enum ou de objeto constante, inclusive importado por barrel. Do caminho `s1/s2/…/sn` (sem parâmetros `:id`): **funcionalidade** = `s1` (aba da planilha), **subfuncionalidade** = `s2` e **tela** = `s1:s2:…:sn`. Exemplo: `reembolso/calcular-reembolso/dados-procedimento` → `reembolso` / `calcular-reembolso` / `…:reembolso:calcular-reembolso:dados-procedimento`. Cada nível leva o nome que o produto lê: versão do código (`-v2`, `_v3`) sempre sai — as duas gerações de um fluxo são o mesmo passo para o produto; tecnologia (`iframe`, `webview`), estrutura de UI (`page`, `modal`…), a palavra `tela` (salvo quando é o único nome) e letra solta saem; o nome do pai como **prefixo** sai (`loja/loja-produtos` → `loja:produtos`), como sufixo fica, pois é o objeto da ação (`pedidos/cancelar-pedidos`); nível igual ao anterior colapsa. **Invariante:** rota filha com outro componente nunca vira a tela de uma rota ancestral — se a limpeza a colapsaria, o último nível fica com o nome declarado na rota, ainda sem versão (`ajuda` e `ajuda/iframe-ajuda` → `ajuda` e `ajuda:iframe-ajuda`), porque é outro passo do funil.
- **Página em mais de uma rota** (ex.: página intermediária em `reembolso/opcao-reembolso` e `extratos/opcao-extrato`): é tela nos dois caminhos. O marcador leva os padrões de rota (slot de rotas no token `ref` ou `data-at-routes` no `classic`), e o runtime escolhe pela rota ativa (casamento pelo fim do caminho, o que funciona sob o prefixo do host em MFE). Fora dos caminhos provados, não envia.
- **Sem rota provada** (array de rotas não registrado, rotas montadas em runtime, módulo só reexportado por barrel e montado por um host fora do projeto): vale a derivação por pastas abaixo, sem diagnóstico. `loadChildren` relativo para arquivo inexistente ou por alias do tsconfig não resolvido gera `ROUTE_LAZY_UNPROVEN` (não bloqueante). Rota **sem** `component` que carrega módulo sem rotas também gera o diagnóstico, com o componente que o módulo declara como sugestão: o Angular não renderiza nada nesse caminho, logo nenhum evento sai dele; com `component` próprio, o módulo vazio é só lazy loading e não há diagnóstico.
- **Tela por pastas** (fallback, `data-at-tela`): nome do arquivo da tela, sem `.page`/`.component`.
- **Módulo por pastas** (fallback): a pasta mais próxima acima da tela que tenha `common/constants` ou `common/enums` (padrão do time); sem ela, a pasta-mãe da tela. Pastas técnicas do Angular/Ionic (`pages`, `components`, `modals`, `shared`, `core`, `containers`, `features`…) nunca viram módulo.
- **Unicidade** (fallback por pastas): duas telas nunca compartilham `módulo:tela`. Se colidirem, só as envolvidas são refinadas — primeiro pela pasta da tela e depois pelo caminho completo. Se uma rota usa um nome de classe homônimo sem import que identifique a declaração, o CLI registra `ROUTED_COMPONENT_AMBIGUOUS` em vez de associar as telas por engano.
- Módulo e tela são sempre regravados a partir da estrutura atual (mudou a pasta, o template acompanha). O ID gerado para o mesmo gesto é estável entre execuções.
- **ID**: `<módulo>-<último nível da tela>-<nome>`, `nome` = primeiras palavras do rótulo.
- **Rótulo**, em ordem: `aria-label`/`label`/`title`/`texto`/`text`/`titulo`/`rotulo` humanos (estáticos ou literal ligado); texto próprio do elemento (em componente customizado, só se curto, pois o conteúdo é projetado); rótulo único de um filho; nome do handler sem palavras de código (`cliqueVoltar` → `voltar`, `removerItemAction` → `remover`) e sem a navegação no começo do método (`rotaAnexar` → `anexar`, `irParaPagamento` → `pagamento`; no texto visível, `Traçar rota` fica); verbo que pede objeto (`abrir`, `mostrar`, `exibir`, `ver`) e ficou sozinho porque o objeto era estrutura de UI (`mostraModal`) passa para a próxima fonte provada; `data-testid`/id de teste sem prefixo técnico. Nunca vazio. Glifo (`X`, `?`) não é texto. Estrutura de UI (`modal`, `tooltip`, `overlay`, `popover`, `header`, `page`, `item`…) e verbo em inglês (`crop` → `recortar`, `selection` → `selecionar`) saem de todo rótulo; `botão … da modal` do texto acessível também. Ação somada a título não repete a emenda (`excluir` + `excluir-arquivo` → `excluir-arquivo`). Corte por tamanho só em fronteira de palavra; entidades HTML (`hor&aacute;rio`) são decodificadas.
- **Página dirigida pelo `data` da rota** (mesma página em várias rotas, com conteúdo vindo de `data`): o CLI lê o `data` efetivo de cada rota como o Angular entrega: herança pela `paramsInheritanceStrategy` do projeto (configurada no código; sem ela, o padrão do `@angular/router` instalado — `emptyOnly` até a v21, `always` a partir da v22; sem versão provada, só vale o que as duas dão igual); o próprio `data` vence o herdado; chave de `resolve`/`resources` vence o estático e nunca é prova; constante local/importada vira valor e reconhece o membro alimentado por ele: `snapshot.data`, `data.subscribe` (com `pipe` só de operadores que não transformam o valor, parâmetro desestruturado), alias local do snapshot, cópia inteira (`Object.assign(this, d)`, `for (const [k, v] of Object.entries(d)) this[k] = v`) e `@Input`/`input()` com `withComponentInputBinding()`/`bindToComponentInputs` (sem a chave no `data`, o input recebe parâmetro da URL: não é prova). Cada tela lista só o que a sua rota mostra (`Um de: …`, ou o próprio rótulo quando é um só; tela cuja rota não traz a lista não tem o evento); o token leva a união, e o runtime envia o texto exibido só se estiver nela. Não é prova (o runtime segue lendo a tela): membro também escrito por outra fonte, valor inicial visível, operador que transforma o valor, valor de rota não literal, texto que é chave de código, rota sem tela própria ou página também usada por seletor/overlay.
- **Lista constante transformada** (laço aninhado `@for (item of secao.itens)` sobre membro que vem de constante local ou importada, por spread, `map`, `filter`/`slice`/`sort`/`concat`, ternário ou retorno de método): a tela lista os rótulos possíveis. Store, API, parâmetro desconhecido, mutação (`push`) ou spread de valor de runtime não são prova: o runtime segue com o que já fazia.
- **Casca de rota** (layout que só embrulha o outlet): não é tela — sem marcador nem `screen_view`. O que ela e o que ela embute disparam vale nas telas filhas daquela rota (relatório/planilha) e sai em runtime com a tela filha ativa; sem filha provada (MFE remoto), na tela de origem.
- **Overlay com template** (inline ou aberto por código): na apresentação, o runtime vincula o overlay que tem gestos do owner à tela visível do próprio owner, até o fechamento ou a remoção do DOM; vínculo declarado no código vence. O ciclo de vida segue a convenção de web components `<prefixo>ModalDidPresent`/`DidDismiss` (Ionic e design systems Stencil), derivado do nome do host (`*-modal`, `*-popover`, `*-sheet`…); só o evento disparado prova a apresentação.
- **Rótulo dinâmico em runtime**: texto principal vence slots (badge, ícone); com todo o texto em slots (card de web component), vale o slot de maior conteúdo. Texto vindo de input ligado (`[title]`, `[label]`, `[texto]`… ou, com gesto único que não é de escolha, `[xLabel]`/`[xTexto]`/`[xTitle]`) é enviado pelo valor exato da expressão: o CLI grava `[attr.data-at-label]="<expressão>"` e o runtime lê esse atributo (vazio, e-mail ou documento/telefone: o evento não sai). Em componente com várias ações, o texto do host nomeia só a ação cujo gatilho (seletor do `@Output`) mostra o input ou o `<ng-content>`. A planilha mostra `[<campo>]` quando a expressão é um caminho simples com campo específico (`[nome-tipo-documento]`) e `[rotulo-do-botao-exibido]` nos demais.
- **Dado pessoal** (nunca lido como rótulo): decidido por cada caminho `dono.campo` da expressão. Campo com palavra de identificação, conteúdo da pessoa ou medida (`cpf`, `endereco`, `valor`, `arquivo`, `distancia`…) ou de pessoa (`beneficiario`, `profissional`…); nome sem qualificador (`x.nome`, `x.name`) na dúvida; dono que é a pessoa ou um dado pessoal (`usuario.apelido`, `endereco.descricao`). Nome qualificado por coisa (`nomePlano`) e classificação (`tipoDocumento`, `statusConta`) são de catálogo.
- **Tipo declarado decide pessoa ou coisa**: o CLI resolve o tipo do dono de cada caminho (membro do componente; variável de `@for`/`*ngFor` pela lista, com `()` de signal e pipes) por interface/`type`/classe com `extends`, `signal<T>`, `input<T>`, `Observable<T>`, arrays e uniões com `null`, em arquivo local ou import relativo. Tipo com campo de identificação de pessoa (`cpf`, `rg`, `nascimento`, `email`, `telefone`, `celular`, `matricula`, `carteirinha`, `sexo`, `genero`) é pessoa: o nome e os campos dela não são lidos (classificação como `tipoPlano` continua permitida). Tipo resolvido sem esses campos é coisa. Sem tipo declarado (`any`, sem anotação, tipo de biblioteca), vale o significado das palavras.
- **Pessoa ou coisa sem tipo anotado**: o tipo vem da origem do valor quando o membro não é anotado (todas as atribuições e o inicializador precisam dar o mesmo tipo: `as T`, `http.get<T>`, retorno declarado ou retornado de método de serviço injetado por construtor ou `inject()`, parâmetro do callback de `subscribe`/`then`, `pipe` sem operador que transforma). Sem tipo, decidem: campo de pessoa física (`cpf`, `rg`, `nascimento`, `sexo`, `idade`, `matricula`, `carteirinha`) acessado na mesma variável no template; handler do gesto com entidade pessoa; núcleo de cada segmento do dono e da lista do laço (pessoa, registro da pessoa, dado pessoal). Substantivo de domínio é coisa; só nomes genéricos não provam coisa.
- **Escolha em laço**: o item é a variável do laço que o gesto recebe, no próprio elemento ou em volta. Com `*ngFor` no próprio elemento, qualquer gesto que recebe o item é escolha; com laço em volta, só verbo de escolha. Com verbo de escolha, o texto do item vai em `opcao_selecionada_1` e o rótulo é a ação. Valor de lista provada no código nunca é pessoal; fora dela, campo pessoal não vira opção.
- **Gesto de diretiva de atributo**: o catálogo lê diretivas pelo seletor declarado (`[x]`, `tag[x]`) em pacotes (`ɵɵngDeclareDirective`) e no projeto (`@Directive`), só as usadas nos templates. Output de diretiva que a própria classe emite (`this.<prop>.emit(`) e sem gesto DOM provado vira gatilho `emit:<output>` no host: o CLI grava o clique com o rótulo da ação (texto do container não nomeia o gesto) e `elemento: botao`; o runtime, via `subscribeOutput` do provider (`ɵgetDirectives` + `ɵdir.outputs`), escuta o `@Output` real e reemite `emit:<output>` no host, que segue o caminho do clique. Dois produtores do mesmo output no elemento não provam qual dispara: sem evento.
- **Componentes Ionic que agem sozinhos**: `ion-tab-button` com `tab` (clique com o texto da aba), `ion-back-button` (`voltar`), `ion-menu-button`/`ion-menu-toggle` (`abrir-menu`). `ionTabsDidChange` não é gesto: também dispara no carregamento e na troca programática.
- **Mesma ação, blocos diferentes** (modo `ref`): quando componentes diferentes enviariam o mesmo payload na mesma tela (`editar` nos dados do solicitante e nos do bebê), cada rótulo leva o nome de negócio do componente (`editar-dados-solicitante`, `editar-dados-bebes-resumo`). Só o rótulo do token muda: IDs ficam estáveis e a segunda execução não reescreve nada. O mesmo evento vindo de vários pontos do código é **uma** linha na planilha, com todas as origens (`Arquivo`/`Linha` separados por `; `).
- **Gesto repassado**: em componente do projeto, elemento sem texto próprio (`?`, ícone) cujo handler só emite um `@Output` é marcado no **uso**, com o handler de negócio (`<app-ajuda (onClick)="mostrarModalDadosBancarios()">` → `mostrar-dados-bancarios`); um único evento por gesto. Com texto próprio, o gesto continua no filho. O owner não compõe o ID; trocar `runtime.owner` atualiza todos os atributos de ownership mantendo IDs estáveis.
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

| Campo | `click` | `screen_view` | `visualizacao` (abertura de overlay) |
|---|---|---|---|
| `ambiente` | resolvido pelo preset do aplicativo | idem | idem |
| `produto` | `runtime.product` | idem | idem |
| `funcionalidade` | do contexto da tela (`classic`) ou do token (`ref`) | idem | da tela visível do owner que apresentou o overlay |
| `subfuncionalidade` | submódulo: 2º nível da rota (na raiz do módulo não é enviado); só se o schema do consumidor o aceita | idem | idem |
| `tela` | `<ambiente>:<produto>:<funcionalidade>:<subfuncionalidade>:…` (o caminho da rota); na raiz do módulo, só `<funcionalidade>` (`menu:menu` → `menu`) | idem | idem |
| `categoria` | igual a `tela` | — | igual a `tela` |
| `acao` | `clique` | não enviada | `visualizacao` |
| `elemento` | atributo (`classic`) ou token decodificado (`ref`); em overlay sem marcação, o tipo do overlay | não enviado | `modal`, `alerta`, `menu-de-opcoes` ou `popover` |
| `rotulo` | rótulo do contrato (igual à planilha); em item de lista estática, o valor provado do item clicado | — | título público do overlay; sem ele, o componente apresentado sem prefixo/sufixo técnico (`app-erro-generico-modal` → `erro-generico`); por último, o tipo. Clique em botão de overlay sem marcação: ação + título ou, sem título, ação + componente (`cancelar-recortar`); sem nenhum dos dois, só a ação (o tipo vai em `elemento`) |
| `opcao_selecionada_1` | opção escolhida (`ionChange`) | — | — |

A `visualizacao` sai no evento Ionic de apresentação (`ionModalDidPresent`, `ionAlertDidPresent`, `ionActionSheetDidPresent`, `ionPopoverDidPresent`). Fora do Ionic, sai quando o diálogo entra no DOM ou abre: `<dialog open>`, `mat-dialog-container`, `mat-bottom-sheet-container` e `[role=dialog][aria-modal=true]`/`[role=alertdialog]`, uma vez por abertura. O overlay interno de um `ion-select` não gera visualização, porque a abertura já é o clique do controle.

**Contrato estático (planilha = envio):** o CLI identifica os componentes passados a uma API de overlay, isto é, uma chamada cujo receptor tem `modal`, `dialog`, `popover` ou `sheet` no nome (`modalController.create({ component })`, `dialog.open(X)` ou um service do projeto). Na raiz do template desses componentes, grava o contrato da visualização (`id`, `elemento`, `rotulo`) no token `ref` ou em `data-at-view` (modo `classic`). O mesmo vale para `<ion-modal>`, `<ion-popover>`, `<ion-alert>` e `<ion-action-sheet>` declarados no template. O rótulo vem, nesta ordem, de `header`/`aria-label`, do primeiro título estático (`h1`–`h6`, `ion-title`) e do nome do componente pelo seletor (`app-erro-generico-modal` → `erro-generico`); num overlay inline, por último, do `trigger`/`[isOpen]` sem palavras técnicas. A planilha lista essas visualizações, e o runtime envia o contrato gravado, não o texto exibido no momento. Um overlay sem nome provado gera o diagnóstico `OVERLAY_NAME_UNPROVEN` e não é instrumentado: só o tipo (`modal`) não identifica o overlay no painel. Overlays de terceiros sem contrato usam o título exibido ou o componente apresentado; sem nenhum dos dois, não há envio e o console recebe um aviso.

**Rótulo de componente customizado:** inputs de texto (`texto`, `text`, `titulo`, `rotulo`, além de `aria-label`/`label`/`title`), estáticos ou ligados a item de lista literal (inclusive lista importada de outro arquivo), são o rótulo. Um nome derivado do handler que só repete o tipo do controle (`clickLink` → `link`) não é usado como rótulo.

### Identidade de ambiente

O preset informado pelo aplicativo define os IDs nativos e temas Web aceitos, com busca exata. O schema também pertence ao preset.

### Segurança e desempenho do runtime

O runtime deve ser passivo: nunca bloquear navegação, impedir clique ou transformar falha de analytics em exceção do aplicativo. Isso **não** autoriza esconder erros: falhas de descoberta, schema, ambiente e envio são reportadas por `warn`/console, separadas do fluxo de negócio.

- A instalação de listeners, observadores e timers ocorre fora da `NgZone` quando disponível, evitando trabalho adicional de detecção de mudanças causado exclusivamente pelo tracking.
- A descoberta de marcadores usa `DomDiscoveryScheduler`: varredura por `TreeWalker` incremental, até 160 elementos e orçamento cooperativo de 3 ms por rodada. O agendamento usa `requestIdleCallback` (com limite para não ficar sem progresso) ou cede um frame em WebViews antigas. Gestos DOM padrão são registrados de imediato; hosts customizados adicionados são descobertos prioritariamente. A fila tem limite e sinaliza sobrecarga por diagnóstico `DOM_DISCOVERY_OVERLOAD`, com recuperação incremental, em vez de acumular trabalho ilimitadamente.
- A varredura inicial é limitada a `runtime.root` quando o host está disponível; overlays projetados para fora dele ainda são observados no documento.
- O teardown desconecta observadores, remove listeners, cancela tarefas e impede envio quando o ambiente só se resolve após a destruição da origem.
- Duas injeções com o mesmo `owner` em um `Document` compartilham uma única sessão ativa; ao destruir a sessão ativa, outra instância previamente registrada pode assumir. Outros documentos são isolados.
- O cache LRU de tokens limita quantidade de entradas e tamanho aproximado de contratos/strings decodificados (2 MiB por padrão); evita crescimento ilimitado em uma WebView de longa duração.
- Consultas concorrentes de identidade são agrupadas; o ID do bundle nativo é lido uma vez por sessão, com janela de cinco segundos antes de repetir uma chamada que falhou. Bundle não mapeado continua produzindo diagnóstico explícito, mas não aciona a ponte a cada clique. O tema Web continua sendo relido em eventos posteriores.
- Mudanças rápidas de rota cancelam `screen_view` atrasados de uma rota anterior. Erros do adaptador, schema e identificação permanecem observáveis e não são convertidos em sucessos artificiais.

**Evidência de regressão:** `npm run check`, especialmente `test/runtime/dom-discovery-scheduler.spec.ts`, `test/runtime/dom-tracker.spec.ts` e `test/runtime/provider-lifecycle.spec.ts`. A verificação em Chrome headless com ~18 mil elementos DOM, dois owners, 20 cliques de negócio e um CustomEvent registrou 21 emissões corretas, zero diagnósticos e 1,4 ms para instalar os dois trackers. A verificação no Safari do simulador iOS com ~10 mil elementos e 15 cliques registrou 15 emissões e zero diagnósticos, com instalação em 2 ms. Essas medições são locais e não constituem limite universal de desempenho.

**Gate que essas evidências não substituem:** instrumentar e observar uma aplicação Angular/Ionic real em WKWebView/Android WebView, com o adaptador real, a inicialização nativa, a carga de telas lazy/overlays e repetição de navegações. A causa original do crash em produção não foi comprovada por esses testes isolados.

## Saídas

| Arquivo | Conteúdo |
|---|---|
| `relatorio.json` | `entries[]` (uma por ponto do código: onde está e `eventos[]`, os parâmetros de cada disparo, da mesma fonte da planilha; parâmetro do evento não se repete fora de `eventos`) e `diagnostics[]`; sem timestamp, determinístico |
| `evidencia-tagueamento.xlsx` | **Resumo** (indicadores e índice de módulos) e **uma aba por módulo**; componentes que nenhuma rota alcança ficam em **Componentes globais**. Identidade visual configurável; sem dado de usuário |
| `cache/estado.json` | Fingerprint das entradas e hashes do relatório e da planilha; independe de máquina |

## Contrato `ref`: token autocontido, sem manifesto externo

A biblioteca permite dois modos explícitos de geração e execução (`runtime.mode: 'classic' | 'ref'`). O padrão é `classic`, que mantém os atributos do contrato original. FED/MOB usam `ref`, com **somente `data-at-ref`** nos elementos observáveis.

```html
<bsds-button data-at-ref="v1.eJ..." (bsdsClick)="excluir()">Excluir {{ nome }}</bsds-button>
```

O valor acima é ilustrativo; um token real é gerado pelo CLI e usa DEFLATE (formato versionado `v1.` + base64url), não criptografia nem hash irreversível. Ele embute `owner`, funcionalidade, tela, ID, tipo de evento, elemento, rótulo de fallback, `@Output`, seletor e regras de opção. Nenhum ID é descoberto pelo prefixo do token. O runtime detecta o gesto no DOM/Shadow DOM, decodifica o token em cache LRU limitado, captura os dados dinâmicos e valida pelo schema **antes** de chamar `send`/AnalyticsAdapter. O token não é enviado ao Firebase.

**Sem outro manifesto**: `relatorio.json` fica somente na geração/CI, com `entries[]`, `diagnostics[]` e o token na propriedade `ref` de cada entrada em modo ref. O app **não importa o JSON em runtime** nem usa `trackingManifest`, não faz fetch e não precisa de módulo TypeScript gerado. A planilha mantém os mesmos campos de auditoria, sem coluna `ref`.

No modo `classic`, o CLI gera o contrato original `data-at-id`, `data-at-owner`, `data-at-event`, `data-at-elemento`, `data-at-rotulo`, `data-at-outputs` e demais atributos necessários. O runtime lê esses atributos como antes. A configuração de build deve usar o **mesmo modo do CLI e do provider**; tokens de modo diferente não são consumidos. O primeiro `tracking` cria ou reconcilia os eventos; a segunda execução deve escrever zero arquivos. Referências malformadas não são decodificadas nem geram eventos.

Valores selecionados não são congelados no token: o runtime consulta o `detail` do evento no instante da interação. Parâmetro obrigatório vazio é rejeitado pelo schema e não é enviado (evita `(not set)`). Listeners do documento são removidos quando o provider é destruído. O runtime usa só a build de descompressão do pako (43 KB minificado, 15,5 KB gzip no total); a compressão fica no CLI. Ambos os modos precisam ter os caminhos causais validados com o adaptador real antes do deploy.

# Changelog

## 2.2.3 — 2026-11-06

### Hooks

- A trava de versão confere só o `package.json`; lockfile não é versionado em todo app.
- `package-lock.json` deixa de ser fonte do tagueamento: lock alterado e não commitado não bloqueia mais o push.

## 2.2.2 — 2026-11-06

### Hooks

- `pre-commit` e `pre-push` bloqueiam quando a lib em `node_modules` não é a travada no `package-lock.json` ou não satisfaz o `package.json` (inclusive build local `-dev`): o tagueamento nunca é gerado nem verificado por outra versão. A conferência fica no próprio bloco do hook, então vale mesmo com uma lib antiga instalada. Atualize o bloco com `npx auto-tracking hooks install`.

## 2.2.1 — 2026-11-06

### Overlays criados por código

- Botão Ionic (`ion-button`) em modal/alert sem marcação passa a gerar `click`: o alvo é o host com o texto projetado, não o `<button>` interno do shadow DOM (que só contém `<slot>`).
- `elemento` informa o tipo do overlay (`modal`, `alerta`, `menu-de-opcoes`, `popover`) e o `rotulo` leva o contexto: `<acao>-<titulo-do-overlay>` (ex.: `ok-desculpe`), lido de `aria-labelledby`, `aria-label` ou do cabeçalho visível. Sem título público (ou título com dado pessoal), o contexto é o tipo do overlay.

## 2.2.0 — 2026-11-06

### Segurança (SCA)

- `exceljs` 4.4.0 substituído por `exceljs-hardened@5.1.0` (MIT), somente no CLI. A árvore distribuída não contém mais `exceljs@4.4.0`, `unzipper@0.10.14` nem `bluebird@3.4.7`.
- Leitura e escrita de XLSX com limites de ZIP/descompressão/PNG, validação de caminhos e links, e branding restrito à raiz real do consumidor (inclusive symlink).

### Tagueamento

- Só interações efetivamente usadas recebem eventos; metadados de componentes, métodos e superfícies sem uso são removidos sem tocar em código de negócio.
- Superfícies criadas por TypeScript (`defineTrackingSurface`/`AutoTrackingSurfaces`) usam a tela visível que apresenta o gesto; portal sem origem verificável não recebe tela inventada.
- Opção selecionada de item de lista: um campo `nome<X>`/`descricao<X>` só é enviado quando o tipo declarado do item prova que a pessoa física é outro sujeito (`{ nomeX, nomeY, cpfX }` envia apenas `nomeY`). Sem prova, nada é enviado e o CLI emite diagnóstico.
- Planilha nomeia o valor escolhido pelo campo comprovado (`[nome-especialidade-selecionado]`); campo genérico usa o objeto do handler (`selecionarSala` + `name` → `[nome-sala-selecionado]`).
- `tela` passa a ser `ambiente:produto:funcionalidade:page` (click, screen_view e planilha); `categoria` acompanha a tela.
- Item de lista com interação que recebe o item envia o campo público exibido em `opcao_selecionada_1`, sem regra por tipo de componente; nome de pessoa, documento, endereço e bairro nunca são enviados.
- Controle de escolha que abre overlay próprio (sheet/modal/popover/alert) e aplica o valor por código ao fechar envia a opção escolhida; abertura por output de clique do mesmo `onChange` também arma a escolha, sem duplicar com `ionChange`.
- Overlays criados por código: serviço `providedIn: 'root'` (inclusive de MFE no host) recebe `AutoTrackingSurfaces` e o owner é resolvido pela ref; a página sob o overlay (`aria-hidden`/`inert` do Ionic) continua sendo a tela de origem.
- Ação acionável em overlay sem contrato da lib (action-sheet, alert, modal de biblioteca) gera `click` com a tela visível do owner que o apresentou e o rótulo exibido; só o owner dono da página emite.
- `verify` compara o JSON e as células reais do XLSX. Regere com `npx auto-tracking` após atualizar.

## 2.1.1 — 2026-11-04

- `verify` e `pre-push` analisam o código atual sem depender de relatório, planilha ou cache anteriores; o push bloqueia fontes relevantes ainda não commitadas, incluindo templates novos.
- `pre-commit` continua aplicando e preparando automaticamente o tagueamento no mesmo commit, protegendo o índice e os arquivos locais contra edições não preparadas ou parcialmente preparadas.
- Consumidores podem ignorar `.auto-tracking/` por completo, mantendo planilha, JSON e cache locais sem conflito entre desenvolvedores.

## 2.1.0 — 2026-10-31

### Rótulo correto para texto dinâmico e ações de navegação

- Texto visível vindo de interpolação ou de `[label]`/`[title]`/`[aria-label]` ligado a variável (menu do serviço, nome que muda sem novo build) é lido no clique. O token marca `rotuloDinamico` e mantém o rótulo semântico da ação como fallback. Na planilha o rótulo aparece como `[texto-exibido-no-elemento]`.
- Leitura no clique, sem observer: atributo acessível atual ou o primeiro texto do elemento, ignorando slots nomeados (badge, ícone) e conteúdo `aria-hidden`. Número longo (CPF, cartão, protocolo) ou e-mail nunca é enviado; vale o fallback.
- Expressões com indício de dado pessoal ou de negócio (`nome`, `cpf`, `endereco`, `cartao`, `valor`, `data`…) nunca são lidas do DOM.
- Prefixo da biblioteca do componente (`bsdsClick` em `<bsds-…>`) nunca vira rótulo.
- Voltar/fechar/cancelar de header e modal usam a ação, nunca o título da tela.
- `data-testid` concatenado (`'icon-star-ranking-' + index`) usa a parte fixa; o conectivo `ao` do handler não entra no rótulo.
- Compatível: tokens existentes continuam válidos; só elementos de rótulo dinâmico ganham o slot opcional novo. Regere com `npx auto-tracking` após atualizar.

## 2.0.0 — 2026-10-30

### Eventos coerentes com a planilha e sem `(not set)`

- O `rotulo` enviado é o mesmo da planilha; texto variável da tela (nomes, valores) não é enviado. Itens de `*ngFor`/`@for` sobre lista literal da classe enviam o valor provado do item clicado.
- Rótulos legíveis: ids de teste (`btn-…`, `icon-…`) e palavras de código (`on`, `handle`, `click`, `clique`) não viram rótulo; `title`/`label` ligados a literal são considerados; código de atributos (`n > 0`) não vaza para o texto; URLs em argumentos são ignoradas.
- Schema rejeita parâmetro obrigatório vazio; opção selecionada vazia não é enviada.
- Runtime carrega só a descompressão do pako: bundle do app de 69 KB para 43 KB minificado (23 KB → 15,5 KB gzip).

### Hooks git

- `auto-tracking hooks install` instala hooks git nativos (respeita `core.hooksPath`/Husky, idempotente, LF garantido via `.gitattributes`); `hooks status` mostra o estado e o propósito de cada hook.
- `hook pre-commit` atualiza o tagueamento e inclui no próprio commit o que mudou; `hook pre-push` só verifica. Toda a lógica fica na lib.
- Pasta de saída apagada é regenerada idêntica a partir dos templates.

### Compatibilidade

- Angular 19 ou posterior: o provider usa `provideEnvironmentInitializer` (sem API depreciada).
- Runtime não importa mais `@capacitor/*`: a identidade nativa usa a ponte `window.Capacitor`. Nenhum módulo do app é carregado ou avaliado durante um gesto (em microfrontends cada bundle teria a própria cópia do Capacitor). `@capacitor/*` e `@ionic/angular` deixam de ser peerDependencies.
- Regerar o tagueamento (`npm run tracking`) após atualizar; versões do motor e da planilha mudaram e o cache é invalidado.

## 1.0.7 — 2026-10-29

### Estabilidade e desempenho do runtime Angular/Ionic

- Descoberta de marcadores incremental e cancelável, com limite de nós/tempo por rodada, agendamento cooperativo e recuperação após pico de mutações.
- Listener, observação de DOM e tarefas de analytics isolados da detecção de mudanças Angular sempre que a `NgZone` está disponível.
- Destruição segura de listeners, observers e timers; impede envio depois do teardown e cancela `screen_view` atrasado após mudança de rota.
- Coordenação por `Document` e `owner` entre instâncias Angular, com transferência segura ao desmontar um injector, sem duplicar emissões.
- Cache de tokens limitado por tamanho e quantidade; consultas de identidade Capacitor agrupadas e ID do bundle nativo reutilizado, com diagnóstico e controle de novas tentativas após falhas.
- Compatibilidade com Angular Web sem instalar `@capacitor/core` ou `@capacitor/app`, que continuam necessários para identidade nativa quando o consumidor usa Capacitor. Falha de plugin no ambiente nativo não é mascarada como Web.

### Gerador e evidências

- Reconciliação de marcadores e tokens existentes, evitando referências concorrentes e duplicidades, preservando identidades apenas quando comprovadas.
- Verificação rigorosa de cache, assinatura e artefatos; execução sem mudanças não altera HTML, JSON, XLSX ou estado do cache.
- Relatório Excel só é regravado quando sua própria entrada/assinatura muda; testes adicionais de idempotência e marcação.

### Operação da publicação npm

- Scripts no `package.json` para login, consulta da conta, listagem, inspeção, download, aprovação e rejeição de estágios npm, sem armazenar credenciais no repositório.

### Validação local

- TypeScript, build, execução de testes, `npm pack` e instalação de pacote `.tgz` em projeto temporário.
- Testes de regressão de runtime para instâncias simultâneas, desmontagem, Web sem Capacitor, falhas do adaptador, mutações intensivas e resolução nativa.
- **Limite:** testes de navegador/JS não substituem a validação de um aplicativo Angular/Ionic completo em Android WebView e iOS WKWebView, com navegação e adaptadores reais.

Esta versão não instala Git hooks, não controla Git e não contém migração de tokens.

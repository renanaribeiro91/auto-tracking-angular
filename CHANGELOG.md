# Changelog

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

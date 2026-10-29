# Changelog

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

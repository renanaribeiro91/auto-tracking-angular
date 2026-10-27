# Resolução de problemas

## Comando e integração

| Sintoma | Como verificar | Correção |
|---|---|---|
| `auto-tracking: command not found` | Verifique `node_modules/.bin/auto-tracking` e o symlink do pacote. | Execute `npm run build` e `npm link` na biblioteca; no aplicativo, `npm run tracking:link`. |
| `Permission denied` ao executar o CLI | Confira as permissões de `dist/cli/index.js`. | Recompile (`npm run build`) na biblioteca, que marca o arquivo como executável; não instale `.tgz` para contornar isso. |
| CLI ainda usa código anterior | Verifique para qual clone o symlink aponta. | Faça `npm run build` no clone correto e reinicie o processo consumidor que mantém módulos em memória. |
| `config não encontrada ou sem runtime.owner/product` | Arquivo de configuração e valores literais. | Coloque `auto-tracking.config.ts` na raiz ou informe `--config` e use strings literais em `owner` e `product`. |
| `projeto ... não existe no angular.json` | Compare `angularProject` com a chave em `angular.json`. | Corrija o nome do projeto e o `tsconfig`. |
| `output inválido` | Veja se a saída está dentro da raiz e fora de `src`, `dist` e `node_modules`. | Use `.auto-tracking` ou outro diretório próprio. |
| Falha ao carregar logo ou marca-d'água | Confirme a existência dos PNGs nos caminhos definidos em `branding`. | Use caminhos relativos à raiz do consumidor, dentro de `src/assets` se essa pasta existir. |
| `marcação pendente` no `verify` | Compare o template com os atributos `data-at-*` esperados. | Execute `npm run tracking` e confirme a segunda execução idempotente. |
| Relatório ou planilha desatualizados | Confira mudanças em templates, dependências, branding ou versão do gerador. | Execute `npm run tracking` e inclua os artefatos atualizados no commit. |

## Build Angular usando npm link

Se aparecer `Can't resolve rxjs`, `rxjs/operators` ou `@angular/platform-browser` vindo do diretório físico da biblioteca, não instale pacotes adicionais aleatórios na biblioteca nem copie `node_modules`. Compile o consumidor com `--preserve-symlinks=true`, preservando os peers resolvidos pelo próprio app. Se houver erros TypeScript em código do consumidor, trate-os separadamente: não são erros do mecanismo de link.

## Diagnósticos estruturais

| Código | Significado | Como agir |
|---|---|---|
| `BOOTSTRAP_PROVIDER_MISSING` | Não existe registro verificável de `provideAutoTracking` para o projeto. | Registre o provider no módulo/bootstrapping correto. |
| `SCREEN_MARKER_NOT_PLACEABLE` | A tela roteada não expõe um elemento renderizado seguro para `data-at-screen`. | Ajuste a estrutura do template, sem marcar `ng-template` como tela física. |
| `INLINE_TEMPLATE_INTERPOLATED` | O template TypeScript contém interpolação que impede edição estática segura. | Use `templateUrl` ou um literal estático. |
| `ROUTED_COMPONENT_AMBIGUOUS` | A rota não resolve inequivocamente para um componente. | Utilize uma referência/importação explícita à classe correta. |
| `VISIBLE_LABEL_BEHAVIOR_CONFLICT` | O texto visível sugere ação oposta ao handler. | Confira a semântica do componente; o motor não inventa significado pelo nome. |

Bindings sem `@Output` público comprovado ou sem gesto DOM rastreável estão **fora do escopo** e não geram diagnóstico nem evento. A ausência desses avisos não é certificação de execução de todos os componentes externos.

## Eventos em runtime

| Sintoma | Verificação |
|---|---|
| Nenhum evento enviado | Confirme `provideAutoTracking`, o elemento com `data-at-id`/`data-at-owner`, a identidade resolvida e o callback `send`. |
| `ambiente não resolvido` | Adicione ao preset externo apenas o ID nativo ou tema Web comprovado no aplicativo. |
| `rejeitado pelo schema` | Confira os campos obrigatórios e permitidos em `trackingPreset.schema`. |
| `falha no envio` | Inspecione o adaptador de analytics injetado pelo aplicativo. O motor não substitui o transporte. |
| Planilha sem marca-d'água visível | Abra em um visualizador que suporte imagens DrawingML. O arquivo mantém somente o fundo nativo, exibido pelo Excel; o Numbers pode ignorá-lo na importação, mas o gerador não cria imagens flutuantes. |

Para detalhes de IDs, ownership, domínios e cache, veja [Arquitetura e contrato](arquitetura.md).

# Integração e validação em projetos Angular

O consumidor é responsável pelo preset, pelas imagens da planilha, pelo adaptador de envio e pelo registro do provider. A biblioteca não conhece o nome da organização nem altera o TypeScript de telas para criar analytics.

## O que configurar

1. Instale a biblioteca publicada via npm (preferido) ou use `npm link` somente no desenvolvimento local ([passo a passo](uso-local-sem-esteira.md)).
2. Defina `tracking-preset.ts` no aplicativo. Mantenha o schema dos eventos e os mapas de ambiente ao lado do código que conhece os IDs de bundle e os temas Web.
3. Declare `auto-tracking.config.ts` na raiz, incluindo `runtime.mode: 'ref'` ou `'classic'` (padrão). A configuração deve conter literais para `projects`, `output`, `branding`, `runtime.mode` e `runtime.owner/root/product`; o CLI lê os dados por AST sem executar efeitos colaterais.
4. Registre `provideAutoTracking(config.runtime)` no bootstrap ou no módulo exposto por cada MFE. O adaptador `send` e a função `getWebTheme` são resolvidos pelo injector do consumidor.
5. Declare os scripts `tracking`, `tracking:verify` e `tracking:install` (com `tracking:link` apenas para desenvolvimento), conforme o [README](../README.md).

## Identidade e versões

- `preset.id` é o nome lógico do preset. É metadado; não define owner, ambiente ou ID de evento.
- `preset.version` é a versão do contrato de negócio. Não precisa acompanhar o `package.json` da biblioteca.
- `package.json.version` da biblioteca define a versão do pacote npm e o que o CLI exibe. Evite copiar o número para documentação ou código com lógica de compatibilidade.
- `runtime.owner` identifica o emissor do evento; `runtime.product` é enviado no payload; a tabela nativa e os temas Web do preset resolvem o `ambiente`.

## Validação antes do commit

```bash
npm run tracking
npm run tracking
npm run tracking:verify
```

A primeira execução marca gestos comprovados e gera `.auto-tracking/relatorio.json`, `.auto-tracking/evidencia-tagueamento.xlsx` e `.auto-tracking/cache/estado.json`. A segunda deve escrever **zero arquivos**, inclusive não alterar o conteúdo nem os horários de modificação do HTML, JSON, XLSX e estado de cache; o `verify` deve terminar com código `0`. Adicione ao commit as alterações deliberadas nos templates e nesses três artefatos. Não remova tokens existentes para forçar uma geração: a biblioteca reconcilia o contrato anterior com a prova causal atual e preserva IDs e tokens semanticamente intactos. Não há script de migração.

Mudanças relevantes de configuração, HTML, TypeScript da aplicação, metadados instalados de componentes, IDs ou outputs obrigam o motor a reanalisar as entradas. O cache não substitui a verificação: ele apenas evita reescrita desnecessária. No modo `classic`, IDs manuais válidos são preservados. No modo `ref`, o token é autocontido, sem import de relatório no runtime. Mudar a configuração entre esses modos é uma decisão explícita do consumidor, independente da reconciliação normal; não é pré-requisito remover tokens já existentes para usar o gerador.

### O que conta como cobertura

Um output por si só não é prova de um gesto. Se não houver produtor público ou um gesto DOM comprovável, o motor não cria marcação, alerta de analytics ou evento fictício. Isso vale também para inputs de digitação e eventos técnicos. Casos em que falta infraestrutura de runtime, como provider não registrado, continuam sendo falhas reais de integração.

## Contratos dos callbacks do consumidor

A biblioteca não conhece o banco de dados, Firebase, serviços de tema ou autenticação do host. `getWebTheme(injector)` **deve apenas ler o valor do tema**: não deve publicar em `Subject`, persistir dados, navegar nem provocar alterações de estado. A biblioteca pode chamá-lo ao preparar eventos Web, para reconhecer mudanças legítimas de tema. Uma função que publica novamente o mesmo tema pode amplificar assinaturas e renderizações de um aplicativo inteiro; a correção desse efeito colateral pertence à implementação do consumidor.

O callback `send(event, injector)` deve retornar uma `Promise` quando a operação for assíncrona e propagar rejeições: o runtime as registra sem impedir a interação de negócio. Se o adaptador inicia tarefas assíncronas e devolve `void`, erros posteriores dessa tarefa **não podem ser capturados pela biblioteca**, porque não existe vínculo com a promessa descartada. O consumidor deve garantir que seu adaptador trate ou exponha esses erros. Não mascarar falhas com `.catch(() => undefined)`.

## Escolha do modo e entrega ao adaptador

```ts
runtime: {
  mode: 'ref', // FED/MOB; troque por 'classic' se desejar os data-at-* originais
  // owner, product, preset, getWebTheme e send permanecem no aplicativo
}
```

`ref`: cada elemento tem somente `data-at-ref="v1.<token>"`. O CLI gera os dados no atributo, e o runtime o descompacta e guarda em cache. **Não há `trackingManifest`, import do relatório, arquivo TypeScript gerado ou requisição HTTP.** `classic`: comportamento original dos atributos completos. O runtime só processa o modo selecionado, impedindo emissão mista ou duplicada.

O `send` recebe o mesmo evento validado nos dois modos e encaminha ao `AnalyticsAdapter.trackEvent(...)` fornecido pelo consumidor. Testes de biblioteca demonstram o contrato e os builds comprovam compilação, mas o Firebase real deve ser observado em um smoke de navegação/dispositivo antes do deploy.

## Builds de consumidores ligados por symlink

Com `npm link`, o CLI e o aplicativo compartilham o código da biblioteca. Webpack pode tentar resolver peers Angular/RxJS a partir do diretório físico da biblioteca. Para validar um build local nessa configuração, prefira:

```bash
npx ng build app --configuration=production --preserve-symlinks=true
```

Troque `app` pelo nome em `angular.json`. Isso preserva a resolução pelo `node_modules` do consumidor, sem copiar pacotes e sem alterar versões Angular. Builds de publicação dependem do pipeline de cada aplicação e exigem uma versão publicada do pacote no npm; `npm link` não instala a dependência numa máquina de CI remota.

## Planilha e marca visual

As imagens devem existir no repositório do consumidor, preferencialmente em uma pasta `src/assets/auto-tracking/`. Configure os caminhos relativos à raiz no campo `branding`. O XLSX possui fundo nativo e marcas-d’água distribuídas com transparência para visualizadores que não mostram fundos de planilha. Os conteúdos permanecem em células normais; a apresentação pode variar entre Excel, Numbers e importadores de XLSX.

A aba **Resumo** é centralizada e apresenta os totais e os links internos. As demais abas representam módulos e oferecem retorno ao Resumo. O modelo de cor, o logo e a marca-d'água não afetam o evento enviado ao aplicativo.

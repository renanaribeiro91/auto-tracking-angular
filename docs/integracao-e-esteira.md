# Integração e validação em projetos Angular

O consumidor é responsável pelo preset, pelas imagens da planilha, pelo adaptador de envio e pelo registro do provider. A biblioteca não conhece o nome da organização e lê as declarações de rastreamento por AST, sem executar o TypeScript do consumidor.

## Opções em portais e modais criados por código

`provideAutoTracking` disponibiliza `AutoTrackingSurfaces` por injeção. Declare as ações com `defineTrackingSurface` dentro do método que cria o portal (componente, serviço ou effect). O CLI grava a `ref` no próprio objeto TypeScript e inclui as mesmas ações no JSON e na planilha; não há manifesto adicional nem import de relatório no app.

```ts
import { AutoTrackingSurfaces, defineTrackingSurface } from 'auto-tracking-angular';

private readonly surfaces = inject(AutoTrackingSurfaces);

async openOptions() {
  const origin = this.surfaces.capture(); // antes do primeiro await
  const definition = defineTrackingSurface({
    id: 'opcoes-atendimento',
    actions: [
      {
        id: 'selecionar', selector: '[role="option"]',
        elemento: 'lista', rotulo: 'tipo-atendimento',
        optionAttribute: 'data-public-option', allowedOptions: ['consulta', 'exame'],
      },
      { id: 'fechar', selector: '[aria-label="Fechar"]', elemento: 'botao', rotulo: 'fechar' },
    ],
  });
  const modal = await modalController.create({ component: OptionsComponent });
  const detach = this.surfaces.attach(modal, definition, origin);
  try {
    await modal.present();
    return (await modal.onDidDismiss()).data;
  } finally {
    detach();
  }
}
```

Ao usar injeção pelo construtor com tipo anulável, o CLI reconcilia o import de valor e o token explícito: `@Inject(AutoTrackingSurfaces) @Optional() private readonly tracking: AutoTrackingSurfaces | null = null`. Ele reutiliza imports e aliases existentes, sem duplicar decorators. A união com `null` sozinha não fornece um token Angular (NG2003). `inject(AutoTrackingSurfaces, { optional: true })` também preserva o token explícito.

As regras de cada ação, incluindo opções permitidas e atributo de seleção, fazem parte da referência gerada. Alterá-las exige nova execução do CLI antes de recompilar o consumidor; o runtime rejeita a declaração que ainda usa uma referência anterior.

Execute `auto-tracking apply` após mudar a declaração. IDs, seletores, rótulos e opções devem ser literais e vir do contrato público do componente, sem texto livre, índice visual ou dados pessoais. Use `event: 'change'` para controles nativos e `event: 'ionChange'` para controles que publicam esse evento; o clique de abertura de um select continua separado da escolha. Para listas em portais, o atributo público e a lista permitida identificam a opção clicada. A biblioteca não contém seletores de design systems específicos.

A raiz pública do portal é necessária: a biblioteca não associa overlays por ordem de abertura nem por classe global. `capture()` obtém a identidade marcada na página da rota do owner atual, desconsiderando páginas ocultas mantidas pelo Ionic. A captura preserva funcionalidade, tela e ID mesmo que a rota mude enquanto o modal estiver aberto. Falta de origem, declaração inválida ou `ref` desatualizada gera diagnóstico e não interrompe o fluxo de negócio. Não há fallback para uma tela global ou `not set`.

Se o template do modal já contém ações marcadas pelo CLI, registre apenas a origem: `surfaces.register(modal, { screen: origin, actions: [] })`, após confirmar que `origin` existe. As ações mantêm os IDs e rótulos do template e recebem a origem capturada. Encerre o vínculo no fechamento.

A abertura programática não é um clique físico. Para registrá-la, defina, por exemplo, `modal_open` no schema do preset e chame `tracking.track('modal_open', origin, { modal: 'opcoes-atendimento' })` depois de `present()`, usando `TRACKING_DISPATCHER`. As ações declaradas por `defineTrackingSurface` entram na evidência estática; eventos programáticos arbitrários seguem o schema do consumidor e não são inferidos como ações de template.

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

A primeira execução marca gestos comprovados e gera `.auto-tracking/relatorio.json`, `.auto-tracking/evidencia-tagueamento.xlsx` e `.auto-tracking/cache/estado.json`. Adicione `.auto-tracking/` ao `.gitignore`: relatórios e cache são locais a cada desenvolvedor. A segunda execução deve escrever **zero arquivos** quando nada mudou. O `verify` confere as marcações diretamente no código e funciona sem esses artefatos; o `pre-push` também impede o envio de templates/entradas de derivação com alterações locais ainda não commitadas. O `pre-commit` continua aplicando e adicionando automaticamente as marcações aos templates preparados, bloqueando previamente alterações parcialmente preparadas que causariam staging indevido. Não remova tokens existentes para forçar uma geração: a biblioteca reconcilia o contrato anterior com a prova causal atual e preserva IDs e tokens semanticamente intactos. Não há script de migração.

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

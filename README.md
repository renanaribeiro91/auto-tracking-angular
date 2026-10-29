# auto-tracking-angular

Biblioteca de rastreamento de interações para aplicações Angular e Ionic. O comando `auto-tracking` analisa os templates e gera **marcações `classic` ou tokens autocontidos `ref`, conforme `runtime.mode`** nos pontos em que existe evidência de um gesto observável. Em execução, `provideAutoTracking` identifica o gesto, valida o contrato de evento informado pelo aplicativo e chama o adaptador de analytics configurado.

O pacote **não** contém regras de marcas, listas de aplicativos, nomes de produtos ou credenciais. Cada consumidor define essas informações em um `TrackingPreset` próprio.

## Como funciona

1. O CLI lê `auto-tracking.config.ts` por AST, sem executar o arquivo.
2. Analisa componentes locais e os metadados das bibliotecas instaladas, inclusive outputs e elementos internos.
3. Marca gestos e telas com origem demonstrável; ignora inputs de digitação, eventos técnicos, saídas sem produtor e saídas sem gesto comprovado.
4. Produz o relatório JSON, a planilha de evidência e o estado de cache.
5. No aplicativo, o runtime emite `click` e `screen_view` para o callback `send` fornecido pelo consumidor.

Isso não equivale a certificar o comportamento de todo componente externo. Eventos sem origem física comprovável não são instrumentados nem contam como pendência de analytics. Problemas estruturais reais, como ausência do provider ou um template impossível de marcar com segurança, continuam identificados.

## Requisitos

- Node.js 18.18 ou posterior.
- Angular 16 ou posterior; TypeScript 4.9 ou posterior.
- Ionic Angular 7 ou posterior e Capacitor 5 ou posterior, quando utilizados pelo aplicativo.
- Projeto Angular com `angular.json` e `tsconfig` do projeto a ser analisado.

## Instalação e desenvolvimento local

Para instalar uma versão publicada, use `npm install auto-tracking-angular`. A versão `1.0.7` inclui o runtime com descoberta incremental de DOM, isolamento de owners, redução de chamadas nativas e suporte a Angular sem Capacitor. Use `npm link` apenas como opção de desenvolvimento local, nunca como dependência de CI.

Na pasta da biblioteca:

```bash
npm ci
npm run build
npm link
```

Na pasta de cada aplicativo consumidor:

```bash
npm link auto-tracking-angular --legacy-peer-deps
```

Opcionalmente, exponha `"tracking:link": "npm link auto-tracking-angular --legacy-peer-deps"` no `package.json` do consumidor e execute `npm run tracking:link`. O link é local: ele não deve ser gravado como dependência `file:` nem substituir um pacote publicado em CI. Se recriar `node_modules`, execute o link novamente. Depois de mudar a biblioteca, basta recompilar o `dist` com `npm run build`.

No desenvolvimento com Webpack/Angular CLI, caso o symlink faça os peers Angular/RxJS serem procurados no clone da biblioteca, valide com `--preserve-symlinks=true`, sem copiar dependências nem modificar o código do framework.

## Configuração do aplicativo

Crie um arquivo `tracking-preset.ts` **no aplicativo**, e não na biblioteca:

```ts
import type { TrackingPreset } from 'auto-tracking-angular';

export const trackingPreset: TrackingPreset = {
  id: 'meu-aplicativo',
  version: '1.0.0',
  schema: {
    click: {
      requiredParams: ['ambiente', 'produto', 'funcionalidade', 'tela', 'categoria', 'elemento', 'rotulo', 'acao'],
      allowedParams: ['ambiente', 'produto', 'funcionalidade', 'subfuncionalidade', 'tela', 'categoria', 'elemento', 'rotulo', 'acao', 'opcao_selecionada_1'],
    },
    screen_view: {
      requiredParams: ['ambiente', 'produto', 'funcionalidade', 'tela'],
      allowedParams: ['ambiente', 'produto', 'funcionalidade', 'subfuncionalidade', 'tela'],
    },
  },
  nativeAppIdToEnvironment: { 'com.exemplo.aplicativo': 'app-mobile' },
  webThemeToEnvironment: { padrao: 'app-web' },
};
```

O `id` identifica o preset. Sua propriedade `version` é a versão do contrato de negócio, **independente** da versão npm da biblioteca. Os dois campos são metadados: o runtime atual não altera o comportamento pelo valor deles. Já `schema`, `nativeAppIdToEnvironment` e `webThemeToEnvironment` são usados para validar e montar eventos.

Na raiz do consumidor, crie `auto-tracking.config.ts`:

```ts
import type { Injector } from "@angular/core";
import { defineAutoTrackingProject } from "auto-tracking-angular/config";
import { trackingPreset } from "./tracking-preset";
import { AnalyticsService } from "./src/app/services/analytics.service"; // exemplo: adaptar ao aplicativo

export default defineAutoTrackingProject({
  projects: [{ angularProject: "app", tsconfig: "tsconfig.app.json" }],
  output: ".auto-tracking",
  branding: {
    logoPng: "src/assets/auto-tracking/logo.png",
    watermarkPng: "src/assets/auto-tracking/watermark.png",
    primaryColor: "#284B63",
  },
  runtime: {
    owner: "app",
    root: "app-root",
    product: "produto",
    preset: trackingPreset,
    mode: 'ref', // 'ref' (token autocontido) ou 'classic' (atributos completos)
    getWebTheme: () => "padrao",
    send: (event, injector: Injector) => injector.get(AnalyticsService).trackEvent(event),
  },
});
```

Ajuste o nome Angular, o `tsconfig`, o `root`, o caminho de `AnalyticsService` e o método de envio para o projeto real. O caminho das imagens é relativo à raiz do repositório. Os arquivos de marca e a configuração pertencem ao aplicativo; não são incluídos no pacote genérico. A opção `branding` altera somente a planilha, não o evento enviado.

Registre o provider na inicialização do aplicativo ou do MFE:

```ts
import { provideAutoTracking } from 'auto-tracking-angular';
import config from './auto-tracking.config';

// Adicione ao array providers do módulo ou bootstrap.
provideAutoTracking(config.runtime)
```

O host deve prover as dependências usadas por `send` e pela função de tema. Em ambientes com host e MFEs, configure um `owner` próprio para cada originador de eventos.

## Executar e validar

No `package.json` do consumidor, adicione:

```json
{
  "scripts": {
    "tracking": "auto-tracking",
    "tracking:verify": "auto-tracking verify",
    "tracking:install": "npm install auto-tracking-angular@1.0.7 --save-exact --legacy-peer-deps --registry=https://registry.npmjs.org/"
  }
}
```

```bash
npm run tracking                 # marca e atualiza evidências
npm run tracking                 # deve escrever 0 arquivos
npm run tracking:verify          # lê e verifica, sem alterar arquivos
npm run tracking -- --dry-run    # visualiza mudanças sem gravar
npm run tracking -- --json       # saída estruturada para automação
```

Códigos de saída: `0` válido, `1` pendências estruturais ou marcações/evidências desatualizadas, `2` erro operacional/configuração. A mensagem de execução sem mudanças indica que marcações e evidências estão consistentes; não significa que eventos fora do escopo estejam cobertos.

## Artefatos gerados

| Arquivo                                     | Finalidade                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `.auto-tracking/relatorio.json`             | Evidências: `entries[]` (cada evento com `ref` no modo ref) e `diagnostics[]`.      |
| `.auto-tracking/evidencia-tagueamento.xlsx` | Aba **Resumo**, abas por módulo, filtros, links internos e marca visual opcional. |
| `.auto-tracking/cache/estado.json`          | Assinatura das entradas, do motor e das evidências para reconciliar mudanças.     |

Se mudar um binding, output, identidade, rota ou atributo `data-at-*`, o CLI reanalisa o projeto e reconcilia atributos derivados. O gerador se baseia no código-fonte e nos bindings reais para determinar os eventos e as referências; IDs não dependem de arquivos ou diretórios temporários. A primeira execução depois de uma mudança pode atualizar relatório e planilha; a seguinte deve escrever zero arquivos.

A imagem de marca-d’água do consumidor é convertida num **padrão diagonal discreto e repetível**, usado exclusivamente como **fundo nativo da planilha XLSX**. O fundo não é um desenho flutuante: não pode ser arrastado, não bloqueia células e não reduz a nitidez dos textos. O Resumo utiliza margens laterais simétricas, com conteúdo centralizado no espaço útil. **Compatibilidade:** o Excel suporta o fundo nativo em tela; o Numbers pode ignorar fundos de planilhas XLSX importadas. Para garantir uma aparência idêntica no Numbers seria necessário um documento `.numbers` com fundo configurado no próprio aplicativo; a biblioteca não adiciona imagens flutuantes como alternativa.

## Qualidade, desenvolvimento e publicação

```bash
npm run check               # typecheck + build + testes
npm run typecheck           # validação estática de tipos
npm run build               # dist/ usado pelo npm link
npm test -- --runInBand     # suíte completa em execução sequencial
```

O script `lint` existente também executa apenas `tsc --noEmit`; não representa uma verificação ESLint. Um linter independente pode ser introduzido somente com configuração e dependências próprias.

A fonte da versão publicada é `package.json`. Para publicar com segurança, faça commit da versão aprovada, autentique-se com `npm login --auth-type=web` e execute:

```bash
npm run publish:npm                 # prepara a versão atual para aprovação npm
npm run publish:npm -- patch        # incrementa patch e prepara a próxima versão
npm stage list auto-tracking-angular # consulta o ID da versão em revisão
npm stage approve ID_DO_STAGE      # substitua pelo ID real; aprova com 2FA
```

O script **não envia automaticamente ao público sem 2FA**: ele executa `npm stage publish`, que aplica `prepublishOnly` (`npm run check`), e recusa árvore Git suja, versão já publicada ou em estágio. Para `patch/minor/major`, a atualização do `package.json` e do lockfile fica local; revise e faça commit também da nova versão. `npm run release` continua gerando apenas artefato local, sem publicar. O preset externo possui `id` e `version` próprios, independentes da versão npm.

## Leitura complementar

- [Arquitetura e contrato](docs/arquitetura.md) — evidências, limites, IDs, payload, cache e runtime.
- [Integração e validação](docs/integracao-e-esteira.md) — roteiro genérico para projetos Angular e MFEs.
- [Uso local por npm link](docs/uso-local-sem-esteira.md) — criação, manutenção e recuperação dos links.
- [Resolução de problemas](docs/troubleshooting.md) — falhas do CLI, de build e do envio de eventos.

**Licenciamento:** esta distribuição está marcada como `UNLICENSED` enquanto não for adotada uma licença pública pelo titular dos direitos. Visibilidade pública e instalação pelo npm não concedem licença de reutilização ou redistribuição do código.

## Modos de instrumentação

A seleção é feita **no `runtime` do arquivo `auto-tracking.config.ts`**, lida estaticamente pelo CLI e usada pelo mesmo `provideAutoTracking` no navegador:

```ts
runtime: {
  mode: 'ref', // ou 'classic' — o padrão, para projetos existentes
  owner: 'app', root: 'app-root', product: 'produto', preset: trackingPreset,
  send: (event, injector) => injector.get(AnalyticsService).trackEvent(event),
}
```

### `mode: 'ref'` (FED/MOB)

```html
<button (click)="excluir()" data-at-ref="v1.eJ...">Excluir {{ pessoa.nome }}</button>
```

`v1.eJ...` é **ilustrativo**, não um token real. O token real contém todos os metadados necessários para gerar o evento: owner, funcionalidade, tela, screen_view, ID, gesto, rótulo-fallback, `@Output`, seletor e regras de opção selecionada. O CLI cria um token **determinístico**, versionado e compactado com DEFLATE, seguro para atributos HTML. Não é criptografia nem um hash irreversível; não coloque segredos no token. O runtime decodifica na primeira leitura e usa cache LRU limitado nos eventos seguintes. Ele continua observando o DOM e Shadow DOM, obtendo rótulos e opções dinâmicas no instante do gesto.

**Não há `trackingManifest`, importação de relatório, fetch de JSON nem outro arquivo de lookup no navegador.** O runtime recebe apenas o token do próprio HTML; valida os parâmetros com o schema e chama `send`. O aplicativo é responsável por conectar `send` ao AnalyticsAdapter/Firebase. Se token, owner, ambiente ou schema não forem válidos, o evento não é enviado.

No `relatorio.json`, `entries[]` conserva o ID completo, a referência autocontida `ref`, a ação, o contexto, arquivo, linha e telas alcançáveis. A planilha Excel preserva o formato atual, **sem coluna `ref`**. A referência não é o nome do evento enviado.

### `mode: 'classic'` (compatibilidade original)

```html
<button (click)="excluir()" data-at-id="pessoas-excluir" data-at-owner="app"
        data-at-funcionalidade="pessoas" data-at-tela="lista"
        data-at-elemento="botao" data-at-rotulo="excluir">Excluir</button>
```

O CLI e o runtime continuam usando os atributos `data-at-*` antigos, incluindo outputs no formato `id|evento|seletor|rótulo|output` e opções de seleção. **O padrão é `classic`**, evitando mudanças silenciosas em aplicativos que já utilizam o pacote. Cada consumidor deve gerar e executar o **mesmo modo**; não misture `classic` e `ref` na mesma configuração.

### Fluxo seguro

```bash
npm run tracking                  # gera HTML + JSON + XLSX a partir de evidência Angular
npm run tracking                  # deve gravar 0 arquivos
npm run tracking:verify           # deve retornar 0 pendências / 0 diagnósticos
npm run check                     # na biblioteca: tipagem, pacote e testes
```

Para mudar de `classic` para `ref`, primeiro remova as **marcações antigas** do HTML externamente à biblioteca, sem tocar nos handlers Angular ou templates de negócio; selecione o novo modo e regenere as evidências. O gerador não deve adivinhar IDs a partir de referências inválidas. Faça backup antes da limpeza e valide no aplicativo com o runtime da mesma versão.

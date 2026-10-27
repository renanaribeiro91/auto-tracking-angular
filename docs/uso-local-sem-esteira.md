# Desenvolvimento com npm link

Este modo permite desenvolver a biblioteca e os aplicativos na mesma máquina, sem publicar um pacote npm nem copiar um `.tgz` para os repositórios consumidores.

## Configuração inicial

Na raiz da biblioteca:

```bash
npm ci
npm run build
npm link
```

Na raiz de cada consumidor:

```bash
npm run tracking:link
```

O script do consumidor deve executar `npm link auto-tracking-angular --legacy-peer-deps`. Confirme que `node_modules/auto-tracking-angular` é um link simbólico para a biblioteca e que `node_modules/.bin/auto-tracking` aponta para `dist/cli/index.js` desse clone.

**Não** adicione dependências `file:vendor/`, não instale `.tgz` no consumidor e não envie o link local ao Git. O link faz parte da estação de desenvolvimento, não do contrato do aplicativo.

## Rotina de trabalho

1. Se alterar código da biblioteca, execute `npm run build` nela. Se estiver iterando, use `npm run build:watch` e aguarde a conclusão antes de testar.
2. No consumidor, execute `npm run tracking`. Revise as mudanças no HTML e em `.auto-tracking/`.
3. Execute `npm run tracking` novamente e confira zero arquivos escritos.
4. Execute `npm run tracking:verify` e valide o build Angular do consumidor. Para builds com peers resolvidos no link, use `--preserve-symlinks=true`.
5. Faça commit somente dos arquivos pertinentes ao projeto, incluindo planilha e relatório quando alterados.

Se executar `npm ci` no consumidor ou recriar seu `node_modules`, refaça `npm run tracking:link`. Não é necessário repetir `npm link` na biblioteca a cada compilação; basta atualizar o `dist`.

## Sobre versões

O `package.json` da biblioteca é a fonte da sua versão npm. O CLI a exibe diretamente. O preset é externo: `preset.id` o identifica, enquanto `preset.version` descreve o contrato do consumidor e só muda quando esse contrato mudar. Não crie uma regra de igualdade entre essas versões.

## Limite para CI e produção

O link local resolve apenas a máquina onde foi criado. Um pipeline remoto precisa instalar uma versão publicada da biblioteca pelo npm registry; não pode depender do diretório local de um desenvolvedor. O comando `npm run release` da biblioteca valida e gera um pacote para distribuição controlada, mas não é necessário durante o uso por `npm link` e não publica automaticamente.

## auto-tracking-angular

Biblioteca npm genérica e pública (Angular/Ionic) que marca interações nos templates (`data-at-*`) pelo CLI `auto-tracking` e emite `click`/`screen_view` em runtime via `provideAutoTracking`. TypeScript ESM, Jest. Documentação técnica em `docs/`.

## Policy

- Branches em git flow (`feature/`, `bugfix/`, `hotfix/`, `release/`); commits `tipo: descrição` com `feat`, `fix`, `refactor`, `docs`, `test` ou `chore`.
- Nunca commitar nem fazer push sem pedido explícito.
- Não publicar em registry nem criar release sem autorização. Para desenvolvimento integrado com apps, usar `npm link`, nunca `file:vendor` ou instalação de `.tgz`.
- Nunca executar `auto-tracking.config.ts` em Node; o CLI só o lê por AST (`src/adapters/angular-compiler/angular-index.ts`).
- IDs nativos, temas Web, schema e identidade visual pertencem ao preset/config do consumidor. A biblioteca é genérica e não pode incorporar mapeamentos de uma organização.
- Output contém só `relatorio.json`, `evidencia-tagueamento.xlsx` e `cache/`; nunca criar `manifest.json`, `diagnostico.json` ou similares.
- A lib substitui o tagueamento manual dos apps: não detectar nem preservar chamadas `rastrearEvento` existentes.

## Where things are

- Runtime (vai para o bundle do app): `src/index.ts`, `src/angular/`, `src/adapters/runtime/`, `src/domain/`; nunca importar `fs`, `typescript` ou `exceljs` nesses caminhos — CLI/motor ficam em `src/cli/` e `src/application/`.
- Contrato `data-at-*`, payload e regras de ID: `docs/arquitetura.md`.
- Integração genérica e rotina de validação: `docs/integracao-e-esteira.md` e `docs/uso-local-sem-esteira.md`.

## Running and verifying

- Validar alterações com `npm run check` (typecheck, build e testes). Gerar release apenas quando solicitado explicitamente.
- Validar via `npm link` na lib e `npm run tracking:link` no consumidor; `npm run tracking` duas vezes (a segunda deve escrever 0), `npm run tracking:verify` e build do consumidor.

## Conventions that differ from defaults

- Imports relativos com extensão `.js` em `src/` e `test/` (NodeNext); sem ela o `tsc` falha com TS2835.
- Alterou a derivação? Incremente `ENGINE_VERSION` em `src/application/apply/constants.ts`. Alterou layout/serialização da planilha? Incremente `EVIDENCE_WRITER_VERSION` em `src/adapters/reports/evidence-writer.constants.ts`.

## Known pitfalls

- `npm link` é apenas local e não é reproduzível na CI. Não adicionar tarballs ou links à árvore versionada dos apps.
- Bibliotecas como `exceljs`, `jszip` e `typescript` pertencem ao motor/CLI; não introduzir seus imports no runtime Angular/browser.

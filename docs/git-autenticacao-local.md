# Autenticação GitHub exclusiva deste repositório

O `origin` continua sendo `https://github.com/renanaribeiro91/auto-tracking-angular.git`, sem senha ou token na URL. A identidade de commit é definida com `git config --local user.name` e `git config --local user.email`, apenas neste repositório.

O arquivo **`.env.git.local`** é ignorado pelo Git e deve permanecer com permissão `600`:

```dotenv
GITHUB_USERNAME=renanaribeiro91
GITHUB_TOKEN=COLE_UM_TOKEN_NOVO_SOMENTE_NO_ARQUIVO_LOCAL
```

**Não use um token que foi publicado em chat, log ou issue; revogue-o e gere outro na sua conta GitHub.** Evite salvar qualquer segredo em `README`, scripts versionados, URLs remotas, `package.json` ou `git config`.

O script versionado `scripts/git-credential-local.sh` lê esse arquivo **sem executar seu conteúdo**, somente para `https://github.com/renanaribeiro91/auto-tracking-angular.git`. O Git usa esse helper exclusivamente quando configurado no `.git/config` deste repositório:

```bash
git config --local user.name renanaribeiro91
git config --local user.email 69402932+renanaribeiro91@users.noreply.github.com
git config --local credential.useHttpPath true
git config --local --add credential.helper ''
git config --local --add credential.helper "!$(pwd)/scripts/git-credential-local.sh"
chmod 600 .env.git.local
```

O helper ignora as ações `store` e `erase` e não grava ou envia segredos fora do fluxo de credenciais do Git. `git push origin main` deve ser executado na rede autorizada, após conferir que o token tem permissão de escrita no repositório. Isso **não altera as credenciais do FED nem do MOB**, que têm outras políticas de rede.

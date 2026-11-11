#!/bin/sh
# Hook git do auto-tracking-angular, chamado pelo bloco que `auto-tracking hooks install` grava no app.
# Acha o Node (clientes Git gráficos não herdam o PATH do terminal) e entrega tudo à lib.
# Uso: sh hook.sh <pre-commit|pre-push> <raiz-do-projeto>
command -v node >/dev/null 2>&1 || PATH="$HOME/.volta/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
  nvm use --silent >/dev/null 2>&1 || nvm use default --silent >/dev/null 2>&1
fi
command -v node >/dev/null 2>&1 || { echo "[auto-tracking] Node.js não encontrado no PATH do Git." >&2; exit 1; }
exec node "$(dirname -- "$0")/../dist/cli/index.js" hook "$1" --root "$2"

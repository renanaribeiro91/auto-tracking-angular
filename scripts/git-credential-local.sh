#!/usr/bin/env bash
# Helper local Git: somente este repositório/host, sem credenciais em URLs ou git config.
set -euo pipefail
[[ "${1:-get}" == 'get' ]] || exit 0
protocol=''; host=''; repository=''
while IFS='=' read -r key value; do
  case "$key" in
    protocol) protocol="$value" ;;
    host) host="$value" ;;
    path) repository="$value" ;;
  esac
done
[[ "$protocol" == 'https' && "$host" == 'github.com' && "$repository" == 'renanaribeiro91/auto-tracking-angular.git' ]] || exit 0
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
secrets="$repo_root/.env.git.local"
[[ -f "$secrets" && ! -L "$secrets" ]] || exit 0
# Local file must be readable only by the account owner (macOS/Linux).
mode="$(stat -f '%Lp' "$secrets" 2>/dev/null || stat -c '%a' "$secrets" 2>/dev/null || true)"
[[ "$mode" == '600' ]] || exit 0
username=''; token=''
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    GITHUB_USERNAME=*) username="${line#GITHUB_USERNAME=}" ;;
    GITHUB_TOKEN=*) token="${line#GITHUB_TOKEN=}" ;;
  esac
done < "$secrets"
[[ -n "$username" && -n "$token" ]] || exit 0
printf 'username=%s\npassword=%s\n' "$username" "$token"

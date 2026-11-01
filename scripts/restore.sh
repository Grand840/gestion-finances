#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?Usage: scripts/restore.sh sauvegarde.dump}"
test -s "$file"
echo "ATTENTION : cette restauration remplace les données PostgreSQL actuelles."
read -r -p "Tapez RESTAURER pour continuer : " answer
[[ "$answer" == RESTAURER ]] || exit 1
docker compose stop app
trap 'docker compose start app' EXIT
docker compose exec -T db pg_restore -U postgres --clean --if-exists --no-owner --role=sillage --dbname=sillage --single-transaction < "$file"
docker compose exec -T db psql -U postgres -d sillage -v ON_ERROR_STOP=1 -c "TRUNCATE sessions,password_resets; DELETE FROM invitations WHERE used_at IS NULL;"
echo "Restauration terminée. Sessions, codes de récupération et invitations en attente invalidés."

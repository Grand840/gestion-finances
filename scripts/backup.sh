#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
file="backups/sillage-$(date +%Y%m%d-%H%M%S).dump"
trap 'rm -f "$file"' ERR
docker compose exec -T db pg_dump -U postgres -Fc sillage > "$file"
test -s "$file"
echo "Sauvegarde créée : $file — à copier sur un autre support sécurisé."

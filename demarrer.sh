#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then python3 scripts/configure.py; fi
docker compose up -d --build
echo "Sillage démarré. Consultez docker compose ps puis http://localhost:8080."

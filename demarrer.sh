#!/usr/bin/env bash
# Script de lancement de l'application de Gestion Financière & Patrimoine

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo "  Sillage — Vos finances, en clair"
echo "=========================================================="

IP=$(hostname -I | awk '{print $1}')
PORT=8080

echo "📍 Accès sur votre ordinateur : http://localhost:$PORT"
if [ -n "$IP" ]; then
  echo "📱 Accès sur votre téléphone (même Wi-Fi) : http://$IP:$PORT"
fi
echo "=========================================================="
echo "Appuyez sur Ctrl+C pour arrêter l'application."
echo ""

python3 "$DIR/server.py"

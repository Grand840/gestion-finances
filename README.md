# Sillage — Vos finances, en clair

Application personnelle de gestion financière en français, pensée pour les comptes bancaires, le Mobile Money (T-Money, Moov Money) et les espèces. Python 3, SQLite et JavaScript natif : aucune dépendance de production ni étape de compilation.

## Démarrage

```bash
./demarrer.sh
# ou
python3 server.py
```

Ouvrez **http://localhost:8080**. Le serveur écoute sur `0.0.0.0` et peut être consulté depuis un appareil du même réseau. La base `finances.db` est créée au premier lancement avec quatre comptes à zéro. Aucun exemple de transaction ni montant fictif n’est inséré.

## Un espace financier cohérent

- **Vue d’ensemble** : disponible réel, patrimoine net, prêts à récupérer et détail du calcul du disponible.
- **Transactions** : recherche, filtres, journal des 200 dernières opérations et export CSV du résultat filtré. Les cinq dernières opérations filtrées sont reprises sur l’accueil.
- **Mes comptes** : banques, Mobile Money et espèces, avec création de comptes et soldes actualisés.
- **Prêts accordés et emprunts** : suivi des encours, versements partiels et reçus imprimables en PDF via le navigateur.
- **Fonds de tiers** : suivi de l’argent confié et restitution, sans confusion avec les fonds personnels.
- **Patrimoine** : biens, immobilier, placements et stocks.
- **Paramètres** : profil, devise d’affichage, verrouillage de l’interface par PIN et sauvegarde JSON.

### Règles de lecture

Le disponible réel est calculé comme suit : **liquidités − fonds de tiers restants − emprunts restant dus**. Le patrimoine net y ajoute les créances et la valeur actuelle des actifs. La répartition affiche uniquement les soldes positifs ; les postes de dépenses présentent les cinq premières catégories par montant cumulé, frais inclus, hors prêts, remboursements de dettes et fonds de tiers. Un disponible négatif est affiché comme tel, sans masquer le déficit.

La devise principale est une préférence d’affichage, pas un moteur de conversion de devises. Les montants sont présentés sans décimales. Les graphiques sont issus des données enregistrées, jamais de données de démonstration.

## Interface

Identité Sillage, palette vert profond et ivoire, pictogrammes SVG locaux, navigation latérale sur ordinateur et navigation compacte avec menu complet sur mobile. Fenêtres fermables par Échap ou clic à l’extérieur, focus clavier encadré, confirmations non bloquantes et adaptation aux préférences de mouvement réduit.

Les ressources sont locales : aucune police ou bibliothèque chargée depuis un CDN. La PWA peut être ajoutée à l’écran d’accueil. Le service worker conserve l’interface hors ligne, **pas les réponses financières de l’API** : le serveur doit être joignable pour lire ou enregistrer les données.

## Données et sécurité

Les données restent dans la base SQLite du serveur ; les changements d’interface ne modifient pas la structure de cette base. Conservez une copie de `finances.db` et exportez régulièrement la sauvegarde JSON. Il n’existe pas encore d’import JSON dans l’interface.

**Usage personnel sur une machine ou un réseau de confiance uniquement.** Le PIN verrouille l’interface mais n’authentifie pas les requêtes de l’API. Ce projet ne fournit pas encore d’authentification serveur, de chiffrement de la base ou de gestion multi-utilisateur. Ne l’exposez pas publiquement avec des données réelles sans sécuriser ces éléments. L’aperçu de développement n’est pas un hébergement sécurisé de production.

## Vérifications

```bash
python3 -m py_compile server.py database.py
node --check public/js/app.js
node --check public/js/api.js
node --check public/sw.js
python3 -m unittest discover -s tests -v
```

Le calcul du disponible a été corrigé pour déduire les emprunts, conformément au principe de séparation annoncé par le projet. Le socle historique reste en place ; une mise en production nécessitera un audit dédié de ses validations et de sa sécurité.

### Parcours navigateur (facultatif, Node.js 20+)

```bash
npm ci
npx playwright install chromium
npm run test:ui
```

Les tests créent leur propre serveur et une base temporaire, supprimée en fin de test. Ils couvrent les opérations, prêts, emprunts, remboursements, reçus, fonds de tiers, patrimoine, recherche, export CSV, PIN et cinq largeurs d’écran. Ils ne touchent jamais à `finances.db`. Un Chromium déjà installé peut être utilisé via `BROWSER_EXECUTABLE_PATH` ; `BROWSER_ARGS` accepte une liste JSON d’arguments et `PYTHON` permet de choisir l’interpréteur Python.

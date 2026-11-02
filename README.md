# Sillage Famille

**Vos finances, en clair.** Une application web familiale en français, auto-hébergée : chaque membre possède son propre espace financier. Version 2 : authentification serveur, PostgreSQL, reçus PDF et Docker Compose.

## Nouveautés 2.1 — dossiers, comptes dédiés et documents

- **Suppression confirmée d’un compte personnel** : recopier son nom. La suppression définitive n’est autorisée qu’à solde nul, sans mouvement ni lien financier. Sinon, conserver le journal et utiliser l’archivage à solde nul. Les comptes dédiés ne se suppriment pas manuellement.
- **Prêts et emprunts repliables** : résumé par dossier/personne, recherche, tout déplier/replier, historique détaillé des acomptes, motifs, échéance et alerte visuelle en cas de retard. Les dossiers soldés restent consultables.
- **Rapport complet de prêt ou d’emprunt** : capital initial, parties, motifs, dates, échéance, chaque acompte, référence du reçu, cumul remboursé et restant dû. Pour les emprunts : mise à disposition, achats/frais et provisions sont distingués des remboursements.
- **Fonds de tiers par personne** : plusieurs dépôts dans le même compte dédié, achats avec frais, restitutions, historique chronologique avec solde progressif et relevé PDF exhaustif. Sélectionner une personne existante pour un nouveau dépôt ; « Nouvelle personne » crée une identité distincte, même en cas d’homonymie.
- **Comptes dédiés verrouillés** : les fonds de tiers sont encaissés uniquement dans le compartiment de la personne ; chaque nouvel emprunt dans son compte emprunt. Pas de choix d’un compte personnel à l’encaissement. Achats/restitutions/acompte d’emprunt débitent obligatoirement le compte dédié, y compris côté API. Les opérations personnelles et virements ordinaires ne peuvent pas utiliser ces comptes.
- **Vie du compte emprunt** : tracer une utilisation des fonds ou alimenter le compte depuis un compte personnel pour préparer un remboursement. Une provision n’est pas un remboursement et ne réduit pas la dette. Le solde de caisse et le restant dû sont affichés séparément.
- **Relevé complet d’un compte** depuis sa fiche ; chaque rapport/relevé émis est figé, privé et disponible dans **Paramètres → Documents émis** (100 derniers ; tous dans l’export personnel).

Ces comptes dédiés sont des **compartiments de gestion internes** : ils ne créent pas de véritables comptes bancaires et ne constituent pas un rapprochement automatique avec une banque.

### Importer la signature

Dans **Paramètres → Signature des documents**, importer sa propre image PNG/JPEG et confirmer l’autorisation d’en insérer une copie. Limites : 512 Ko, 4 millions de pixels ; normalisation PNG, orientation respectée, métadonnées supprimées, dimension maximale 900 × 300. L’image reste en PostgreSQL, n’est jamais publiée dans les ressources statiques et fait partie des sauvegardes.

Les nouveaux reçus signés et rapports/relevés conservent la copie de signature à leur émission. Un changement ou retrait du profil ne modifie pas ces documents. Pour un reçu sans signature à l’origine, la signature actuelle peut être appliquée à la réédition : c’est indiqué explicitement et elle reste hors de l’empreinte du reçu original. Les anciens rapports figés ne sont pas réécrits : émettre un nouveau rapport depuis le dossier pour utiliser la nouvelle signature.

Le cachet vectoriel est agrandi et sa légende dépend du document : quittance de prêt, reçu d’emprunt, rapport d’engagement, relevé de tiers ou relevé de compte. Une signature importée est une **copie de profil**, pas la signature d’une autre partie ni une signature électronique certifiée. Aucune signature réelle ou fictive n’est installée par défaut ; les images « SPECIMEN » des tests ne sont utilisées que dans des bases éphémères.

### Mise à jour depuis la version familiale 2.0

**Ne réinitialisez pas votre volume. Sauvegardez avant la mise à jour.**

```bash
./scripts/backup.sh
docker compose up -d --build
```

La migration `003_documents_wallets.sql` conserve les opérations et les reçus existants :

1. Les anciens dépôts de tiers portant exactement le même nom et téléphone sont regroupés. Leur reliquat est reclassé vers le compte dédié par des virements explicites « Reclassement tiers », sans changer le total de liquidités. Si les liquidités sont insuffisantes, la migration échoue entièrement et n’applique aucune modification partielle : vérifier les soldes avant de recommencer, sans effacer les données.
2. Les anciens emprunts reçoivent un compte dédié **à zéro**, sans encaisser leur capital une seconde fois. Les soldes des comptes personnels et la dette existante sont conservés (hors reclassement tiers). Un avis apparaît dans le dossier : utiliser « Alimenter pour rembourser » avant les futurs acomptes si nécessaire. Les anciens mouvements et leurs comptes d’origine restent traçables.
3. Les futures opérations suivent exclusivement les nouveaux comptes verrouillés. Les anciens clients API envoyant un compte personnel pour un dépôt de tiers ou un nouvel emprunt sont refusés : mettre à jour l’interface en même temps que le serveur.

La CI vérifie aussi une migration avec données 2.0, la génération de PDF longs, la confidentialité de la signature et la sauvegarde/restauration Docker. Cela ne remplace pas une sauvegarde et une restauration de contrôle sur votre installation.

## Démarrage local avec Docker

Prérequis : **Docker Engine + Docker Compose v2**, Python 3 pour générer les secrets.

```bash
python3 scripts/configure.py  # crée .env, ne remplace jamais un fichier existant
docker compose up -d --build
docker compose ps
```

Ouvrez **http://localhost:8080**. Sur la première inscription, saisissez le code **`SETUP_TOKEN` présent dans votre fichier `.env`**. Ce premier compte devient administrateur. Aucun identifiant ni mot de passe par défaut n’est fourni. Ne publiez pas le fichier `.env`.

L’administrateur crée ensuite une invitation dans **Gestion de la famille** et la transmet en privé. Les proches utilisent « Créer un compte », leur adresse e-mail et ce code. Une invitation est valable 7 jours, pour un seul compte ; les invitations non utilisées peuvent être révoquées.

> L’HTTP est prévu pour les essais locaux uniquement. Pour un accès familial depuis d’autres appareils, configurez HTTPS ou utilisez un VPN de confiance avec HTTPS. N’exposez pas directement le port 8080 sur Internet.

### Une base neuve, volontairement

Cette version utilise exclusivement PostgreSQL. L’ancien fichier SQLite `finances.db` n’est **ni utilisé ni importé**. Vous avez demandé une réinitialisation sans données personnelles : aucun ancien utilisateur, compte ou mouvement n’est migré. Les nouveaux espaces reçoivent simplement quatre portefeuilles **à zéro**, modifiables et archivables. Aucun exemple de personne ou d’opération n’est inséré.

Les migrations SQL versionnées s’appliquent au démarrage, sous verrou PostgreSQL, avec vérification de leur empreinte. Elles ne réinitialisent pas un volume existant.

## Ce qui est disponible

### Accès familial et confidentialité

- Inscription par invitation, connexion, déconnexion et statut de session.
- Mots de passe Argon2id, minimum 12 caractères ; cookie de session HttpOnly, SameSite=Lax, durée de 24 heures par défaut ; jeton de session stocké sous forme d’empreinte en base.
- Vérification de l’utilisateur et de la propriété des ressources **côté serveur**, y compris pour les PDF et exports. Aucun accès financier automatique pour l’administrateur.
- Protection CSRF et contrôle d’origine pour les écritures, limitation des tentatives d’accès, révocation des sessions après changement de mot de passe ou désactivation.
- Gestion des membres actifs/désactivés, invitations et récupération d’accès par code valable 30 minutes, à usage unique. Aucun envoi d’e-mail n’est configuré.
- Journal d’activité personnel ; aucune donnée financière ni session n’est stockée dans localStorage. L’interface est vidée lors de la déconnexion.

L’administrateur **technique du serveur** conserve naturellement accès à PostgreSQL et aux sauvegardes : il ne s’agit pas de chiffrement de bout en bout.

### Comptes et opérations

- Espèces, comptes bancaires et Mobile Money, solde initial tracé dans le journal.
- **Cliquer sur un compte** ouvre son solde, ses totaux et son historique paginé, avec catégories, motifs, descriptions, frais, références et virements entrants/sortants.
- Recherche sur la page chargée ; pagination par 50 opérations ; modification du nom/numéro, archivage à solde nul et consultation/réactivation des comptes archivés, sans effacer le journal.
- Journal global des 200 dernières opérations avec filtres et export CSV du résultat filtré ; export JSON de tout son espace personnel.
- Une seule devise par espace (FCFA, EUR ou USD). Le choix est verrouillé après la première opération : aucune conversion implicite.

### Engagements et fonds confiés

- Prêts accordés, emprunts reçus, dates convenues, notes, versements partiels et solde final.
- Fonds de tiers : dépôt, **achat pour le tiers avec frais**, restitution et reliquat.
- Actifs : biens matériels, immobilier, placements et stocks.
- Les prêts, remboursements et opérations de tiers sont exclus du graphique des dépenses personnelles.
- Disponible réel = liquidités − fonds confiés restants − emprunts restant dus. Un déficit n’est pas masqué.

### Reçus professionnels

Chaque remboursement crée **dans la même transaction PostgreSQL** un reçu personnel :

- logo Sillage, référence unique, date et numéro de versement ;
- identité des parties et motif de l’engagement ;
- montant initial, solde avant versement, montant versé, cumul remboursé et **reste à rembourser** ;
- compte utilisé, observations, état partiel/soldé et emplacements de signature ;
- cachet vectoriel Sillage et empreinte SHA-256 des données du reçu ;
- aperçu immédiat, historique et **PDF généré côté serveur**, téléchargeable sans dépendre de l’impression du navigateur.

Les informations du reçu sont figées au moment du versement : un changement de nom, un nouveau remboursement ou un renommage de compte ne réécrit pas un ancien reçu. PostgreSQL interdit les modifications/suppressions des reçus via un déclencheur.

**Le cachet est applicatif, pas officiel.** L’empreinte n’est pas une signature cryptographique d’un tiers de confiance. Le PDF ne remplace ni une certification bancaire ni la signature effective des parties.

### Fiabilité des montants

Les montants sont stockés en `NUMERIC(18,2)` et calculés avec `Decimal` côté serveur. Les écritures d’un utilisateur sont sérialisées et atomiques : solde, encours, mouvement et reçu sont validés ensemble. Les montants négatifs, dépassements d’encours, soldes insuffisants, auto-virements et dépenses personnelles utilisant les fonds confiés sont refusés. L’API accepte une clé d’idempotence pour ne pas répéter une écriture rejouée avec la même clé ; l’interface empêche les doubles clics de soumission.

## Serveur de maison et HTTPS

PostgreSQL n’expose **aucun port hôte**. Son volume est persistant ; l’application s’exécute sans privilèges, avec système de fichiers en lecture seule. Le rôle SQL de l’application n’est pas superutilisateur.

Pour activer le reverse proxy Caddy fourni :

1. Configurez un nom DNS atteignable par vos appareils et un certificat adapté (Caddy gère les certificats publics quand le domaine et les ports sont correctement configurés).
2. Modifiez `.env` :

```dotenv
APP_BIND=127.0.0.1
COOKIE_SECURE=true
FORWARDED_ALLOW_IPS=*
SILLAGE_DOMAIN=finances.votre-domaine.fr
```

3. Lancez :

```bash
docker compose --profile https up -d --build
```

Le port applicatif est alors limité à la machine hôte ; les navigateurs passent par Caddy en HTTPS. `FORWARDED_ALLOW_IPS=*` n’est approprié **que dans cette configuration avec proxy de confiance et port applicatif non exposé**. Pour `localhost`, Caddy utilise une autorité locale : il faut la faire approuver par les appareils ; un certificat local non approuvé ne constitue pas une installation prête pour la famille.

Préférez un accès privé via VPN à l’ouverture publique du serveur de maison. Gardez le système, Docker et les images à jour. Les secrets générés sont aléatoires et le fichier `.env` est créé avec des permissions `0600`. Conservez les mots de passe SQL générés au format hexadécimal ; les changements d’identifiants SQL après initialisation nécessitent une modification du rôle en base, pas seulement du fichier `.env`.

## Récupération d’accès

Pour un membre actif, l’administrateur peut générer un code dans **Gestion de la famille → Récupérer l’accès**. Le membre choisit « Réinitialiser avec un code » sur l’écran de connexion. Cela révoque ses sessions et invalide les autres codes de récupération.

Si l’administrateur a lui-même perdu son accès, depuis la console de confiance du serveur :

```bash
docker compose exec app python scripts/recover.py adresse-de-l-admin@exemple.fr
```

Le code affiché est un secret personnel : ne le copiez pas dans les logs partagés ou sur GitHub. Il expire après 30 minutes. La console ne change pas le mot de passe directement.

## Sauvegarder, restaurer, mettre à jour

```bash
./scripts/backup.sh
./scripts/restore.sh backups/sillage-AAAAMMJJ-HHMMSS.dump
```

La restauration demande confirmation, arrête l’application, remplace les objets dans une transaction, invalide les sessions et les codes en attente, puis redémarre l’application. **Testez une restauration sur une instance distincte avant de compter sur vos sauvegardes.** Une sauvegarde contient les informations financières, les copies de signatures, les documents et les empreintes de mots de passe : chiffrez-la et copiez-la sur un autre support avec accès restreint. Le volume Docker seul n’est pas une sauvegarde. L’export JSON personnel est consultable mais aucun import JSON n’est fourni.

Pour mettre à jour : sauvegardez, récupérez le code, puis `docker compose up -d --build`. Conservez `.env`. Ne lancez pas `docker compose down -v` sur des données à conserver : cela supprime les volumes.

## Développement et tests

Production : Python 3.12, FastAPI, psycopg 3, PostgreSQL 17 et JavaScript natif ; aucune compilation front-end nécessaire. Les ressources visuelles sont locales, sans CDN. Le service worker conserve uniquement l’interface, **jamais les réponses financières de l’API**. Le serveur doit être joignable pour utiliser les données.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
npm ci
npx playwright install chromium
PYTHON=.venv/bin/python npm run test:ui
```

Les tests utilisent de vrais serveurs PostgreSQL temporaires via `pgserver`, et **ne touchent jamais aux données de votre installation**. La CI GitHub construit et démarre aussi les conteneurs, vérifie les écritures/PDF avec le rôle SQL applicatif, puis sauvegarde et restaure la base éphémère. Ces contrôles ne remplacent pas une restauration vérifiée sur votre propre serveur. Le navigateur vérifie aussi les suppressions confirmées, dossiers repliables, import de signature, rapports/relevés, comptes verrouillés et cinq tailles d’écran, en plus de l’authentification et de l’isolation entre membres. `BROWSER_EXECUTABLE_PATH` et `BROWSER_ARGS` permettent d’utiliser un navigateur existant.

Pour un aperçu local de développement sans Docker, après avoir installé les dépendances de développement et généré `.env` : `python scripts/local-preview.py`. Cette commande utilise un PostgreSQL local sous `.local/`, distinct du volume Docker ; elle n’est pas une méthode de déploiement de production.

## Limites et prochaines évolutions

Le socle familial demandé est en place. Il ne prétend pas être un logiciel bancaire audité :

- pas de synchronisation bancaire, de paiement, de conversion de devises ni de comptabilité réglementaire ;
- pas encore de budgets, récurrences, pièces jointes, notifications d’échéance ou comptes partagés à plusieurs propriétaires ;
- pas de 2FA ni de livraison d’e-mails ; la récupération est volontairement administrée ;
- pas encore d’annulation comptable guidée d’une opération : les écritures historiques ne sont pas modifiables depuis l’interface ;
- pas d’audit de sécurité externe ni de test de charge de production.

Avant une exposition publique : HTTPS validé, sauvegardes/restauration vérifiées, mises à jour, supervision et audit de sécurité sont indispensables. Les fichiers Docker sont fournis ; l’exécution de Docker dépend de votre machine et doit être vérifiée sur celle-ci.

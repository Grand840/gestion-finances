# 🏛️ Finances & Patrimoine — Gestion et Ségrégation des Fonds

Application financière professionnelle, épurée et ergonomique avec **thème Beige Prestige**, conçue pour la gestion réelle du patrimoine : **Comptes liquidités (Wave, Orange, Banques, Espèces)**, **Compte Emprunts reçus (Dettes)**, **Compte Prêts accordés (Créances)** et **Argent de Tiers sous séquestre**.

---

## 🎨 Nouveau Thème Beige Pro & Ergonomie

- **Esthétique Private Banking** : Nuances chaleureuses de sable, beige et ivoire (`#f8f6f0`, `#ffffff`, `#eae3d2`), typographie soignée avec alignement tabulaire des chiffres.
- **Accents nobles** : Doré cuivré pour le prestige, vert forêt pour les rentrées et prêts récupérés, bordeaux feutré pour les dépenses et remboursements d'emprunts.
- **Expérience tactile fluide** : Boutons d'actions rapides (Opération courante, Prêter, Emprunter, Tiers), barres de progression dynamiques et barre de navigation ergonomique au bas de l'écran.

---

## 💡 Principes de Ségrégation Financière

### 1. Séparation stricte du Capital Propre
Un emprunt que vous contractez **ne gonfle jamais artificiellement votre capital propre**.
- **Liquidités en caisse** : Tout ce qui se trouve physiquement sur vos comptes (Wave, Banques, Poche).
- **Argent d'autrui sous séquestre** : Argent confié par des proches pour des courses ou en garde (totalement déduit de votre disponible).
- **Mon Capital Propre Disponible** : Ce qui vous appartient réellement à 100%.

### 2. Compte Dédié : Emprunts Reçus (Ce que je dois)
- Quand vous prenez un crédit bancaire ou empruntez à un proche, il est logé dans votre compte **Emprunts**.
- L'argent peut être versé sur un compte (ex: Banque BOA) ou utilisé directement.
- Pour rembourser, vous cliquez sur **« Rembourser un acompte »** et vous choisissez **quel compte débiter** (votre poche, Wave, Orange Money ou compte bancaire).
- Au fur et à mesure des remboursements, le compte débité diminue et l'encours de votre emprunt diminue jusqu'à extinction.

### 3. Compte Dédié : Prêts Accordés (Ce qu'on me doit)
- Quand vous prêtez de l'argent à un ami ou collaborateur : l'argent est **débité immédiatement** du compte choisi (Poche, MoMo, Banque) et va s'ajouter dans votre **Compte Prêts accordés**.
- Quand la personne vous rembourse par tranche : vous cliquez sur **« Encaisser un acompte »** et vous choisissez **sur quel compte encaisser** (Poche, MoMo, Banque). L'argent rentre sur votre compte et sa dette diminue.

### 4. Compte Tiers (Mandats & Séquestres)
- Quand un proche (ex: Paul) vous confie 50 000 FCFA sur Wave pour faire un achat : il est enregistré comme tiers.
- Cet argent est **exclu de votre disponible réel**. Vous ne risquez jamais de le dépenser par mégarde.
- Restitution du reliquat en un clic.

---

## 🚀 Accès & Utilisation

Le serveur est déjà actif en tâche de fond :

- 🖥️ **Sur votre ordinateur** : [http://localhost:8080](http://localhost:8080)
- 📱 **Sur votre smartphone (connecté au même Wi-Fi)** : [http://192.168.3.61:8080](http://192.168.3.61:8080)
  *(Cliquez sur « Ajouter à l'écran d'accueil » sur votre navigateur mobile pour l'utiliser comme une vraie application native sans barre d'adresse).*

Pour redémarrer l'application à tout moment :
```bash
/home/ytchao/Documents/Projets/gestion-finances/demarrer.sh
```

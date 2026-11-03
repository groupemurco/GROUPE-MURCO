# Groupe Murco — Gestion

**Ouvrir l'application:** <https://groupemurco.github.io/GROUPE-MURCO/>
(sur l'ordi: ouvre le lien dans Chrome/Edge et clique l'icône « Installer » dans la barre d'adresse;
sur iPhone: Safari → Partager → « Sur l'écran d'accueil »; sur Android: Chrome → ⋮ → « Installer l'application »)

Application de gestion d'entreprise (web + mobile) faite sur mesure pour Groupe Murco Inc.:
factures, soumissions, clients, journal de bord (km), reçus avec photos, Gmail et dossier pour le comptable.
Tout est relié ensemble.

## Ce que ça fait

| Module | Fonctionnalités |
|---|---|
| **Facture express** | Sur le cell, en 30 secondes: client → touche les codes → quantité → « Créer et partager » (texto, Messenger, courriel). **Dictée vocale**: « NDG 120 pieds et lavage de vitres 12 fenêtres chez Tremblay ». Payé comptant sur place avec photo de l'argent |
| **Factures et soumissions** | Codes de job (NDG, LAP, LVE…) avec prix et minimum par ligne, calculateur pi² / pi lin, rabais, dépôt (avec photo), paiements avec photo de preuve, PDF avec photos avant/après |
| **Lien client (portail)** | Le client ouvre un lien sans compte: voit sa soumission, **l'accepte et la signe au doigt**; la signature revient dans l'app et la soumission passe « Acceptée ». Pour une facture: comment payer (Interac) |
| **Agenda des jobs** | Calendrier, ordre de la journée optimisé, **route du jour dans Google Maps**, jobs récurrents (gouttières chaque automne…), rappels au client par texto/courriel, job → facture en 1 clic |
| **Journal de bord automatique** | Route de la journée domicile → jobs → domicile quand les jobs sont « Faits »; sinon aller-retour par facture. Distances Google Maps. Export PDF/Excel |
| **Photos** | Avant / après sur chaque job et facture, preuves de paiement comptant et bordereaux de dépôt, reçus de dépenses (GPS de la photo → km depuis la maison) |
| **Tableau de bord** | Jobs du jour, factures à encaisser avec **relance** en 1 clic, revenus des 12 derniers mois, ventes par code de job, soumissions vues/signées |
| **Synchronisation** | Ordi ↔ cell en temps réel (Firebase, gratuit), hors-ligne, photos incluses |
| **Dossier comptable** | ZIP: sommaire, factures PDF, reçus par catégorie, preuves de paiement, journal de bord, fichiers Excel/CSV |
| **Classeur** | Tous les reçus, photos de jobs, preuves de paiement, factures et soumissions au même endroit, classés par mois; recherche (même dans le texte des reçus); ZIP classé `Année/Mois/Type` |
| **Lecture des reçus** | Photo du reçu → montant, TPS, TVQ, date, commerce et catégorie remplis tout seuls (lecture sur l'appareil, sans Internet) |
| **Rentabilité** | Profit réel par job (prix − matériaux − km − heures), marge, taux horaire réel, ventes par code, meilleurs clients |
| **TPS/TVQ** | Rapport par période (mensuel, trimestriel, annuel) avec PDF; suivi du seuil de 30 000 $ du petit fournisseur |
| **Paiement par carte** | Bouton « Payer par carte » dans le lien client (Stripe: Visa, Mastercard, Apple Pay, Google Pay); le paiement s'ajoute tout seul à la facture |
| **Apps mobiles** | App Android (APK construit automatiquement) et projet iPhone prêt pour l'App Store |
| **Pro** | Recherche rapide partout (Ctrl+K), bouton + sur le cell, mode sombre, annulation après suppression, vérification avant d'envoyer au comptable, fonctionne hors-ligne |

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # version de production dans dist/
```

Puis dans l'app: **Paramètres** → entre les infos de la compagnie (adresse, NEQ, TPS, TVQ, RBQ, logo) et
**l'adresse de ton domicile** (point de départ du journal de bord).

## Mettre en ligne (pour l'utiliser sur ton téléphone)

Le fichier `.github/workflows/deploy.yml` publie l'app sur GitHub Pages à chaque mise à jour.
Si la publication échoue la première fois: sur GitHub, *Settings → Pages → Source: **GitHub Actions***, puis relance le workflow
(*Actions → Déployer l'application → Run workflow*).

Ensuite sur le téléphone:
- **iPhone**: Safari → Partager → « Sur l'écran d'accueil »
- **Android**: Chrome → ⋮ → « Installer l'application »

## Synchronisation (une seule fois, ~10 min)

1. <https://console.firebase.google.com/> → **Créer un projet** « murco ».
2. **Authentication → Commencer** → active **Adresse e-mail/Mot de passe** (et Google si désiré).
3. **Authentication → Paramètres → Domaines autorisés** → ajoute `groupemurco.github.io`.
4. **Firestore Database → Créer une base** → région `northamerica-northeast1 (Montréal)`, mode production.
   Onglet **Règles**: colle le contenu de [`firestore.rules`](firestore.rules) → **Publier**
   (ces règles protègent tes données et permettent au client de seulement voir/signer sa soumission).
5. **⚙️ Paramètres du projet → Vos applications → `</>` Web** → copie le bloc `firebaseConfig`.
6. Dans l'app: **Paramètres → Synchronisation** → colle le bloc → **Créer mon compte**.
7. Pour le téléphone: copie le « lien pour connecter ton téléphone » (dans Paramètres), ouvre-le sur le téléphone, connecte-toi avec le même courriel/mot de passe.

Optionnel: mets le bloc `firebaseConfig` dans une variable de dépôt GitHub nommée `FIREBASE_CONFIG`
(*Settings → Secrets and variables → Actions → Variables*) pour qu'il soit intégré à l'app publiée.

Forfait gratuit Firebase (Spark): 1 Go de données et 50 000 lectures/jour, largement suffisant.

## Google Maps (km exacts et adresses)

1. <https://console.cloud.google.com/google/maps-apis/start> (même projet que Firebase).
2. Active: **Maps JavaScript API**, **Geocoding API**, **Routes API**, **Places API (New)**, **Maps Embed API**.
3. **Clés et identifiants → Créer une clé API** → restriction « Sites Web »: `https://groupemurco.github.io/*`.
4. Colle la clé dans **Paramètres → Google Maps** → **Tester**. La clé se synchronise sur le téléphone.

Google offre un crédit mensuel gratuit qui couvre largement l'usage d'une petite entreprise.

## App Android

À chaque mise à jour, GitHub construit l'app: **https://github.com/groupemurco/GROUPE-MURCO/releases/tag/android-latest**
→ télécharge `Murco.apk` sur le téléphone et ouvre-le (autorise « sources inconnues » la première fois).
Les mises à jour s'installent par-dessus. Pour le Play Store (25 $ une fois): créer une clé de publication privée
(secret GitHub) et produire un AAB signé.

## App iPhone

Le projet Xcode est dans `ios/` (GitHub vérifie qu'il se compile). Pour l'App Store il faut un compte
**Apple Developer** (99 $ US/an). Ensuite: certificats dans les secrets GitHub et publication via TestFlight.

Dans l'app mobile, l'envoi de courriels passe par la feuille de partage du téléphone (Gmail, Outlook…)
avec le PDF déjà attaché. Ajouter aussi `https://localhost/*` et `capacitor://localhost/*` aux sites autorisés
de la clé Google Maps.

## Paiement par carte (Stripe)

1. Compte sur <https://stripe.com> (Canada).
2. Firebase: passer au forfait **Blaze** (paiement à l'usage, ~0 $ à petit volume) — nécessaire pour les fonctions.
3. Dans Stripe → Développeurs → Webhooks → ajouter
   `https://northamerica-northeast1-<ID-du-projet>.cloudfunctions.net/stripeWebhook`
   (événement `checkout.session.completed`) et copier le « secret de signature » (`whsec_…`).
4. Ouvrir **Cloud Shell** (<https://shell.cloud.google.com>, bouton `>_` dans la console Google Cloud) et coller:
   ```bash
   git clone https://github.com/groupemurco/GROUPE-MURCO && cd GROUPE-MURCO
   npx -y firebase-tools login --no-localhost
   npx -y firebase-tools functions:secrets:set STRIPE_SECRET_KEY --project <ID-du-projet>      # colle sk_live_…
   npx -y firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET --project <ID-du-projet>  # colle whsec_…
   npx -y firebase-tools deploy --only functions,firestore:rules --project <ID-du-projet>
   ```
   (installe le service de paiement **et** les règles de sécurité Firestore).
5. Dans l'app: Paramètres → Paiement par carte → cocher et enregistrer.

Frais Stripe: environ 2,9 % + 0,30 $ par paiement. Au Québec, la Loi sur la protection du consommateur
interdit d'ajouter ces frais au client.

## Vendre le logiciel (abonnements)

Le nom du produit, l'exploitant et la date des « membres fondateurs » (gratuits à vie) sont dans `src/brand.ts`; les forfaits affichés dans `src/lib/plans.ts`.

1. **GitHub → Settings → Secrets and variables → Actions → Variables**:
   - `FIREBASE_CONFIG`: le bloc `firebaseConfig` de ton projet Firebase (les nouveaux clients n'ont rien à configurer);
   - `API_URL`: `https://northamerica-northeast1-<ID-du-projet>.cloudfunctions.net`.
2. **Stripe → Catalogue de produits**: un produit avec 3 prix mensuels récurrents en $ CA (Solo 39, Équipe 79, Pro 129).
   Copie les identifiants `price_…` dans `functions/.env`:
   ```
   STRIPE_PRICE_SOLO=price_...
   STRIPE_PRICE_EQUIPE=price_...
   STRIPE_PRICE_PRO=price_...
   ```
3. **Stripe → Développeurs → Webhooks**: sur le point de terminaison `stripeWebhook`, ajoute les événements
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (en plus de `checkout.session.completed`).
4. **Stripe → Paramètres → Portail client**: active-le (changement de forfait entre les 3 prix, mise à jour de la carte, annulation).
5. Déploie: `npx -y firebase-tools deploy --only functions,firestore:rules --project <ID-du-projet>`.
6. Firebase → Authentication: active « Courriel/Mot de passe » et ajoute ton domaine dans « Domaines autorisés ».

Essai: 14 jours sans carte à partir de la création du compte. Après l'essai sans forfait, l'app passe en lecture seule
(consultation et exportation permises). Les comptes créés avant `foundersBefore` sont gratuits à vie.

## Relier Gmail (une seule fois)

1. <https://console.cloud.google.com/> → nouveau projet « Murco ».
2. *API et services → Bibliothèque* → activer **Gmail API**.
3. *Écran de consentement OAuth* → Externe → ajoute ton adresse Gmail comme « utilisateur test ».
4. *Identifiants → Créer → ID client OAuth → Application Web*. Dans « Origines JavaScript autorisées », ajoute
   l'adresse de ton app (ex.: `https://<ton-utilisateur>.github.io` et `http://localhost:5173`).
5. Colle l'ID client dans **Paramètres → Gmail**.

Sans Gmail configuré, le bouton « Envoyer » ouvre quand même ta messagerie avec le PDF téléchargé.

## Données

Chaque appareil garde une copie complète (IndexedDB) et la synchronise dans **ton** projet Firebase
(seul ton compte y a accès, voir `firestore.rules`). Les adresses passent par Google Maps (ou OpenStreetMap)
pour le calcul des km, et les courriels par ton propre Gmail.
**Paramètres → Sauvegarde** permet aussi de télécharger une copie ZIP complète.

## Technique

React + TypeScript + Vite, Capacitor (Android/iOS), Tesseract (lecture des reçus sur l'appareil),
Stripe + Firebase Functions (paiement par carte), Dexie (IndexedDB), Firebase (Auth + Firestore) pour la synchronisation,
Google Maps (Routes, Geocoding, Places, Embed) avec repli OpenStreetMap, jsPDF, JSZip, exifr (GPS des photos),
Google Identity Services + Gmail API.

Tests: `npm test` (dictée et lecture des reçus) et `npm --prefix functions test` (paiement).
Tester la synchronisation en local: `npx firebase-tools emulators:start --only auth,firestore --project demo-murco`,
puis dans Paramètres → Synchronisation, coller `{"apiKey":"x","projectId":"demo-murco","authDomain":"x","emulator":true}`.
Pour publier dans l'App Store / Play Store plus tard: envelopper avec Capacitor (`npx cap init`).

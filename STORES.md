# Publier l'app sur Google Play et l'App Store

Ce guide prépare la publication de **Brigaxo** (identifiant `com.groupemurco.gestion`). Les étapes marquées 👤 doivent être faites par le propriétaire (comptes, paiements, secrets).

## 1. Google Play (Android)

1. 👤 Créer un compte développeur: <https://play.google.com/console> (frais uniques d'environ 25 $ US, pièce d'identité demandée; pour une entreprise: numéro D-U-N-S).
2. 👤 **Créer la clé de publication** (une seule fois; ne la perds jamais, ne la mets pas dans GitHub):
   ```powershell
   winget install EclipseAdoptium.Temurin.21.JDK
   keytool -genkeypair -v -keystore brigaxo-release.keystore -alias brigaxo -keyalg RSA -keysize 2048 -validity 10000
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("brigaxo-release.keystore")) | Set-Clipboard
   ```
   Garde le fichier `brigaxo-release.keystore` et les deux mots de passe dans un endroit sûr (gestionnaire de mots de passe + copie hors ligne).
3. 👤 Dans GitHub → *Settings → Secrets and variables → Actions → New repository secret*, ajouter:
   - `ANDROID_KEYSTORE_BASE64` (le texte copié à l'étape précédente)
   - `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` (ex.: `brigaxo`), `ANDROID_KEY_PASSWORD`
4. Lancer *Actions → « App Android (Google Play, signée) » → Run workflow*. Le fichier **.aab** se télécharge dans les artefacts de l'exécution.
5. 👤 Dans la console Play: *Créer une application* → *Production* (ou *Test interne* d'abord) → téléverser le .aab → remplir la fiche (textes plus bas).
6. Chaque nouvelle version: relancer le workflow (le numéro de version monte tout seul) et téléverser le nouveau .aab.

> Le .aab n'est pas le même fichier que l'`Murco.apk` de test publié sur GitHub (celui-ci reste pour l'installation directe).

### Fiche du magasin (à copier)

**Nom**: Brigaxo — Soumissions et factures
**Description courte (80 car.)**: Soumissions et factures en 30 secondes pour entrepreneurs du Québec.
**Description longue**:
> Brigaxo est l'application des entrepreneurs qui veulent soumissionner, facturer et se faire payer sans perdre leurs soirées à la table.
>
> • Soumissions et factures en 30 secondes, taxes TPS/TVQ calculées
> • Facture express avec dictée vocale: « facture pour Nathalie, 60 pieds de gouttières »
> • Estimateur par photo: liste de matériaux, quantités, coût estimé et liens d'achat
> • Agenda des jobs, route du jour, météo, rappels aux clients
> • Reçus lus automatiquement (montant, taxes, commerce) et journal de bord des km
> • Portail client: signature de la soumission et paiement par carte
> • Équipe: pointage GPS, feuilles de temps, jobs sur le cell de chaque employé
> • Dossier complet pour le comptable en un clic (TPS/TVQ, Excel/CSV)
>
> 14 jours d'essai gratuit. Conçu au Québec, en français et en anglais.

**Catégorie**: Entreprise · **Coordonnées**: info@groupemurco.com
**Politique de confidentialité**: `https://groupemurco.github.io/GROUPE-MURCO/#/confidentialite` (idéal: la mettre sur une page web simple de ton propre domaine, sans `#`).

**Visuels à préparer** 👤: icône 512×512, image de présentation 1024×500, 2 à 8 captures d'écran de téléphone (1080×1920 ou proches).

**Sécurité des données (formulaire Play)**: données collectées — nom, courriel, numéro de téléphone, adresse, photos, position approximative (pointage et km), contenu de l'utilisateur (factures); chiffrées en transit; l'utilisateur peut demander la suppression (Paramètres → supprimer mon compte). Aucune donnée vendue.

## 2. App Store (iPhone)

1. 👤 Programme **Apple Developer** (environ 99 $ US par an): <https://developer.apple.com/programs/>.
2. La compilation iOS demande un Mac (ou un service de compilation dans le nuage). Le dossier `ios/` et la vérification GitHub existent déjà; la signature (certificats, profil) reste à créer dans le compte Apple.
3. **Attention (règle 4.2 d'Apple)**: une application qui n'est qu'un site web enveloppé peut être refusée. Mettre de l'avant les fonctions natives (appareil photo, partage, notifications, géolocalisation, mode hors ligne) dans les captures et la description, et ajouter la fonction LiDAR (RoomPlan) plus tard renforcerait beaucoup le dossier.
4. Passer par **TestFlight** d'abord pour tester avec de vrais utilisateurs avant la soumission.

## 3. À savoir

- Google Play peut aussi refuser une app trop proche d'un simple site (« fonctionnalité minimale »): la fiche doit montrer les fonctions natives.
- Les abonnements vendus **dans** l'app via les magasins peuvent exiger leur propre système de paiement (et une commission). Ici le paiement se fait sur le web avec Stripe: vérifier les règles à jour de chaque magasin avant de soumettre, ou vendre l'abonnement sur le site seulement.

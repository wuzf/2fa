# 🔐 2FA

Un système de gestion des clés d’authentification à deux facteurs, conçu sur Cloudflare Workers. Déploiement gratuit, accélération mondiale et prise en charge du mode hors ligne avec une PWA.

![Version](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](README.md) · [繁體中文](README_TC.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) ·
[Deutsch](README_DE.md) · **[Français](README_FR.md)** · [Español](README_ES.md) · [Português (Brasil)](README_PT_BR.md) · [Italiano](README_IT.md) ·
[Русский](README_RU.md) · [Türkçe](README_TR.md) · [Bahasa Indonesia](README_ID.md) · [Tiếng Việt](README_VI.md) · [ไทย](README_TH.md)

<!-- README_LANGUAGE_NAV_END -->

**Fonctionnalités principales :** Génération automatique de codes TOTP/HOTP · Ajout de clés par lecture de QR code, reconnaissance d’image, capture d’écran collée ou glisser-déposer · Stockage chiffré avec AES-GCM 256 bits · Importation en masse depuis Google Authenticator, Aegis, 2FAS, Bitwarden, etc. · Exportation multiformat (TXT/JSON/CSV/HTML/QR codes de migration Google) · Sauvegarde et restauration automatiques · Synchronisation des sauvegardes distantes via WebDAV/S3/OneDrive/Google Drive · Paramètres de sécurité, de synchronisation et de préférences · 15 langues dans l’ensemble du projet (détection automatique / sélection manuelle) · Thème clair, sombre ou système · Interface adaptative inspirée de Fluent 2

L’application web, les extensions de navigateur, la configuration initiale, les pages OTP publiques, les messages de l’API et les documents de sauvegarde prennent en charge le chinois simplifié, le chinois traditionnel, l’anglais, le japonais, le coréen, l’allemand, le français, l’espagnol, le portugais (Brésil), l’italien, le russe, le turc, l’indonésien, le vietnamien et le thaï. L’interface suit la langue du navigateur ou une sélection manuelle ; l’anglais est utilisé si la langue du navigateur n’est pas prise en charge. Les sauvegardes CSV/HTML peuvent être importées quelle que soit la langue de l’interface.

## 🧩 Extension de navigateur

Installer 2FA Verification Assistant : **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Ouvrez le lien d’installation dans le navigateur correspondant. Après l’installation, saisissez l’URL de votre instance 2FA auto-hébergée dans les paramètres de l’extension, puis connectez-vous à cette instance dans le même navigateur pour afficher, copier et saisir les codes TOTP. Le remplissage automatique nécessite une autorisation distincte pour chaque page de vérification. L’extension nécessite une instance déployée de ce projet et son interface prend en charge les 15 langues indiquées ci-dessus. Firefox nécessite la version 153 ou ultérieure pour ordinateur, dans un onglet normal utilisant le conteneur par défaut. Les onglets de conteneur, les fenêtres privées et Android ne sont pas pris en charge.

[Guide d’installation et d’utilisation](docs/BROWSER_EXTENSION.md) · [Politique de confidentialité Chrome / Edge](extension/PRIVACY.md) · [Politique de confidentialité Firefox](extension/PRIVACY_FIREFOX.md) (en chinois)

## 📸 Captures d’écran

|                    Ordinateur                     |                    Tablette                    |                    Mobile                    |
| :-----------------------------------------------: | :--------------------------------------------: | :------------------------------------------: |
| ![Ordinateur](docs/images/screenshot-desktop.png) | ![Tablette](docs/images/screenshot-tablet.png) | ![Mobile](docs/images/screenshot-mobile.png) |

## 🚀 Déploiement rapide

### Démonstration en ligne

Consultez le site de démonstration (mot de passe `2fa-Demo.`) : **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Déploiement en un clic (recommandé)

[![Déployer sur Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Le déploiement en un clic est recommandé. Tous les utilisateurs doivent effectuer les mises à jour sur leur installation existante via le workflow **Sync Upstream**. Ne mettez pas à jour en supprimant le Worker, en supprimant le dépôt ou en réinstallant.

1. Cliquez sur le bouton ci-dessus, connectez-vous avec GitHub et accordez l’autorisation.
2. Connectez-vous à votre compte Cloudflare, cliquez sur **Deploy** et attendez la fin du déploiement. Le stockage KV est créé automatiquement.
3. Ouvrez l’URL Workers fournie par Cloudflare, **définissez votre mot de passe administrateur** et commencez à utiliser l’application.

> La compilation automatique Git utilise directement le fichier `wrangler.toml` du dépôt. La configuration actuelle déclare explicitement `SECRETS_KV`. Wrangler crée automatiquement le KV nécessaire au premier déploiement, puis réutilise la ressource liée au Worker actuel lors des déploiements suivants.
> Si vous configurez manuellement les commandes de compilation Git dans le tableau de bord Cloudflare, **utilisez `npm run deploy` comme commande de déploiement, plutôt que directement `npx wrangler deploy`**, afin de conserver l’injection des informations de version et de rester cohérent avec le point d’entrée de déploiement par défaut du dépôt.

#### Recommandation : activer le chiffrement des données

Après le déploiement, ajoutez un Secret `ENCRYPTION_KEY` dans **Cloudflare Dashboard → Worker → Settings → Variables** :

```bash
# Generate encryption key (choose one)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` est la clé maîtresse permettant de déchiffrer les données existantes. **Il est recommandé de la configurer**, à condition d’enregistrer immédiatement sa valeur d’origine dans un gestionnaire de mots de passe, une sauvegarde hors ligne ou un autre emplacement sûr.
>
> Si vous ne pouvez pas garantir la conservation de la valeur d’origine, **mieux vaut ne pas la configurer que la configurer puis la perdre** :
>
> - Une fois configurée : la liste des clés, les sauvegardes automatiques et les identifiants WebDAV/S3/OneDrive/Google Drive sont tous chiffrés.
> - En cas de perte : Cloudflare ne réaffiche pas la valeur d’origine ; les données chiffrées existantes et les sauvegardes chiffrées ne peuvent plus être lues ni restaurées.
> - Comportement actuel : lorsque des données chiffrées sont détectées mais que `ENCRYPTION_KEY` est absente, le système bloque les lectures et les écritures pour éviter d’écraser accidentellement les anciennes données.

#### Mises à jour de version

Le déploiement en un clic crée un dépôt indépendant, et non un fork. Les mises à jour s’effectuent sur l’installation existante via le workflow **Sync Upstream**.

> ⚠️ **Sauvegardez toujours vos données avant une mise à jour** : avant de mettre à jour la version, exportez vos données actuelles via **Exportation en masse** ou **Restaurer la configuration → Exporter la sauvegarde**, afin d’éviter toute perte de données en cas d’échec.

1. Ouvrez le dépôt 2fa créé sur votre compte GitHub lors du déploiement en un clic.
2. Accédez à **Actions** → **Sync Upstream**.
3. Cliquez sur **Run workflow**, conservez la branche amont par défaut `main`, puis lancez une nouvelle exécution.
4. Attendez la fin de la synchronisation et du déploiement automatique de Cloudflare, puis actualisez l’application.

Le workflow conserve automatiquement le nom du Worker, les liaisons KV et les paramètres courants de déploiement de votre dépôt, puis redéploie **le même Worker**. Les fichiers de workflow existants dans votre dépôt sont également conservés.

> **Si Sync Upstream est absent** : un dépôt créé par le déploiement en un clic peut ne pas contenir de workflows. Dans ce cas uniquement, ajoutez `.github/workflows/sync-upstream.yml` à votre dépôt, copiez son contenu depuis <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml> et effectuez un commit. Suivez ensuite les étapes de mise à jour ci-dessus.

> **Si une mise à jour précédente a échoué avec `without workflows permission`** : une fois le correctif publié sur la branche amont `main`, les workflows **Sync Upstream** existants qui comportent l’étape de fusion automatique de la configuration de déploiement peuvent effectuer la mise à jour en suivant les étapes ci-dessus, sans modifier de YAML ni configurer de PAT. Lancez une nouvelle exécution avec `main` ; les anciennes étiquettes de version ne contiennent pas le correctif. Pour les autres cas, consultez le [dépannage des mises à jour](docs/DEPLOYMENT.md#升级故障排查) (en chinois).

Cette méthode n’affecte pas les Workers, les liaisons KV ni les Secrets existants. **Si vous avez déjà configuré `ENCRYPTION_KEY`, vous n’avez pas besoin de la saisir à nouveau lors des mises à jour ; si vous ne l’avez pas configurée, vous pouvez tout de même utiliser cette méthode.**

> ⚠️ `ENCRYPTION_KEY` est la clé maîtresse permettant de déchiffrer les données existantes. Veillez à l’enregistrer dans un gestionnaire de mots de passe dès sa création. Les Secrets Cloudflare ne peuvent plus être consultés après enregistrement. Les mises à jour normales ne nécessitent pas de les saisir à nouveau, mais si vous supprimez cette clé sans avoir conservé sa valeur d’origine, les données chiffrées existantes ne pourront pas être récupérées.

> ⚠️ **Retour à une version antérieure à 1.8.0** : depuis la version 1.8.0, les incréments des compteurs HOTP sont stockés séparément des données principales. Avant de revenir en arrière, appelez une fois le point de terminaison de compactage pour réintégrer les compteurs ; sinon, ils reviendront à leurs valeurs au moment de la mise à jour. Consultez la [procédure de retour à une version antérieure](docs/DEPLOYMENT.md#回滚到-180-之前的版本) (en chinois). Les déploiements utilisant uniquement TOTP ne sont pas concernés.

#### Vérifier le résultat de la fusion

Le workflow `Sync Upstream` est conçu pour toujours effectuer les mises à jour dans **le même dépôt et sur le même Worker**. Il fusionne désormais automatiquement `wrangler.toml` et affiche les différences avec la version amont dans le récapitulatif. Vous pouvez ainsi vérifier quelles valeurs proviennent de votre configuration locale de déploiement :

1. Vérifiez les différences de `wrangler.toml` dans le récapitulatif de l’exécution GitHub Actions.
2. Ouvrez `wrangler.toml` dans votre dépôt.
3. Confirmez que le nom du Worker, les liaisons KV, les routes et les paramètres de déploiement existants sont toujours corrects.
4. Si vous gérez des configurations très spécifiques dans `wrangler.toml`, effectuez des commits supplémentaires si nécessaire.

> Si Cloudflare ne lance pas automatiquement le redéploiement, accédez à la page **Deployments** et redéployez le dernier commit de votre dépôt actuel. Ne supprimez pas l’installation pour la réinstaller.

## 📖 Guide d’utilisation

### Ajouter des clés

Cliquez sur le bouton flottant **➕** en bas à droite :

- **Scanner un QR code** — Lire un QR code 2FA avec la caméra et remplir automatiquement les champs.
- **Sélectionner une image** — Importer une capture d’écran contenant un QR code pour une reconnaissance automatique.
- **Coller une capture d’écran** — Utiliser Ctrl+V pour coller une capture de QR code depuis le presse-papiers ; pratique sur un ordinateur sans caméra.
- **Glisser-déposer une image** — Glisser directement une image de QR code dans la boîte de dialogue pour une reconnaissance automatique.
- **Ajout manuel** — Saisir le nom du service et la clé secrète Base32 ; développer les paramètres avancés pour modifier le nombre de chiffres, la période ou l’algorithme.

### Utilisation quotidienne

- **Copier un code** : cliquer directement sur les chiffres du code.
- **Gérer les clés** : cliquer sur **⋯** en haut à droite d’une carte → Afficher le QR code / Copier l’URI / Copier le lien de la page / Modifier / Supprimer.
- **Rechercher** : recherche en temps réel par nom de service ou de compte dans la barre de recherche en haut.
- **Regroupement intelligent** : regrouper automatiquement les services associés et les comptes multiples, avec la possibilité de revenir à une liste simple.
- **Trier** : trier par date d’ajout ou par nom.
- **Thème** : bouton d’action flottant → **Paramètres → Préférences → Mode du thème**, puis choisir clair, sombre ou système.

### Importation en masse

Cliquez sur le bouton flottant → **📥 Importation en masse**. Vous pouvez importer un fichier ou coller du texte.

**Formats compatibles :**

| Source                 | Format                                        |
| ---------------------- | --------------------------------------------- |
| Universel              | Texte d’URI `otpauth://` (TXT), CSV, HTML     |
| Google Authenticator   | QR code de migration (`otpauth-migration://`) |
| Aegis                  | Fichier d’exportation JSON                    |
| 2FAS                   | Fichier d’exportation `.2fas`                 |
| Bitwarden              | Exportation JSON ou CSV Authenticator         |
| LastPass Authenticator | Fichier d’exportation JSON                    |
| andOTP                 | Fichier d’exportation JSON                    |
| Ente Auth              | Fichier d’exportation                         |

### Exportation en masse

Cliquez sur le bouton flottant → **📤 Exportation en masse**. Les formats TXT, JSON, CSV et HTML sont pris en charge, ainsi que la génération de **QR codes de migration Google Authenticator**, qui peuvent être scannés pour une importation directe.
Les exportations standard TXT / JSON / CSV / HTML privilégient le format unifié du serveur en ligne et basculent automatiquement vers une exportation locale compatible hors ligne ou lorsque le corps de la requête est trop volumineux.

### Sauvegarde et restauration

Le système effectue des sauvegardes automatiques, déclenchées lors des modifications de données et d’une vérification quotidienne planifiée. Il conserve les 100 dernières sauvegardes ; ce nombre est modifiable dans les paramètres.
Les nouveaux fichiers de sauvegarde suivent **Paramètres → Format d’exportation par défaut**. Les sauvegardes automatiques distantes utilisent la même extension (`txt`, `json`, `csv` ou `html`).

Cliquez sur le bouton flottant → **🔄 Restaurer la configuration** pour consulter la liste des sauvegardes, prévisualiser leur contenu, les restaurer ou les exporter. Vous pouvez également importer un fichier `backup_*.(txt|json|csv|html)` téléchargé depuis WebDAV/S3/OneDrive/Google Drive pour le prévisualiser et le restaurer.

#### Sauvegarde distante

Les sauvegardes peuvent être synchronisées vers un stockage distant. Elles sont envoyées automatiquement lors des modifications de données, et plusieurs destinations de sauvegarde peuvent être configurées :

- **WebDAV** — Prend en charge les services de stockage cloud et les services auto-hébergés utilisant le protocole WebDAV standard. ⚠️ Les services passant par un proxy Cloudflare, tels que Nutstore/jianguoyun, ne sont pas pris en charge, car ils déclenchent des erreurs de boucle 520.
- **Stockage compatible S3** — Prend en charge AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS et les autres services compatibles S3.
- **OneDrive** — Après autorisation OAuth Microsoft, les sauvegardes sont écrites dans un sous-dossier du dossier OneDrive propre à l’application.
- **Google Drive** — Après autorisation OAuth Google, les sauvegardes sont écrites dans le dossier Google Drive configuré.

Ajoutez et gérez les destinations de sauvegarde distante dans **Paramètres → Paramètres de synchronisation**.

Les sauvegardes distantes contiennent les mêmes données de sauvegarde que celles générées par l’application. Si `ENCRYPTION_KEY` était configurée lors de la création de la sauvegarde, le fichier distant est lui aussi chiffré. Sa restauration nécessite de conserver la même `ENCRYPTION_KEY` dans le Worker.

Instructions détaillées : [Configurer le stockage cloud](docs/CLOUD_DRIVE_SETUP.md) (actuellement en chinois).

### Paramètres

Cliquez sur le bouton flottant → **⚙️ Paramètres** :

- **Changer le mot de passe** — Modifier le mot de passe administrateur.
- **Mode du thème** — Choisir clair, sombre ou système.
- **Animation de transition des codes** — Désactiver les animations ou choisir un effet de défilement, de bascule ou de projecteur.
- **Durée de validité de la connexion** — Personnaliser le délai d’expiration du JWT.
- **Format d’exportation par défaut** — Définir le choix d’exportation par défaut et l’extension des nouvelles sauvegardes et des sauvegardes automatiques distantes.
- **Nombre de sauvegardes conservées** — Ajuster le nombre de sauvegardes automatiques à conserver.
- **Sauvegarde distante** — Configurer les destinations WebDAV/S3/OneDrive/Google Drive.
- **Se déconnecter** — Supprimer en un clic le cookie de session actuel et le cache local ; l’opération reste possible localement lorsque le serveur est inaccessible.

### Installer comme application mobile (PWA)

- **iOS** : ouvrir dans Safari → bouton de partage → Sur l’écran d’accueil.
- **Android** : ouvrir dans Chrome → menu (⋮) → Ajouter à l’écran d’accueil.

Après l’installation, utilisez l’application comme une application native, en plein écran et avec un accès hors ligne.

### Remplissage TOTP dans Chrome / Edge / Firefox

Cliquez sur l’extension pour sélectionner un compte, ou appuyez sur `Ctrl+Shift+U` pour saisir le TOTP actuel d’un compte précédemment associé. Avec l’autorisation propre à chaque page de vérification, l’extension peut détecter et remplir automatiquement les champs de vérification. Si plusieurs comptes correspondent, un sélecteur de compte s’affiche. Elle prend en charge un champ unique ou 6/8 champs séparés et ne soumet pas le formulaire.

Après vous être connecté à l’instance 2FA dans le même profil de navigateur et avoir accordé l’accès à l’instance, vous pouvez fermer l’onglet de celle-ci. Par défaut, l’extension lit les clés secrètes via la session valide et calcule les codes en mémoire en arrière-plan pour chaque tâche. Reconnectez-vous lorsque la session expire. L’activation explicite du mode hors ligne enregistre un cache local indépendant de clés secrètes, afin que les codes restent disponibles sans connexion réseau ni onglet d’instance ouvert. Ce cache ne bénéficie pas d’un chiffrement supplémentaire par mot de passe. Le code autorisé de l’extension peut lire l’intégralité de la liste des clés, mais les clés secrètes ne sont jamais envoyées à la fenêtre contextuelle ni au site cible. Les champs situés dans un Shadow DOM ouvert ou dans des iframes de même origine sont pris en charge. HOTP, les iframes d’origine différente, les Shadow DOM fermés et la navigation privée ne sont pas pris en charge.

Consultez le [guide d’installation et d’utilisation](docs/BROWSER_EXTENSION.md), la [notice de confidentialité Chrome / Edge](extension/PRIVACY.md) et la [notice de confidentialité Firefox](extension/PRIVACY_FIREFOX.md) (actuellement en chinois).

## 🔒 Sécurité

- **Mot de passe** : hachage salé PBKDF2-SHA256 (100 000 itérations), JWT stocké dans des cookies HttpOnly + Secure + SameSite=Strict.
- **Chiffrement des données** : lorsque `ENCRYPTION_KEY` est configurée, toutes les clés secrètes, les sauvegardes et les identifiants WebDAV/S3/OneDrive/Google Drive sont chiffrés avec AES-GCM 256 bits. Conservez impérativement la clé d’origine : sans elle, les données chiffrées ne peuvent pas être déchiffrées.
- **Transport** : HTTPS de bout en bout, TLS 1.2+.
- **Confidentialité** : OTP générés côté client, aucune collecte de données d’utilisation, code entièrement ouvert.
- **Durée de validité de la connexion** : 30 jours par défaut, personnalisable dans les paramètres ; renouvellement automatique lors d’une utilisation active lorsqu’il reste moins de 7 jours.

## 🔗 API OTP publique

Générez des codes de vérification directement depuis une URL, sans vous connecter :

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Paramètres : `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (pour HOTP)

Les pages TOTP affichent le code actuel et le suivant, tous deux copiables, et s’actualisent sur place à la fin de la période. Les pages HOTP utilisent le compteur indiqué dans le lien ; la copie ne l’incrémente pas.

## 📚 Documentation complémentaire

| Document                                                     | Description                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Guide de déploiement](docs/DEPLOYMENT.md)                   | Déploiement manuel, configuration KV, Secrets                                        |
| [Configuration du stockage cloud](docs/CLOUD_DRIVE_SETUP.md) | Configuration de OneDrive / Google Drive (en chinois)                                |
| [Référence de l’API](docs/API_REFERENCE.md)                  | Documentation complète des points de terminaison de l’API                            |
| [Architecture](docs/ARCHITECTURE.md)                         | Architecture du système et conception technique                                      |
| [Guide de développement](docs/DEVELOPMENT.md)                | Développement local, tests, style de code                                            |
| [Guide PWA](docs/PWA_GUIDE.md)                               | Installation de la PWA et fonctionnalités hors ligne                                 |
| [Extension de navigateur](docs/BROWSER_EXTENSION.md)         | Installation, utilisation et autorisations pour Chrome / Edge / Firefox (en chinois) |

## 🤝 Contribuer

Vos [Issues](https://github.com/wuzf/2fa/issues) et [Pull Requests](https://github.com/wuzf/2fa/pulls) sont les bienvenues. Pour les détails de développement, consultez le [guide de développement](docs/DEVELOPMENT.md).

## 📄 Licence

[Licence MIT](LICENSE)

## 🌟 Historique des étoiles

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Graphique de l’évolution des étoiles GitHub" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Si ce projet vous est utile, accordez-lui une ⭐**

Créé avec ❤️ par [wuzf](https://github.com/wuzf)

</div>

# Song request

Une page web où tes collègues cherchent un titre et l'ajoutent à **ta** file d'attente Spotify. Eux n'ont besoin d'aucun compte.

<img src="docs/screenshot.png" alt="Aperçu : titre en cours, recherche, résultats avec bouton Ajouter" width="300">

## Ce qu'il te faut

- Un compte Spotify **Premium**. Spotify l'exige pour créer une app et pour ajouter des titres à la file d'attente.
- Un compte GitHub et un compte [Vercel](https://vercel.com) (l'offre gratuite suffit).

## Installation

Compte dix minutes. Aucune ligne de code à écrire.

### 1. Créer ton app Spotify

1. Ouvre le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) et clique sur **Create app**.
2. Nom et description : ce que tu veux, ils apparaîtront sur l'écran d'autorisation.
3. **Redirect URI** : mets `http://127.0.0.1:3000/api/callback`. Le champ est obligatoire, tu ajouteras la vraie adresse à l'étape 3.
4. Si le formulaire demande quelle API tu comptes utiliser, coche **Web API**. Accepte les conditions et enregistre.
5. Dans **Settings**, relève le **Client ID** et le **Client secret**.

### 2. Déployer sur Vercel

[![Déployer sur Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FArthurBlr%2Fspotify-song-request&env=SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET,ACCESS_CODE&envDescription=Identifiants%20de%20ton%20app%20Spotify%20et%20code%20d%27acc%C3%A8s%20%C3%A0%20donner%20%C3%A0%20tes%20coll%C3%A8gues&envLink=https%3A%2F%2Fgithub.com%2FArthurBlr%2Fspotify-song-request%23installation&project-name=song-request&repository-name=song-request)

Le bouton copie ce repo sur ton GitHub, puis te demande trois valeurs :

| Variable | Valeur |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Le Client ID de l'étape 1 |
| `SPOTIFY_CLIENT_SECRET` | Le Client secret de l'étape 1 |
| `ACCESS_CODE` | Un code de ton choix, à donner aux personnes autorisées à demander des titres |

Une fois le déploiement terminé, relève l'adresse de ton site, par exemple `https://song-request-abc.vercel.app`. Prends l'adresse principale du projet (rubrique **Domains**), pas celle d'un déploiement particulier.

> Tu préfères sans le bouton ? Clique sur **Use this template** en haut de ce repo, puis importe ta copie dans Vercel avec **Add New → Project** et renseigne les mêmes variables.

### 3. Déclarer ton adresse chez Spotify

Dans ton app Spotify, **Settings → Redirect URIs**, ajoute :

```
https://TON-SITE.vercel.app/api/callback
```

L'adresse doit être exactement celle-ci, sans `/` à la fin. En cas de doute, ouvre ton site : la page d'accueil affiche l'adresse à copier.

### 4. Relier ton compte Spotify

1. Ouvre `https://TON-SITE.vercel.app/api/login` et accepte l'autorisation.
2. La page affiche un *refresh token*. Copie-le.
3. Dans Vercel, **Settings → Environment Variables**, ajoute `SPOTIFY_REFRESH_TOKEN` avec cette valeur.
4. Dans **Deployments**, ouvre le menu du dernier déploiement et choisis **Redeploy**. Sans ça, la nouvelle variable n'est pas prise en compte.

C'est prêt.

## Utilisation

- Lance de la musique sur Spotify, sur n'importe quel appareil. Spotify n'accepte les ajouts que pendant une lecture.
- Partage `https://TON-SITE.vercel.app/?code=TON_CODE`. Le code est retenu par le navigateur après la première visite. Tu peux aussi donner l'adresse et le code séparément.
- Dans la recherche, on peut taper un titre, un artiste, ou coller un lien Spotify.

Deux règles évitent les abus :

- Un titre en cours de lecture ou déjà dans la file est refusé.
- Chaque navigateur attend 30 secondes entre deux demandes.

## À refaire tous les six mois

Spotify désactive le refresh token six mois après l'autorisation. La page affiche alors « La connexion au compte Spotify a expiré ».

Refais simplement l'étape 4, en remplaçant la valeur de `SPOTIFY_REFRESH_TOKEN`. La page de l'étape 4 t'indique la date d'expiration : mets-toi un rappel.

## Réglages

| Variable | Rôle | Par défaut |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | Identifiant de ton app Spotify | obligatoire |
| `SPOTIFY_CLIENT_SECRET` | Secret de ton app Spotify | obligatoire |
| `SPOTIFY_REFRESH_TOKEN` | Autorisation de ton compte, obtenue à l'étape 4 | obligatoire |
| `ACCESS_CODE` | Code demandé aux visiteurs. Vide : la page est ouverte à tous | vide |
| `COOLDOWN_SECONDS` | Délai entre deux demandes d'un même navigateur. `0` : aucun délai | `30` |

Après chaque changement de variable dans Vercel, il faut redéployer.

## Dépannage

| Symptôme | Cause et solution |
| --- | --- |
| Spotify affiche « INVALID_CLIENT: Invalid redirect URI » | L'adresse de l'étape 3 ne correspond pas exactement à celle du site. Vérifie `https`, le domaine et l'absence de `/` final. |
| « Rien n'est en lecture sur Spotify » | Lance un titre. La file n'existe que pendant une lecture. |
| « Spotify refuse la demande » | Dans ton app Spotify, **Settings → User Management**, ajoute ton propre compte (nom et e-mail Spotify). |
| « Le compte Spotify relié doit être Premium » | L'abonnement Premium est obligatoire. |
| « La connexion au compte Spotify a expiré » | Refais l'étape 4. |
| La page affiche toujours « Installation à terminer » | Une variable manque, ou tu n'as pas redéployé après l'avoir ajoutée. |

Les erreurs détaillées sont visibles dans Vercel, onglet **Logs**.

## Lancer en local

Il faut Node.js 20.12 ou plus récent. Aucune dépendance à installer.

```sh
cp .env.example .env   # renseigne le Client ID et le Client secret
npm start              # http://127.0.0.1:3000
```

Ouvre ensuite `http://127.0.0.1:3000/api/login`, colle le token obtenu dans `.env`, puis relance `npm start`.

- Utilise bien `127.0.0.1` : Spotify refuse `localhost` comme Redirect URI.
- `HOST=0.0.0.0 npm start` rend la page accessible aux appareils du même réseau.
- `npm test` lance les tests. Ils simulent Spotify et ne demandent ni compte ni réseau.

## Comment c'est fait

| Dossier | Contenu |
| --- | --- |
| `public/` | La page : HTML, CSS et JavaScript sans framework |
| `api/` | Une fonction par route : `login`, `callback`, `search`, `queue`, `request` |
| `lib/` | Appels à Spotify, contrôle du code d'accès et des limites |
| `local-server.js` | Serveur pour le lancement en local |

- Le Client secret et le refresh token restent côté serveur. Le navigateur des visiteurs ne les voit jamais.
- L'autorisation demandée à Spotify se limite à lire la lecture en cours et à ajouter des titres à la file.
- Les limites sont volontairement simples : le délai tient dans un cookie signé, et un plafond de 30 demandes par 10 minutes s'applique par adresse IP. Elles découragent les abus entre collègues, pas une attaque déterminée. Garde un `ACCESS_CODE`.

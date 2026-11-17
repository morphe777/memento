# Raccourci iPhone « Mémento » : partager des photos, un lien ou un lieu

Le partage depuis Photos, Safari ou Plans passe par un **Raccourci** iOS (app Raccourcis) : une PWA n'apparaît pas
dans la feuille de partage d'iOS. Le Raccourci envoie à `POST /api/v1/captures`, puis ouvre l'écran de vérification
(souvenir) ou la fiche de l'envie (lien, lieu). Décisions : D-158, D-160, D-164, D-168.

## 0. Avant tout : jeton et réseau

1. **Jeton** : Configuration › Accès › nouveau jeton, nom « iPhone Raccourci », type **Capture (iPhone)**. Il ne
   peut qu'envoyer des captures et des photos (403 `CAPTURE_ONLY` ailleurs). Le copier : il n'est montré qu'une fois.
2. **Réseau** : Mémento reste sur le réseau local. Dehors, la capture passe par le **VPN** du homelab (WireGuard,
   Tailscale), toujours actif sur l'iPhone. Sans VPN, le Raccourci échoue : réessayer au retour à la maison.
3. **Session Safari** : l'écran de vérification s'ouvre dans Safari (ou la PWA) ; se connecter une fois à Mémento.

## 1. Étape 0 : preuve de faisabilité (`POST /captures/test`)

À faire avant d'utiliser le vrai Raccourci : `POST /api/v1/captures/test` reçoit la même chose que
`/captures`, **n'écrit rien**, et répond ce qu'il a reçu :

```json
{
  "received": { "files": 3, "meta": { "photos": [{ "takenAt": "2026-11-15T12:40:00", "lat": 46.5, "lng": 3.0 }] } },
  "files": [
    { "name": "IMG_0001.jpg", "mime": "image/jpeg", "bytes": 812345, "ok": true, "width": 2560, "height": 1920,
      "storedBytes": 402311, "read": { "takenAt": "2026-11-15T12:40:00", "lat": 46.5, "lng": 3.0 } }
  ]
}
```

- `read` : la date et la position que le serveur a lues **dans le fichier** (EXIF). Vide quand iOS les a retirées :
  ce sont alors les métadonnées envoyées dans `meta` qui comptent (elles passent avant l'EXIF).
- `ok: false, error: "UNSUPPORTED_MEDIA"` : un HEIC est arrivé ; ajouter « Convertir l'image » en JPEG.

À vérifier (dossier, 03 §4) :

- [ ] 3 photos depuis Photos → Partager → Raccourci de test : taille reçue, date, position.
- [ ] Le **+ Souvenir** de la PWA (Safari) : la page lit elle-même date et position avant de compresser. Si iOS les
      retire, le souvenir est créé sans lieu automatique (recherche par nom) et le Raccourci reste la voie principale.
- [ ] Une URL depuis Safari et un lieu depuis Plans : qu'arrive-t-il (URL, nom, coordonnées) ?
- [ ] Une capture en 4G par le VPN.

Pour le test, faire une copie du Raccourci ci-dessous en remplaçant `/captures` par `/captures/test` et en
remplaçant « Ouvrir les URL » par « Afficher le résultat ».

## 2. Le Raccourci, action par action

Réglages du Raccourci : **Afficher dans la feuille de partage**, types acceptés : **Images, URL, Lieux**.

### Si l'entrée est une image

1. **Répéter avec chaque élément** de l'entrée du raccourci :
   1. **Obtenir les détails des images** : « Date de prise de vue », puis « Lieu » (latitude, longitude) **avant**
      toute conversion.
   2. **Dictionnaire** `{ takenAt: <date au format AAAA-MM-JJTHH:mm:ss>, lat: <latitude>, lng: <longitude> }`
      (date : action « Formater la date », format personnalisé `yyyy-MM-dd'T'HH:mm:ss`).
   3. **Redimensionner l'image** : 2 560 px sur le côté le plus long.
   4. **Convertir l'image** en JPEG, qualité 0,85, **« Conserver les métadonnées »** activé (le serveur les relit
      si possible, puis les retire de ses propres fichiers).
2. **Obtenir le contenu de l'URL** :
   - URL : `https://memento.example.lan/api/v1/captures` (l'adresse de ton Mémento)
   - Méthode : `POST` ; en-tête `Authorization` : `Bearer <le jeton capture>`
   - Corps : **Formulaire**, un champ fichier par image (nom libre, par ex. `file`), et un champ texte `meta` :
     `{"clientCaptureId":"<un identifiant unique>","photos":[<les dictionnaires, dans l'ordre des images>]}`.
     Identifiant unique : action « Date actuelle » formatée en `yyyyMMddHHmmssSSS` ; renvoyer la même capture (réseau
     coupé puis relance) renvoie le même souvenir au lieu d'en créer un deuxième.
3. **Obtenir la valeur du dictionnaire** `editUrl` de la réponse, puis **Ouvrir les URL**.

### Si l'entrée est une URL ou un lieu

- URL : **Obtenir le contenu de l'URL**, `POST`, corps **JSON** `{ "url": "<l'URL partagée>" }`.
- Lieu : corps **JSON** `{ "lat": <latitude>, "lng": <longitude>, "name": "<nom du lieu>" }`.
- Puis `editUrl` → **Ouvrir les URL** : la fiche de l'envie s'ouvre (titre, image, dates, lieu lus sur la page).

### En cas d'échec

Ajouter « Si le résultat ne contient pas `editUrl` » → **Afficher l'alerte** « Mémento injoignable : réessaie au
retour ». Codes possibles : 401 (jeton), 413 `PHOTO_TOO_LARGE` (plus de 40 Mo), 415 `UNSUPPORTED_MEDIA` (HEIC).

## 3. Ce que fait Mémento à la réception

- Une **expérience vécue** est créée tout de suite (brouillon), titrée d'après le lieu trouvé près de la photo à la
  une (« Chez Lucette »), sinon « Sortie du 15 novembre ». « Annuler » sur l'écran de vérification la supprime.
- Les photos sont gardées en WebP (2 560, 1 280 et 480 px) **sans métadonnées** ; date et position restent en base.
- Si une expérience était prévue ce jour-là (ou planifiée depuis une envie au même lieu), l'écran propose
  « Rattacher ». Si un souvenir existe déjà le même jour au même lieu : « Ajouter ces photos au souvenir existant ».

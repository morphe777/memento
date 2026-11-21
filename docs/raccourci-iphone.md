# Partager vers Mémento depuis l'iPhone (Raccourcis)

Une app web (PWA) n'apparaît jamais dans la feuille de partage d'iOS. On passe par l'app **Raccourcis** (gratuite,
déjà installée) : un raccourci réglé « Afficher dans la feuille de partage » apparaît quand on touche **Partager**.

| Raccourci | Depuis | Résultat |
|---|---|---|
| **Souvenir Mémento** | Photos (une ou plusieurs photos) | un souvenir, puis l'écran de vérification s'ouvre |
| **Envie Mémento** | Safari, Instagram, Plans, Google Maps (un lien) | une envie (Expériences › Envies) |

Décisions : D-158, D-168, D-171, D-177, D-179.

## 1. Le jeton (une fois, dans Mémento sur l'iPhone)

1. Mémento › ☰ › **Configuration** › onglet **Accès**.
2. En bas : nom `iphone-raccourci` (sans espace), choix **Capture (iPhone)**, **Créer un jeton**.
3. Touche le jeton affiché (`mem_…`) › **Copier**. Il n'est montré qu'une fois.

Hors de la maison, le VPN du homelab doit être actif, sinon le raccourci échoue.

## 2. Raccourci « Souvenir Mémento »

### À quoi il doit ressembler à la fin

```
Recevoir  Images  de  Feuille de partage
Nombre aléatoire entre 10000000 et 99999999
Répéter avec chaque élément dans  Entrée du raccourci
    Convertir  Élément répété  en  JPEG                     (› Conserver les métadonnées : activé)
    Obtenir le contenu de  https://<ton adresse>/api/v1/captures
        (› Méthode POST · En-tête Authorization = Bearer mem_…
           · Corps Formulaire : photo (Fichier) = Image convertie, captureId (Texte) = Nombre aléatoire)
    Obtenir  Valeur  pour  editUrl  dans  Contenu de l'URL
Fin de la répétition
Obtenir  Premier élément  de  Résultats répétés
Ouvrir  Élément de la liste
```

Pourquoi une boucle : iOS n'envoie que la première photo d'un champ de formulaire. Le raccourci envoie donc les
photos **une par une**, avec le même numéro (`captureId`) : Mémento les range toutes dans le même souvenir.

### Gestes de base dans l'app Raccourcis

- **Ajouter une action** : champ **Rechercher dans les actions** en bas, taper son nom, la toucher. Elle s'ajoute
  **tout en bas**.
- **Déplacer une action** : garder le doigt appuyé sur le bloc, le faire glisser, lâcher.
- **Remplir un mot bleu** : le toucher ; pour une variable (« Entrée du raccourci », « Image convertie »…), la
  toucher dans la barre qui apparaît au-dessus du clavier, ou **Sélectionner une variable**.
- **Options cachées d'une action** : la petite flèche **›** à droite du bloc.
- **Supprimer une action** : son **✕**, ou glisser le bloc vers la gauche.

### Pas à pas (nouveau raccourci)

1. App Raccourcis › onglet **Raccourcis** › **+** en haut à droite.
2. Touche le nom en haut › **Renommer** › `Souvenir Mémento`.
3. **ⓘ** en bas › active **Afficher dans la feuille de partage** › **OK**. En haut apparaît « Recevoir **Tout**… » :
   touche **Tout**, ne garde que **Images**.
4. Ajoute **Nombre aléatoire** : Minimum `10000000`, Maximum `99999999`.
5. Ajoute **Répéter avec chaque élément**. Le bloc doit dire « dans **Entrée du raccourci** » (sinon touche le mot
   bleu et choisis-la). Il a sa ligne **Fin de la répétition**.
6. Ajoute **Convertir l'image** (elle arrive sous « Fin de la répétition ») et **glisse-la entre « Répéter… » et
   « Fin de la répétition »**. Son premier mot bleu : **Élément répété**. Format : **JPEG**. **›** : active
   **Conserver les métadonnées** (date et lieu de la photo).
7. Ajoute **Obtenir le contenu de l'URL**, glisse-la **dans la boucle, sous « Convertir l'image »** :
   - Touche le mot bleu (URL) : tape `https://<ton adresse Mémento>/api/v1/captures`.
   - **›** : **Méthode** › **POST**.
   - **En-têtes** › **Ajouter un nouvel en-tête** : clé `Authorization`, texte `Bearer ` (avec une espace) puis
     colle le jeton.
   - **Corps de la requête** › **Formulaire** :
     - **Ajouter un nouveau champ** › **Fichier** : clé `photo`, valeur **Image convertie**.
     - **Ajouter un nouveau champ** › **Texte** : clé `captureId`, valeur **Nombre aléatoire**.
8. Ajoute **Obtenir la valeur du dictionnaire**, glisse-la **dans la boucle, sous l'action 7**. Touche **Clé** ›
   tape `editUrl`. Elle doit finir par « dans **Contenu de l'URL** ».
9. Ajoute **Obtenir l'élément de la liste** (elle reste **sous** « Fin de la répétition ») : « **Premier élément**
   de **Résultats répétés** ».
10. Ajoute **Ouvrir les URL** : « Ouvrir **Élément de la liste** ». **OK**.

### Modifier le raccourci déjà fait (version sans boucle)

Ouvre-le, puis :
1. Supprime **Ouvrir les URL**.
2. Étapes 4 et 5 ci-dessus (Nombre aléatoire, puis glisse-le juste sous « Recevoir… » ; Répéter avec chaque
   élément).
3. Glisse **Convertir l'image**, **Obtenir le contenu de l'URL** et **Obtenir la valeur du dictionnaire** entre
   « Répéter… » et « Fin de la répétition », dans cet ordre.
4. Dans **Convertir l'image** : remplace « Entrée du raccourci » par **Élément répété**.
5. Dans **Obtenir le contenu de l'URL** › **›** › Corps : ajoute le champ **Texte** `captureId` = **Nombre
   aléatoire**.
6. Étapes 9 et 10 ci-dessus.

### Utilisation

Photos › **Sélectionner** › les photos › **Partager** › en bas de la liste **Souvenir Mémento**. La première fois,
iOS demande d'autoriser la connexion : **Toujours autoriser**. Les photos partent une par une, puis l'écran de
vérification s'ouvre (dates de la plus ancienne à la plus récente, lieux proches, titre). « Annuler » y supprime
le souvenir.

## 3. Raccourci « Envie Mémento »

1. Nouveau raccourci `Envie Mémento`. **ⓘ** › **Afficher dans la feuille de partage** ; dans « Recevoir… », ne
   garde que **URL** et **Pages web Safari**.
2. **Obtenir le contenu de l'URL** : `https://<ton adresse>/api/v1/captures`, **›** › **POST**, même en-tête
   `Authorization`, **Corps de la requête** › **JSON** › **Ajouter un nouveau champ** › **Texte** : clé `url`,
   valeur **Entrée du raccourci**.
3. **Obtenir la valeur du dictionnaire** : clé `editUrl`.
4. **Ouvrir les URL**.

## 4. Si ça ne marche pas

- **Voir ce qui arrive sans rien créer** : dans l'URL, remplace `/captures` par `/captures/test` et remplace
  « Ouvrir les URL » par **Afficher le résultat**. `"read"` montre la date et la position lues ; sans `lat`, touche
  **Options** en haut de la feuille de partage de Photos et active **Localisation**.
- Réponses d'erreur : `UNAUTHENTICATED` = en-tête ou jeton faux ; `UNSUPPORTED_MEDIA` = l'action « Convertir
  l'image » en JPEG manque ; `PHOTO_TOO_LARGE` = photo de plus de 40 Mo ; aucune réponse = Mémento injoignable
  (VPN).

## Ce qui est vérifié

- Le 21/11/2026, sur l'iPhone de Mehdi : un raccourci sans boucle envoie bien la photo, mais une seule quand on en
  partage plusieurs. D'où la boucle (D-179).
- Sur une instance de test, en envoyant exactement les requêtes de la boucle (une photo par requête, même
  `captureId`) : 1 souvenir avec toutes les photos, du jour de la plus ancienne à celui de la plus récente ;
  `{ "url": … }` → une envie ; le jeton capture refusé ailleurs (403).
- Non vérifié ici : les libellés exacts d'iOS, qui peuvent varier un peu selon sa version.

# Partager vers Mémento depuis l'iPhone (Raccourcis)

Une app web (PWA) n'apparaît jamais dans la feuille de partage d'iOS. On passe donc par l'app **Raccourcis** (gratuite,
déjà installée) : un Raccourci réglé « Afficher dans la feuille de partage » apparaît dans la liste quand on touche
**Partager**. Deux Raccourcis, un par usage :

| Raccourci | Depuis | Résultat |
|---|---|---|
| **Souvenir Mémento** | Photos (une ou plusieurs photos) | un souvenir, puis l'écran de vérification s'ouvre |
| **Envie Mémento** | Safari, Instagram, Plans, Google Maps (un lien) | une envie (Expériences › À vivre) |

Décisions : D-158, D-160, D-168, D-171, D-177.

## 1. Une fois : le jeton

1. Dans Mémento : **Configuration › Accès**, en bas : nom `iphone-raccourci` (lettres, chiffres, `-` ou `_`, sans
   espace), portée **Capture (iPhone)**, **Créer un jeton**.
2. Copier le jeton (`mem_…`) : il n'est montré qu'une fois. Il ne sert qu'à envoyer des photos et des liens.
3. Noter l'adresse de Mémento telle que l'iPhone la joint (ex. `https://memento.example.lan`). Hors de la maison,
   le VPN du homelab doit être actif, sinon le Raccourci échoue.

## 2. Raccourci « Souvenir Mémento »

App Raccourcis › **+** (nouveau raccourci), nommé `Souvenir Mémento`. Ajouter ces 4 actions dans l'ordre (barre de
recherche des actions en bas) :

1. **Convertir l'image**
   - Image : **Entrée du raccourci** (variable proposée en touchant le champ).
   - Format : **JPEG**. Activer l'option des **métadonnées** (« Conserver les métadonnées ») : c'est elle qui garde
     la date et la position de la photo.
   - Pourquoi : Photos donne des HEIC, que Mémento refuse.
2. **Obtenir le contenu de l'URL**
   - URL : `https://memento.example.lan/api/v1/captures` (ton adresse + `/api/v1/captures`).
   - Toucher **›** (Afficher plus) :
     - Méthode : **POST**.
     - En-têtes : **+ Ajouter un en-tête**, clé `Authorization`, valeur `Bearer mem_…` (le mot `Bearer`, une
       espace, le jeton).
     - Corps de la requête : **Formulaire**, **+ Ajouter un champ** › **Fichier**, clé `photo`, valeur **Image
       convertie** (la sortie de l'action 1).
3. **Obtenir la valeur du dictionnaire** : Valeur pour la clé `editUrl` dans **Contenu de l'URL**.
4. **Ouvrir les URL** : **Valeur du dictionnaire**.

Puis, en bas de l'éditeur, **ⓘ** (Détails du raccourci) : activer **Afficher dans la feuille de partage**. Le haut
du raccourci affiche alors « Recevoir … de la feuille de partage » : toucher le type et ne garder que **Images**.

Utilisation : Photos › sélectionner une ou plusieurs photos › **Partager** › **Souvenir Mémento**. L'écran de
vérification s'ouvre (date, lieux proches, titre, personnes) : le souvenir est déjà créé, « Annuler » le supprime.

## 3. Raccourci « Envie Mémento »

Nouveau raccourci nommé `Envie Mémento`, 3 actions :

1. **Obtenir le contenu de l'URL**
   - URL : `https://memento.example.lan/api/v1/captures`.
   - Méthode **POST**, même en-tête `Authorization: Bearer mem_…`.
   - Corps de la requête : **JSON**, **+ Ajouter un champ** › **Texte**, clé `url`, valeur **Entrée du raccourci**.
2. **Obtenir la valeur du dictionnaire** : `editUrl` dans **Contenu de l'URL**.
3. **Ouvrir les URL** : **Valeur du dictionnaire**.

**ⓘ** › **Afficher dans la feuille de partage**, types reçus : **URL** et **Pages web Safari**.

Utilisation : Safari, Instagram, Plans ou Google Maps › **Partager** › **Envie Mémento**. Mémento lit la page (titre,
texte, dates, prix, lieu) et crée l'envie ; un lien de carte donne le nom du lieu et ses coordonnées.

## 4. Si ça ne marche pas

Pour voir ce que Mémento reçoit sans rien créer : dupliquer « Souvenir Mémento », remplacer `/captures` par
`/captures/test` et l'action 4 par **Afficher le résultat**. Partager 3 photos :

- `"files": 3` : les 3 photos sont arrivées. Si `"files": 1` pour 3 photos, iOS n'envoie que la première : me le
  dire, le Raccourci passera par une boucle.
- `"read": { "takenAt": …, "lat": …, "lng": … }` : date et position lues. Sans `lat` : dans la feuille de partage
  de Photos, toucher **Options** (en haut) et activer **Localisation** ; vérifier aussi l'option des métadonnées
  de l'action 1.
- `"ok": false, "error": "UNSUPPORTED_MEDIA"` : l'action 1 (JPEG) manque.

Réponses d'erreur de l'action 2 : `UNAUTHENTICATED` (401) = en-tête ou jeton faux ; `CAPTURE_ONLY` (403) = mauvaise
adresse ; `PHOTO_TOO_LARGE` (413) = photo de plus de 40 Mo ; aucune réponse = Mémento injoignable (VPN).

## Ce qui est vérifié, et ce qui ne l'est pas

- Vérifié sur une instance de test (le 21/11/2026) en envoyant exactement ces requêtes : 3 JPEG dans le seul champ
  `photo`, sans autre champ → 1 souvenir de 3 photos, dates et positions lues dans les fichiers, `editUrl` complète ;
  `{ "url": … }` → une envie ; le jeton capture refusé ailleurs (403).
- **Pas vérifiable hors d'un iPhone** : qu'iOS envoie bien toutes les photos d'un même champ dans une seule requête,
  et qu'il garde la position avec « Conserver les métadonnées ». C'est ce que le test de la section 4 montre en une
  minute.

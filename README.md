# Mountains Road

Un site de **randonnée en montagne** : simple à utiliser, mais riche en données pour qui veut creuser.
Itinéraires, sommets, via ferrata, refuges et alpinisme, avec pour chacun ce qui compte vraiment :
**distance, dénivelé (D+ / D−), durée, difficulté et altitude**, plus le profil d'altitude, la météo au sommet
et l'accès aux sommets expliqué sans jargon.

Tout est en HTML, CSS et JavaScript, sans framework ni étape de compilation. Les données proviennent
uniquement de sources ouvertes.

## Ce que fait le site

- **Accueil épuré** : carte plein écran, recherche et cinq catégories (Rando, Rando montagne, Rando alpine,
  Alpinisme, Via ferrata). Les filtres avancés (D+, durée, distance, difficulté, altitude, boucles, type de
  sentier…) sont dans un panneau qu'on n'ouvre que si besoin.
- **Fiches en 3 niveaux** :
  1. l'essentiel : photo, nom, catégorie, difficulté en mots simples, distance, D+, durée, altitude max ;
  2. profil d'altitude interactif (relié à la carte), accès au sommet, météo à 7 jours à l'altitude du sommet,
     description Wikipedia, photos du secteur, lieux à proximité ;
  3. replié : cotations détaillées, sources et méthode de calcul, liens externes, tags OpenStreetMap bruts.
- **Le D+ partout** : il est calculé pendant la collecte pour chaque itinéraire. On peut filtrer
  (« moins de 800 m ») et trier dessus, et il s'affiche sur chaque carte de la liste.
- **Mobile d'abord** : la fiche monte depuis le bas de l'écran (à moitié ou en plein écran), avec de grandes
  zones tactiles. Sur ordinateur, elle s'affiche en panneau latéral.
- **Export GPX**, partage de lien, itinéraire routier jusqu'au départ.
- **Mode direct** : hors des massifs collectés, le site interroge OpenStreetMap en direct (bouton
  « Charger cette zone »). Le dénivelé y est aussi calculé, dans le navigateur.

## Lancer en local

Il faut [Node.js](https://nodejs.org) 18 ou plus récent. Aucune dépendance à installer.

```bash
npm start            # → http://localhost:8080
```

Sans données collectées, le site fonctionne en mode direct. Pour avoir toute la base :

```bash
npm run harvest      # Wikidata (monde) + OpenStreetMap (massifs) + dénivelés + assemblage
```

Ou, plus rapide, récupérez les données déjà publiées par la version en ligne :

```bash
npm run download-data -- --from=https://<compte>.github.io/<dépôt>/
```

Commandes détaillées :

| Commande | Rôle |
|---|---|
| `npm run harvest:wikidata` | Sommets, volcans et cols du monde entier (altitude, proéminence, photo, massif, Wikipedia) |
| `npm run harvest:osm -- --regions=alpes-nord,pyrenees` | Itinéraires, sommets, refuges, via ferrata, escalade des massifs choisis + calcul du D+ |
| `npm run build:data` | Assemble le tout dans `data/` (tuiles, tracés, index de recherche, statistiques) |
| `npm test` | Tests du pipeline (analyse OSM, dénivelé, décodage du terrain…) |

La collecte reprend là où elle s'est arrêtée (cache dans `.cache/`, valable 30 jours, réglable avec
`--max-age=N`). Les massifs se règlent dans [`scripts/regions.json`](scripts/regions.json).

## Mise en ligne (GitHub Pages)

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) :

- publie le site à chaque push sur la branche par défaut ;
- met les données à jour chaque lundi ;
- peut être lancé à la main (**Actions → Collecte et publication → Run workflow**), en choisissant les
  massifs et les pays à collecter.

À faire une seule fois : **Settings → Pages → Source : GitHub Actions**.

## Comment sont calculées les données clés

| Donnée | Méthode |
|---|---|
| **D+ / D−** | Tag OSM `ascent` / `descent` s'il existe ; sinon calculé sur le tracé (points tous les 25 m) avec le modèle de terrain [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (~30 m), lissé et filtré (seuil de 3 m) pour ignorer le bruit. Les variantes courtes (< 15 % du tracé principal) sont exclues. |
| **Durée** | Norme DIN 33466 (clubs alpins) : 4 km/h à plat, 300 m/h en montée, 500 m/h en descente, en combinant distance et dénivelé. |
| **Difficulté** | Échelle SAC (T1 à T6) des chemins OSM ; un itinéraire prend la difficulté de son passage le plus dur. Les via ferrata utilisent `via_ferrata_scale`. |
| **Catégorie** | T1–T2 → Randonnée · T3 → Rando montagne · T4–T5 → Rando alpine · T6 → Alpinisme · via ferrata. |
| **Accès aux sommets** | Chemins cartographiés à moins de 150 m du sommet ; le plus facile détermine la catégorie. Aucun chemin → « Pas de sentier : terrain d'alpinisme ». |
| **Météo** | Open-Meteo, températures recalculées à l'altitude du sommet ; isotherme 0 °C traduit en « Gel au-dessus de … m ». |

## Organisation du code

```
index.html, css/style.css      interface
js/app.js                      assemblage : carte, recherche, catégories, liste, fiche
js/detail.js                   fiche en 3 niveaux
js/store.js                    chargement des données, filtres, recherche, mode direct
js/map.js, js/sheet.js         carte Leaflet, feuille glissante mobile
js/lib/                        code partagé navigateur + Node : requêtes Overpass, normalisation,
                               catégories et textes simples, dénivelé (MNT), géométrie
scripts/                       collecte (Overpass, Wikidata, MNT), assemblage, serveur local
vendor/                        Leaflet et Leaflet.markercluster (embarqués, pas de CDN)
```

## Sources et licences

- © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)
- [Wikidata](https://www.wikidata.org) (CC0), Wikipedia et Wikimedia Commons (CC BY-SA, crédits affichés)
- [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / AWS Open Data)
- [Open-Meteo](https://open-meteo.com) (CC BY 4.0)
- Fonds de carte : OpenTopoMap, OpenStreetMap, Esri, IGN, swisstopo, Waymarked Trails
- Leaflet (BSD-2), Leaflet.markercluster (MIT)

Les informations proviennent de données ouvertes et peuvent être incomplètes : vérifiez toujours les
conditions avant de partir en montagne.

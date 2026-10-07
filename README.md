# Mountains Road

Un site de **randonnée en montagne** : simple à utiliser, mais riche en données pour qui veut creuser.
Itinéraires, sommets, via ferrata, refuges et alpinisme, avec pour chacun ce qui compte vraiment :
**distance, dénivelé (D+ / D−), durée, difficulté et altitude**, plus le profil d'altitude, la météo au sommet
et l'accès aux sommets expliqué sans jargon.

Tout est en HTML, CSS et JavaScript, sans framework ni étape de compilation. Les données proviennent
uniquement de sources ouvertes.

## Ce que fait le site

Un site classique, organisé en pages, dont la carte n'est qu'un outil parmi d'autres :

- **Accueil** : recherche, les cinq activités (Rando, Rando montagne, Rando alpine, Alpinisme, Via ferrata),
  les massifs, les sommets emblématiques, les sorties de moins de 800 m de D+, les grandes traversées.
- **Explorer** : le catalogue d'un massif, un onglet par type (itinéraires, sommets, refuges, via ferrata,
  escalade, cols) et des filtres adaptés à chacun : D+, distance, durée, difficulté T1–T6, accès au sommet,
  altitude, proéminence, réseau (GR, PR…), boucles. Les filtres sont dans l'URL (liens partageables).
- **Page sommet** : toutes les manières d'y monter, comparées sur un même graphique et sur la carte :
  - les **voies par les sentiers**, calculées sur le réseau OpenStreetMap depuis chaque parking, refuge ou
    accès routier proche (voies réellement distinctes, avec distance, D+, durée de montée et aller-retour,
    difficulté, profil détaillé, GPX) ;
  - les **itinéraires balisés** qui passent par le sommet (portion jusqu'au sommet) ;
  - les **voies Camptocamp** (alpinisme, escalade, randonnée, ski…) avec cotation, D+ et versant.
  Plus : accès au sommet en mots simples, météo à l'altitude du sommet, photos, lieux à proximité.
- **Page itinéraire** : profil d'altitude détaillé (aire colorée selon la pente, sommets, cols et refuges
  placés sur la courbe, survol relié à la carte avec altitude, pente et D+ cumulé), statistiques
  (pente max, part du parcours à plus de 25 %), **étapes** de refuge en refuge, **tronçons et variantes**
  avec leurs profils comparés, sommets traversés, météo au point culminant, GPX.
- **Pages refuge / col / escalade**, **pages massif**, **carte** (exploration libre, aperçu puis fiche),
  **guide des cotations**, **statistiques**, **sources et méthode**.
- Hors des massifs collectés, la carte et les fiches interrogent OpenStreetMap en direct (dénivelé compris).

## Lancer en local

Il faut [Node.js](https://nodejs.org) 18 ou plus récent. Aucune dépendance à installer.

```bash
npm start            # → http://localhost:8080
```

Sans données collectées, le site fonctionne en mode direct. Pour avoir toute la base :

```bash
npm run harvest      # Wikidata (monde) + OpenStreetMap (massifs) + dénivelés + assemblage
```

Ou, plus rapide, récupérez les données déjà collectées par GitHub Actions (branche `data`) :

```bash
git fetch origin data && mkdir -p data && git --work-tree=data checkout origin/data -- . && git reset -q
```

(ou depuis le site publié : `npm run download-data -- --from=https://<compte>.github.io/<dépôt>/`)

Commandes détaillées :

| Commande | Rôle |
|---|---|
| `npm run harvest:wikidata` | Sommets, volcans et cols du monde entier (altitude, proéminence, photo, massif, Wikipedia) |
| `npm run harvest:c2c` | Voies Camptocamp des massifs (alpinisme, escalade, randonnée…), rattachées aux sommets |
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
js/app.js, js/router.js        en-tête (menu, recherche, thème) et routeur des pages (#/…)
js/pages/                      accueil, explorer, sommet, itinéraire, lieu, massif(s), carte, guide…
js/components/                 profils d'altitude, fiches de liste, météo, photos, éléments de détail
js/data.js                     chargement des données (collecte statique + direct), recherche
js/map.js                      cartes Leaflet réutilisables
js/lib/                        code partagé navigateur + Node : requêtes Overpass, normalisation,
                               catégories, dénivelé (MNT), voies d'ascension (ascent.js), géométrie
scripts/                       collecte (Overpass, Wikidata, MNT), assemblage, serveur local
vendor/                        Leaflet et Leaflet.markercluster (embarqués, pas de CDN)
```

## Sources et licences

- © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)
- [Wikidata](https://www.wikidata.org) (CC0), Wikipedia et Wikimedia Commons (CC BY-SA, crédits affichés)
- [Camptocamp](https://www.camptocamp.org) (CC BY-SA) : voies d'alpinisme, d'escalade et de randonnée
- [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / AWS Open Data)
- [Open-Meteo](https://open-meteo.com) (CC BY 4.0)
- Fonds de carte : OpenTopoMap, OpenStreetMap, Esri, IGN, swisstopo, Waymarked Trails
- Leaflet (BSD-2), Leaflet.markercluster (MIT)

Les informations proviennent de données ouvertes et peuvent être incomplètes : vérifiez toujours les
conditions avant de partir en montagne.

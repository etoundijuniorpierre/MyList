# Ma Liste

Application React pour présenter quatre catalogues (séries, jeux PC, animés, novelas), gérer les fiches depuis un espace admin, et envoyer une sélection chiffrée sur WhatsApp. Les visiteurs n’ont pas de compte à créer : la connexion est réservée à l’administrateur.

Site publié : [mylist-rho.vercel.app](https://mylist-rho.vercel.app). L’administrateur règle les prix et le numéro de réception dans son tableau de bord.

## Démarrer

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Sans configuration Supabase, le site affiche un **mode démonstration** avec sept fiches exemples. L’administration est alors désactivée. Les données de démonstration ne sont pas publiées dans la base.

## Brancher Supabase

1. Créer un projet Supabase et activer l’authentification par e-mail et mot de passe pour l’admin. **Désactiver les nouvelles inscriptions publiques** dans les réglages Auth : seul le compte admin créé par le propriétaire doit pouvoir se connecter.
2. Depuis ce dossier, connecter la CLI au projet puis appliquer la migration initiale :

   ```powershell
   npx supabase login
   npx supabase link --project-ref glmseokfaljqcjibrhci
   npx supabase db push
   ```

   Le dossier `supabase/` est déjà initialisé. Les migrations créent le catalogue, les prix, le numéro WhatsApp, les droits admin et les règles RLS. Si la CLI est indisponible, exécuter à sa place [`supabase/schema.sql`](supabase/schema.sql) **une seule fois** dans le SQL Editor ; ne pas utiliser les deux méthodes sur la même base.
3. Créer le premier compte admin dans **Authentication → Users**, avec son adresse e-mail et un mot de passe fort. Récupérer son UUID, puis exécuter dans le SQL Editor :

   ```sql
   insert into public.app_admins (user_id, username, email)
   values ('UUID_DU_COMPTE', 'votre_username', 'votre@email.com');
   ```

   Le nom d’utilisateur accepte 3 à 32 caractères : lettres minuscules, chiffres et `_`. L’e-mail reste privé dans la base ; l’admin se connecte avec **username + mot de passe** via la fonction serveur.
4. Déployer les Edge Functions :

   ```powershell
   npx supabase functions deploy admin-login
   npx supabase functions deploy game-search
   npx supabase functions deploy tvdb-search
   npx supabase functions deploy cache-poster
   ```

   Conserver la configuration de [`supabase/config.toml`](supabase/config.toml) et définir `ALLOWED_ORIGINS` (URL du site, sans `/` final ; plusieurs origines séparées par des virgules). Les clés de catalogue sont toutes facultatives et restent côté serveur :

   | Secret | Sert à | Sans lui |
   | --- | --- | --- |
   | `TVDB_API_KEY` (et `TVDB_PIN` si demandé) | Séries et novelas, surtout les titres de doublage | Repli sur TVMaze seul, qui rate les novelas renommées en français |
   | `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | Jeux PC, fiche la plus riche | Repli sur RAWG puis Steam |
   | `RAWG_API_KEY` | Jeux PC | Repli sur Steam |

   Ces accès sont facultatifs et leurs conditions varient : [TheTVDB](https://thetvdb.com/api-information) propose un palier gratuit sous conditions de revenu et d’attribution ; [IGDB](https://api-docs.igdb.com/) demande un partenariat pour un usage commercial ; [RAWG](https://rawg.io/apidocs) distingue ses offres selon l’usage. Les droits d’utilisation des affiches restent à vérifier séparément. Sans clé, les séries et novelas passent par TVMaze et les jeux par Steam.
5. Renseigner `.env.local` avec l’URL Supabase et la **clé publique/publishable**. Ne jamais mettre une clé secrète ou `service_role` dans une variable `VITE_`.

```dotenv
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SITE_URL=https://votre-domaine.example
CRON_SECRET=SECRET_ALEATOIRE_LONG
```

Le numéro WhatsApp se règle dans **Administration → WhatsApp**, au format international avec ou sans `+`. Tant qu’il manque ou qu’un titre de la sélection n’a pas de prix calculable, le bouton d’envoi reste désactivé.

## Tarifs dans l’administration

- **Séries et animés** : définir un prix standard par saison et, si souhaité, un seuil de saisons avec un prix réduit par saison. Le seuil porte sur le **total des saisons de séries et d’animés présents dans la sélection finale** ; une fois atteint, le prix réduit s’applique à chaque saison des titres de la catégorie concernée.
- **Novelas** : même configuration par saison, mais avec un prix et un seuil distincts. Seules les saisons de novelas du panier comptent pour cette remise.
- **Jeux PC** : définir des paliers de taille en Go, par exemple 1–49 Go et 50–100 Go, chacun avec son prix. La taille d’un jeu est arrondie au Go supérieur pour déterminer le palier. On peut aussi définir un nombre minimum de jeux dans la sélection et un prix fixe par jeu qui remplace alors les prix par taille.
- Une même devise est utilisée pour toute la sélection. Les saisons et la taille de chaque fiche restent corrigeables dans l’administration.

## Espace admin

L'administration est accessible par le lien discret « Espace privé » en pied de page (aucun lien dans la navigation publique) et n'est pas indexée par les moteurs de recherche.

- **Vue d'ensemble** : indicateurs (titres, affiches, descriptions, saisons), état de la boutique (WhatsApp, tarifs manquants), complétude par univers, derniers ajouts.
- **Santé du catalogue** : propositions de titres propres (balises de release, suffixe « (5) », capitales criées) à appliquer une par une ou en lot, doublons probables, fiches incomplètes.
- **Titres** : recherche, filtres par univers, statut et problème, sélection multiple (publier, masquer, compléter, supprimer avec confirmation saisie) et export CSV ou sauvegarde JSON.
- **Compléter les fiches** : tâche de fond reprise après rechargement qui interroge AniList, MyAnimeList, Kitsu, TVMaze, TheTVDB, IGDB/RAWG/Steam et Wikipédia (résumé français en priorité). Seuls les champs vides sont remplis ; une description étrangère est traduite.
- **À arbitrer** : quand « Compléter les fiches » hésite (titre de dossier approximatif, plusieurs versions homonymes, film contre série), les œuvres trouvées sont proposées ici avec leur affiche, leur année, leur source et leur taux de ressemblance. Un clic (ou les touches 1 à 5) remplit les champs vides ; « Chercher autrement » relance la recherche avec un autre titre ; une option remplace aussi le titre de la fiche par le titre officiel. La recherche essaie plusieurs variantes du titre (sans sous-titre français, chaque moitié d'un « A - B », titre entre parenthèses) et s'appuie sur les titres alternatifs des sources ; elle n'applique seule qu'une œuvre unique et sans doute, et ne retire jamais un numéro d'opus.
- **Session et sécurité** : verrouillage automatique après 10 à 60 minutes d'inactivité (avertissement une minute avant, synchronisé entre onglets), déconnexion de tous les appareils, changement de mot de passe avec indicateur de robustesse.

## Scanner un dossier

Dans l’onglet **Scanner un dossier**, l’admin choisit un dossier, y compris la racine d’un disque si le navigateur l’autorise. L’application examine localement les noms, chemins relatifs et tailles des fichiers pour proposer des séries, jeux, animés et novelas. Elle déduit les saisons de noms comme `S01E01` ou `Saison 1` et additionne les tailles des fichiers d’un jeu. Une prévisualisation permet de corriger la catégorie, le titre et les mesures avant l’import. Aucun contenu de fichier n’est envoyé au serveur ; seules les fiches confirmées sont enregistrées dans Supabase. La recherche d’affiche et de genres est tentée lors de l’import ; en l’absence de correspondance exacte, la fiche est enregistrée sans ces métadonnées et peut être corrigée ensuite.

Pour un dossier comme `jeux PC`, chaque sous-dossier de jeu devient une fiche, y compris si les fichiers portent des extensions de données comme `.doi` ou `.bin`. Un dossier de franchise tel que `BATTLEFIELD` ou `CALL OF DUTY`, contenant plusieurs sous-dossiers de jeux et aucun fichier de jeu à sa racine, est découpé en une fiche par sous-dossier, avec la taille propre à chaque jeu. Les sous-dossiers techniques (`data`, `bin`, `engine`…) restent rattachés à leur jeu. Les images `.iso` et archives placées directement à la racine deviennent des fiches séparées. Les mentions de version et de distribution sont retirées du titre proposé. Si un jeu contient plusieurs archives distinctes, le scanner propose aussi des fiches individuelles non cochées pour vérification. La taille affichée correspond aux fichiers présents, pas à la taille après installation.

Avant tout enregistrement, l'aperçu classe chaque titre en **nouveau**, **mise à jour** (saisons ou taille) ou **déjà à jour** (décoché par défaut). Règles de détection, éprouvées sur les disques de la collection :

- les saisons viennent des sous-dossiers (`S1`, `Saison 3`, `Titre S02`, `2. Arc`) et des épisodes (`S04E01`, `Second Season`) ; le plus grand numéro l'emporte, si bien qu'un dossier contenant seulement `S04` compte 4 saisons ;
- une suite sans numéro (*Noragami Aragoto*) ajoute une saison ; les dossiers VF/VOSTFR, films, OAV, coffrets `BOX 04` et dossiers d'un seul épisode ne comptent pas ;
- un dossier de franchise (*toaru SAGA*, ou au moins trois œuvres sans numéro) est découpé en une fiche par œuvre ; les épisodes rangés en vrac (`Titre 22`, `Titre 23`) sont regroupés ;
- une fiche existante est reconnue malgré un titre sale en base (« SCRUBS (9) ») ou grâce au titre lu dans les fichiers (souvent le titre anglais) ; **un import ne réduit jamais le nombre de saisons** ;
- après l'import, les fiches nouvelles ou incomplètes sont envoyées automatiquement à la tâche « Compléter les fiches » (option décochable).

Le navigateur ne peut pas parcourir silencieusement tous les disques : le dossier doit être sélectionné par l’admin. Les dossiers vides ne figurent pas dans la liste de fichiers transmise par le navigateur. La détection basée sur les noms peut nécessiter des corrections, notamment si les fichiers n’indiquent pas les saisons ou si un dossier mélange plusieurs titres.

## Déployer sur Vercel ou Netlify

- Importer ce dossier comme projet Git.
- Commande de build : `npm run build` ; dossier de sortie : `dist`.
- Ajouter les deux variables publiques Supabase `VITE_` de `.env.local` dans les réglages du projet.
- Ajouter `SITE_URL` (adresse publique du site) dans les variables d’environnement de l’hébergeur. Sur Vercel, ajouter aussi un `CRON_SECRET` aléatoire d’au moins 16 caractères ; il reste côté serveur et protège la route de routine.
- Ajouter l’URL finale à `ALLOWED_ORIGINS` dans les secrets Supabase et aux URL autorisées dans Supabase Auth.
- [`vercel.json`](vercel.json) et [`netlify.toml`](netlify.toml) gèrent la navigation directe vers les pages. La politique CSP et les autres en-têtes de sécurité sont définis pour les deux hébergeurs.

## Routine quotidienne

Vercel et Netlify sont préparés pour lancer une routine chaque jour à **08:00 UTC (09:00 au Nigeria)**. Elle vérifie que la page publique répond et effectue de petites lectures des tables publiques de Supabase. Elle ne modifie aucune donnée. Sur Vercel, la route `/api/keepalive` vérifie `CRON_SECRET`. Sur Netlify, la fonction planifiée n’est pas accessible par URL publique en production. Les échecs apparaissent dans les journaux de fonctions de l’hébergeur.

Cette routine sera active seulement après le déploiement et la configuration de Supabase. Elle aide à générer une activité régulière, mais **ne garantit pas** qu’un projet Supabase gratuit ne sera jamais mis en pause : Supabase évalue l’activité sur sept jours. Un projet sur une offre payante n’est pas soumis à la pause pour inactivité.

## Recherche des fiches

- Séries et novelas : TVMaze sans clé pour les séries internationales, complété par TheTVDB (clé gratuite) qui reconnaît les novelas via leurs titres alternatifs multilingues, y compris un nom de doublage français. Sans clé TheTVDB, les novelas renommées se complètent à la main.
- Animés : Jikan, avec titre, affiche et genres.
- Jeux PC : IGDB si les identifiants Twitch sont configurés, sinon RAWG, sinon **Steam**, qui ne demande aucune clé et fournit la jaquette portrait 600×900 du magasin.
- Wikipédia complète les sources précédentes et sert de dernier recours ; les couvertures protégées n’y sont pas systématiquement disponibles.
- En cas de fiche absente ou incomplète, l’admin peut saisir ou corriger les données à la main.

Les noms de dossiers sont nettoyés avant la recherche : préfixes de groupe (`tenoke-`, `rune-`), crochets de tracker, mentions `INTEGRALE`, `BRRip`, `VOSTFR`, marqueurs de saison (`S01`) et suffixe de saisons (`(2)`, `(1 2)`) — ce dernier sert alors de nombre de saisons quand les fichiers ne l’indiquent pas. La comparaison avec les fiches trouvées tolère un article manquant, une faute de frappe et un sigle ponctué, mais refuse deux opus différents : « Far Cry 2 » ne sera jamais rapproché de « Far Cry 3 ».

L’import de plusieurs titres propose une vérification avant enregistrement. Les correspondances incertaines ne sont pas cochées par défaut. Les abréviations courantes telles que `GOW`, `GTA`, `COD`, `RDR`, `NFS` et `TLOU` sont développées pour améliorer la recherche. Wikipédia en anglais, français et espagnol complète les sources existantes et peut aider à reconnaître une catégorie lorsque le dossier ne l’indique pas. Une contrainte unique par catégorie en base et une vérification dans l’interface empêchent les doublons ; une fiche déjà présente est mise à jour.

Les affiches récupérées depuis les sources prises en charge sont copiées une fois dans le bucket public `posters` de Supabase Storage. La fonction `cache-poster` vérifie l’identité admin, limite les hôtes et formats d’image, refuse les redirections et plafonne la taille à 5 Mo. Le catalogue conserve ensuite l’URL du fichier Supabase. Dans l’onglet **Catalogue**, l’admin peut rechercher les affiches et genres manquants sur les fiches déjà importées, par catégorie, ou conserver les affiches qui utilisent encore leur lien d’origine. Une recherche sans correspondance exacte ne modifie pas la fiche. Si une image ne peut pas être copiée, son lien d’origine reste visible. Les images libres de Wikimedia sont liées à leur page de crédit.

## Sécurité

- Les droits admin sont vérifiés dans les règles RLS de Supabase, pas seulement par l’interface.
- Les catalogues et les prix sont lisibles sans connexion ; leur modification est réservée à l’admin.
- Le nom d’utilisateur admin est résolu côté Edge Function ; la fonction applique une limite de tentatives et renvoie un message générique en cas d’échec.
- Le mot de passe est contrôlé par Supabase Auth ; il n’est ni stocké dans le code ni dans la table admin.
- React échappe les textes par défaut. Aucun HTML fourni par les catalogues externes n’est injecté dans la page ; les URL d’images sont limitées à `https`.
- La CSP interdit les scripts externes et les objets intégrés. Les clés serveur restent exclusivement dans Supabase.

La sélection est conservée dans le navigateur, sans compte client. Le clic WhatsApp ouvre un message prérempli ; le visiteur confirme son envoi dans WhatsApp.

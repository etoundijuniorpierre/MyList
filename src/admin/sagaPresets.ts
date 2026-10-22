import { normalizeTitle } from '../types'

export interface SagaWork { title: string; format: 'series' | 'film'; seasons: number | null; collection?: boolean }

const series = (title: string, seasons = 1): SagaWork => ({ title, format: 'series', seasons })
const film = (title: string): SagaWork => ({ title, format: 'film', seasons: null })
const collection = (title: string): SagaWork => ({ ...series(title), collection: true })

// Portail officiel anime.fate-go.us et fiches des œuvres, vérifiés le 22 octobre 2026.
// Les bonus Initium Iter accompagnent Babylonia et ne deviennent pas une deuxième saison.
const fateGrandOrder: SagaWork[] = [
  film('Fate/Grand Order: First Order'), collection('Fate/Grand Order: Moonlight/Lostroom'),
  series('Fate/Grand Order: Absolute Demonic Front — Babylonia'),
  film('Fate/Grand Order: Camelot — Wandering; Agateram'), film('Fate/Grand Order: Camelot — Paladin; Agateram'),
  film('Fate/Grand Order: Final Singularity — Grand Temple of Time: Solomon'),
  collection('Fate Grand Carnival'), series('Fate/Grand Order: Fujimaru Ritsuka ne comprend pas', 4),
  collection('Learning with Manga! Fate/Grand Order'), collection('Fate/Grand Order × Himuro no Tenchi'),
]

const narutoMovies = [
  'Naruto et la Princesse des neiges', 'Naruto : La Légende de la pierre de Guelel', 'Naruto : Mission spéciale au pays de la Lune',
  'Naruto Shippuden : Un funeste présage', 'Naruto Shippuden : Les Liens', 'Naruto Shippuden : La Flamme de la volonté',
  'Naruto Shippuden : The Lost Tower', 'Naruto Shippuden : Blood Prison', 'Road to Ninja: Naruto the Movie',
  'The Last: Naruto the Movie', 'Boruto: Naruto the Movie',
].map(film)

// Décompositions établies à partir des fichiers réels des disques (relevés E: et F:) ; Monogatari et Dragon Ball Z suivent la liste complète des œuvres.
const presets: { match: RegExp; note: string; works: SagaWork[] }[] = [
  {
    match: /^naruto(?: et naruto shippuden)? (?:films?|movies)(?: integrale)?$/,
    note: 'Les onze longs métrages de Naruto, de La Princesse des neiges (2004) à Boruto (2015), vérifiés dans les collections de l’éditeur VIZ.',
    works: narutoMovies,
  },
  {
    match: /^naruto shippuden (?:films?|movies)(?: integrale)?$/,
    note: 'Les huit films à partir de Shippuden, y compris The Last et Boruto.',
    works: narutoMovies.slice(3),
  },
  {
    match: /^fate grand order(?: saga| all series?| series| collection| pack)?$/,
    note: 'Fate/Grand Order : séries, films et collections identifiés séparément, vérifiés au 22 octobre 2026. Initium Iter est inclus avec Babylonia.',
    works: fateGrandOrder,
  },
  {
    match: /^fate(?: saga| all series?| series| collection| pack)?$/,
    note: 'Saga Fate : une fiche par œuvre et ses propres saisons ; les films et collections gardent leur format et leur tarif.',
    works: [
      series('Fate stay night'), series('Fate stay night Unlimited Blade Works', 2), series('Fate Zero', 2), series('Fate Apocrypha'),
      series('Fate Extra Last Encore', 2), series('Fate Strange Fake'), film('Fate strange Fake Whispers of Dawn 2023'),
      collection('Fate Prototype'), collection('Carnival Phantasm'), collection('Fate/Zero Café'),
      series('Fate⁄kaleid liner Prisma Illya', 4), series("Fate Stay Night Spin-off Today's menu for Emiya Family"),
      film('Fate/stay night: Unlimited Blade Works — Le Film'),
      film('Fate/stay night Heaven’s Feel I Presage Flower'), film('Fate/stay night Heaven’s Feel II Lost Butterfly'), film('Fate/stay night Heaven’s Feel III Spring Song'),
      film('Fate kaleid liner Prisma☆Illya, - Serment sous la neige'), film('Fate/kaleid liner Prisma Illya: Prisma Phantasm'), film('Fate/kaleid liner Prisma Illya: Licht — La fille sans nom'),
      ...fateGrandOrder,
    ],
  },
  {
    match: /^29 fichiers$/, note: 'Les 29 fichiers en vrac de « PAS VUS » : seuls les films sont conservés (les épisodes isolés de Steins;Gate 0, Migi & Dali, Spirit Warrior et Maria-sama ni wa Naisho, ainsi que Sakra, film non animé, sont ignorés).',
    works: [
      'The First Slam Dunk', 'One Piece Fan Letter', 'Rascal Does Not Dream of a Sister Venturing Out', 'Blue Lock The Movie Episode Nagi', 'Final Fantasy : Les Créatures de l’esprit',
      'Great Pretender Razbliuto', 'Le Château solitaire dans le miroir', 'Miraculous World : Londres, la course contre le temps', 'Paprika', 'Pretty Guardian Sailor Moon Cosmos The Movie Part 1',
      'Pretty Guardian Sailor Moon Cosmos The Movie Part 2', 'Psycho-Pass Providence', 'Rascal Does Not Dream of a Knapsack Kid', 'Sword Art Online Progressive : Scherzo of Deep Night',
      'Vampire Hunter D', 'Vampire Hunter D: Bloodlust', 'Wish',
    ].map(film),
  },
  {
    match: /^(?:mobile suit )?gundam (?:pack.*|saga|all series?)$/, note: 'Dossier « Mobile Suit Gundam » du disque F: (ordre de visionnage 1 à 38).',
    works: [
      collection('Mobile Suit Gundam The Origin'), series('Mobile Suit Zeta Gundam'), series('Mobile Suit Gundam 0079'), series('Mobile Suit Gundam ZZ'),
      film('Mobile Suit Gundam : Char contre-attaque'), collection('Mobile Suit Gundam 0080 War in the Pocket'), collection('Mobile Suit Gundam 0083 Stardust Memory'), film('Mobile Suit Gundam F91'),
      series('Mobile Suit Victory Gundam'), series('Mobile Fighter G Gundam'), series('Mobile Suit Gundam Wing'), film('Mobile Suit Gundam Wing Endless Waltz'),
      collection('Mobile Suit Gundam The 08th MS Team'), series('After War Gundam X'), series('Turn A Gundam'), collection('Gundam Evolve'), series('Mobile Suit Gundam SEED'),
      series('Mobile Suit Gundam SEED Destiny'), collection('Mobile Suit Gundam SEED C.E.73: Stargazer'), collection('Gundam SEED MSV Astray'), series('Mobile Suit Gundam 00', 2),
      collection('Mobile Suit Gundam Unicorn'), series('Mobile Suit Gundam AGE'), series('Gundam Reconguista in G'), series('Gundam Build Fighters'), series('Gundam Build Fighters Try'),
      collection('Gunpla Builders Beginning G'), series('Mobile Suit Gundam Thunderbolt', 2), series('Mobile Suit Gundam Iron-Blooded Orphans', 2), series('Mobile Suit Gundam The Witch from Mercury', 2),
      series('Mobile Suit Gundam GQuuuuuuX'), film('Mobile Suit Gundam Hathaway'), film('Mobile Suit Gundam Hathaway The Sorcery of Nymph Circe'),
    ],
  },
  {
    match: /^(?:saint seiya|les chevaliers du zodiaque)(?: saga| all series?)?$/, note: 'Dossier « Saint Seiya Saga » : la série classique compte le Sanctuaire et les trois chapitres d’Hadès.',
    works: [series('Saint Seiya : Les Chevaliers du Zodiaque', 6), series('Saint Seiya : Soul of Gold'), collection('Saint Seiya : The Lost Canvas'), series('Saint Seiya Omega', 2)],
  },
  {
    match: /^to ?aru(?: saga| series?)?$/, note: 'Dossier « toaru SAGA » : Index I à III, Railgun I, S et T, Accelerator.',
    works: [series('To Aru Majutsu no Index', 3), series('To Aru Kagaku no Railgun', 3), series('To Aru Kagaku no Accelerator')],
  },
  {
    match: /^(?:collection )?studio ghibli(?: collection)?$|^collection studio ghibli$/, note: 'Dossier « Collection Studio Ghibli » : 24 fichiers, dont un film en double.',
    works: ['Nausicaä de la vallée du vent', 'Le Château dans le ciel', 'Le Tombeau des lucioles', 'Mon voisin Totoro', 'Kiki la petite sorcière', 'Souvenirs goutte à goutte', 'Porco Rosso', 'Je peux entendre l’océan', 'Pompoko', 'Si tu tends l’oreille', 'Princesse Mononoké', 'Mes voisins les Yamada', 'Le Voyage de Chihiro', 'Le Royaume des chats', 'Le Château ambulant', 'Les Contes de Terremer', 'Ponyo sur la falaise', 'Arrietty, le petit monde des chapardeurs', 'La Colline aux coquelicots', 'Le vent se lève', 'Le Conte de la princesse Kaguya', 'Souvenirs de Marnie', 'Aya et la sorcière'].map(film),
  },
  {
    match: /^urusei yatsura lamu movies$|^lamu movies$/, note: 'Dossier « Urusei Yatsura - Lamu MOVIES » : les cinq films identifiés dans cet import.',
    works: ['Urusei Yatsura : Only You', 'Urusei Yatsura : Remember My Love', 'Urusei Yatsura : Lum the Forever', 'Urusei Yatsura : The Final Chapter', 'Urusei Yatsura : Always My Darling'].map(film),
  },
  {
    match: /^dragon ball z films?(?: integrale)?$/, note: 'Tous les films de Dragon Ball Z : les 15 films de cinéma (1989 à 2015) et les 2 téléfilms (Baddack, Trunks).',
    works: [
      'Dragon Ball Z : À la poursuite de Garlic', 'Dragon Ball Z : Le Robot des glaces', 'Dragon Ball Z : Baddack contre Freezer', 'Dragon Ball Z : Le Combat fratricide',
      'Dragon Ball Z : Le Super Saïyen', 'Dragon Ball Z : La Revanche de Cooler', 'Dragon Ball Z : Cent mille guerriers de métal', 'Dragon Ball Z : L’Offensive des cyborgs',
      'Dragon Ball Z : Broly le super guerrier', 'Dragon Ball Z : L’Histoire de Trunks', 'Dragon Ball Z : Les Mercenaires de l’espace', 'Dragon Ball Z : Rivaux dangereux',
      'Dragon Ball Z : Attaque Super Warrior !', 'Dragon Ball Z : L’Empereur des ténèbres', 'Dragon Ball Z : L’Attaque du dragon', 'Dragon Ball Z : Battle of Gods',
      'Dragon Ball Z : La Résurrection de ‘F’',
    ].map(film),
  },
  {
    match: /^monogatari(?: all series?| series| saga)?$/, note: 'Saga Monogatari complète, films compris, dans l’ordre de sortie (2009 à 2024).',
    works: [
      series('Bakemonogatari'), series('Nisemonogatari'), series('Nekomonogatari (Kuro)'), series('Monogatari Series Second Season'), series('Hanamonogatari'),
      series('Tsukimonogatari'), series('Owarimonogatari', 2), collection('Koyomimonogatari'), film('Kizumonogatari I : Tekketsu-hen'), film('Kizumonogatari II : Nekketsu-hen'),
      film('Kizumonogatari III : Reiketsu-hen'), collection('Zoku Owarimonogatari'), film('Kizumonogatari : Koyomi Vamp'), series('Monogatari Series Off & Monster'),
    ],
  },
]

// Vrais titres qui contiennent « Saga » ou « Collection » sans être des regroupements.
const genuine = /^(?:excel saga|vinland saga|harlock saga|youjo senki saga of tanya the evil|saga of tanya the evil|romancing saga|record of lodoss war|saga|films?)$/

export function sagaPreset(title: string) {
  const key = normalizeTitle(title.replace(/\[|\]/g, ' ')).replace(/\s+/g, ' ').trim()
  return presets.find((preset) => preset.match.test(key)) ?? null
}

/** Fiche qui regroupe probablement plusieurs œuvres : préréglage connu, mot « saga/pack/collection/movies », ou « [29 Fichiers] ». */
export function looksLikeSaga(title: string) {
  const key = normalizeTitle(title)
  if (genuine.test(key)) return false
  return Boolean(sagaPreset(title)) || /^\[\s*\d+\s+fichiers?\s*\]$/i.test(title.trim()) || /\b(?:saga|all ?series?|pack|collection|movies|films|int[eé]grale des films|trilogie)\b/i.test(title)
}

/** « [2 Fichiers] » sans liste connue : fiche issue d'un rapport de disque, sans œuvre à recréer. */
export function isNoiseEntry(title: string) {
  return /^\[\s*\d+\s+fichiers?\s*\]$/i.test(title.trim()) && !sagaPreset(title)
}

export function formatWorks(works: SagaWork[]) {
  return works.map((work) => `${work.title} ; ${work.format === 'film' ? 'film' : work.collection ? 'collection' : `${work.seasons ?? 1} saison${(work.seasons ?? 1) > 1 ? 's' : ''}`}`).join('\n')
}

/** « Titre ; film » ou « Titre ; 3 saisons » (une œuvre par ligne). */
export function parseWorks(text: string): SagaWork[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.lastIndexOf(';')
    const suffix = separator >= 0 ? line.slice(separator + 1).trim() : ''
    const hasKind = /^(?:films?|movies?|collections?|oav|ova|(?:\d+\s*)?(?:saisons?|seasons?)|\d+)$/i.test(suffix)
    const [title, kind] = hasKind ? [line.slice(0, separator).trim(), suffix] : [line, '']
    if (/film|movie/i.test(kind)) return film(title.trim())
    if (/collection|oav|ova/i.test(kind)) return collection(title.trim())
    const seasons = Number(kind.match(/\d+/)?.[0] ?? 1)
    return series(title.trim(), Number.isInteger(seasons) && seasons > 0 ? Math.min(seasons, 99) : 1)
  }).filter((work) => work.title.length >= 2)
}

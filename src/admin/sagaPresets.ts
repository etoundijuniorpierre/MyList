import { normalizeTitle } from '../types'

export interface SagaWork { title: string; format: 'series' | 'film'; seasons: number | null }

const series = (title: string, seasons = 1): SagaWork => ({ title, format: 'series', seasons })
const film = (title: string): SagaWork => ({ title, format: 'film', seasons: null })

// Décompositions établies à partir des fichiers réels des disques (relevés E: et F:) ; Monogatari et Dragon Ball Z suivent la liste complète des œuvres.
const presets: { match: RegExp; note: string; works: SagaWork[] }[] = [
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
      series('Mobile Suit Gundam The Origin'), series('Mobile Suit Zeta Gundam'), series('Mobile Suit Gundam 0079'), series('Mobile Suit Gundam ZZ'),
      film('Mobile Suit Gundam : Char contre-attaque'), series('Mobile Suit Gundam 0080 War in the Pocket'), series('Mobile Suit Gundam 0083 Stardust Memory'), film('Mobile Suit Gundam F91'),
      series('Mobile Suit Victory Gundam'), series('Mobile Fighter G Gundam'), series('Mobile Suit Gundam Wing'), film('Mobile Suit Gundam Wing Endless Waltz'),
      series('Mobile Suit Gundam The 08th MS Team'), series('After War Gundam X'), series('Turn A Gundam'), series('Gundam Evolve'), series('Mobile Suit Gundam SEED'),
      series('Mobile Suit Gundam SEED Destiny'), series('Gundam SEED C.E.73 Stargazer'), series('Gundam SEED MSV Astray'), series('Mobile Suit Gundam 00'),
      series('Mobile Suit Gundam Unicorn'), series('Mobile Suit Gundam AGE'), series('Gundam Reconguista in G'), series('Gundam Build Fighters'), series('Gundam Build Fighters Try'),
      series('Gunpla Builders Beginning G'), series('Mobile Suit Gundam Thunderbolt'), series('Mobile Suit Gundam Iron-Blooded Orphans', 2), series('Mobile Suit Gundam The Witch from Mercury'),
      series('Mobile Suit Gundam GQuuuuuuX'), film('Mobile Suit Gundam Hathaway'), film('Mobile Suit Gundam Hathaway The Sorcery of Nymph Circe'),
    ],
  },
  {
    match: /^(?:saint seiya|les chevaliers du zodiaque)(?: saga| all series?)?$/, note: 'Dossier « Saint Seiya Saga » : la série classique compte le Sanctuaire et les trois chapitres d’Hadès.',
    works: [series('Saint Seiya : Les Chevaliers du Zodiaque', 4), series('Saint Seiya : Soul of Gold'), series('Saint Seiya : The Lost Canvas', 2), series('Saint Seiya Omega', 2)],
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
    match: /^urusei yatsura lamu movies$|^lamu movies$/, note: 'Dossier « Urusei Yatsura - Lamu MOVIES » : 5 films.',
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
      series('Tsukimonogatari'), series('Owarimonogatari', 2), series('Koyomimonogatari'), film('Kizumonogatari I : Tekketsu-hen'), film('Kizumonogatari II : Nekketsu-hen'),
      film('Kizumonogatari III : Reiketsu-hen'), series('Zoku Owarimonogatari'), film('Kizumonogatari : Koyomi Vamp'), series('Monogatari Series Off & Monster Season'),
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
  return works.map((work) => `${work.title} ; ${work.format === 'film' ? 'film' : `${work.seasons ?? 1} saison${(work.seasons ?? 1) > 1 ? 's' : ''}`}`).join('\n')
}

/** « Titre ; film » ou « Titre ; 3 saisons » (une œuvre par ligne). */
export function parseWorks(text: string): SagaWork[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [title, kind = ''] = line.split(/\s*;\s*/)
    if (/film|movie/i.test(kind)) return film(title.trim())
    const seasons = Number(kind.match(/\d+/)?.[0] ?? 1)
    return series(title.trim(), Number.isInteger(seasons) && seasons > 0 ? Math.min(seasons, 99) : 1)
  }).filter((work) => work.title.length >= 2)
}

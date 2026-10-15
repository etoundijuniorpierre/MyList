import type { CatalogItem, ItemInput, MetadataResult } from './types'
import { normalizeTitle, titleKey } from './types'
import { cleanTitle, type ScannedItem } from './folderScan'

export function unmatchedAnime(title: string): MetadataResult {
  const cleanTitle = title.trim()
  return {
    category: 'anime', media_type: 'anime', title: cleanTitle,
    title_key: titleKey('anime', 'anime', cleanTitle), synopsis: null, poster_url: null,
    genres: [], year: null, source: 'manual', source_id: null, source_url: null,
    active: true, seasons_count: null, game_size_gb: null,
  }
}

function importTitle(title: string) {
  const stripped = title
    .replace(/\s*\[(?:adn|crunchyroll|crunchy roll|netflix|disney\+?|prime video|wakanim|funimation)\]\s*$/i, '')
    .replace(/\s*\[(?:\d+\s+)?fichiers?\]\s*$/i, '')
  // « SCRUBS (9) » déjà en base et « Scrubs » scanné désignent la même fiche : on compare les titres nettoyés.
  return normalizeTitle(cleanTitle(stripped) || stripped)
}

type ScanAlias = { title: string; seasonFloor?: number; preserveExistingSeasons?: boolean }

// Associations confirmées pendant l’audit de l’import D:\ANIMES. Les suites
// nommées sont reliées à leur série principale avec leur vrai total de saisons.
// Les titres d’œuvres dérivées restent volontairement autonomes.
const scanAliases = new Map<string, ScanAlias>([
  ['blue lock vs u 20 japan', { title: 'Blue Lock', seasonFloor: 2 }],
  ['blue lock', { title: 'Blue Lock', seasonFloor: 2 }],
  ['food war', { title: 'Food Wars - Shokugeki no Sôma', seasonFloor: 3 }],
  ['food wars shokugeki no soma', { title: 'Food Wars - Shokugeki no Sôma', seasonFloor: 5 }],
  ['cinderella chef', { title: 'Cinderella Chef 2', seasonFloor: 2 }],
  ['cinderella chef 2', { title: 'Cinderella Chef 2', seasonFloor: 2 }],
  ['akuyaku reijou nanode last boss wo kattemimashita', { title: 'Akuyaku Reijou nanode Last' }],
  ['hanyou no yashahime sengoku otogizoushi', { title: 'Hanyou no Yashahime' }],
  ['hitori no shita the outcast', { title: 'Hitori no Shita', seasonFloor: 4 }],
  ['jibaku shounen hanako kun 2 part 2', { title: 'Jibaku Shounen Hanako kun', seasonFloor: 2 }],
  ['jibaku shounen hanako kun', { title: 'Jibaku Shounen Hanako kun', seasonFloor: 2 }],
  ['k project return of kings', { title: 'K Project', seasonFloor: 2 }],
  ['k project', { title: 'K Project', seasonFloor: 2 }],
  ['kakuriyo no yadomeshi ni', { title: 'Kakuriyo no Yadomeshi', seasonFloor: 2 }],
  ['kakuriyo no yadomeshi', { title: 'Kakuriyo no Yadomeshi', seasonFloor: 2 }],
  ["masamune kun s revenge", { title: "Masamune-Kun's Revenge S", seasonFloor: 2 }],
  ["masamune kun s revenge s", { title: "Masamune-Kun's Revenge S", seasonFloor: 2 }],
  ['rikei ga koi ni ochita no de shoumei shite mita', { title: 'Rikei ga Koi ni Ochita no de Shoumei Shite', seasonFloor: 2 }],
  ['rikei ga koi ni ochita no de shoumei shite', { title: 'Rikei ga Koi ni Ochita no de Shoumei Shite', seasonFloor: 2 }],
  ['spice and wolf', { title: 'Spice and Wolf', seasonFloor: 2 }],
  ['spice and wolf 2008 2009', { title: 'Spice and Wolf', seasonFloor: 2 }],
  ['uta no prince sama', { title: 'Uta No Prince Sama Maji Love', seasonFloor: 4 }],
  ['uta no prince sama maji love', { title: 'Uta No Prince Sama Maji Love', seasonFloor: 4 }],
  ['inazuma eleven go chrono stone', { title: 'Inazuma Eleven GO', preserveExistingSeasons: true }],
  ['nageki no bourei wa intai shitai part 2', { title: 'Nageki no Bourei wa Intai Shitai', preserveExistingSeasons: true }],
  ['nageki no bourei wa intai shitai', { title: 'Nageki no Bourei wa Intai Shitai', preserveExistingSeasons: true }],
  ['kaeloo', { title: 'Kaeloo', preserveExistingSeasons: true }],
  ['school rumble ichi gaki hoshu', { title: 'School Rumble', preserveExistingSeasons: true }],
  ['school rumble ichi gaki hoshu 2005 remux mpeg2', { title: 'School Rumble', preserveExistingSeasons: true }],
  ['ningen fushin adventurers', { title: 'Ningen Fushin Adventurers Who Don’t Belie' }],
  ['orange 01 fin', { title: 'Orange' }],
  ['summertime rendering time shadows', { title: 'Summertime Rendering' }],
  ['yuusha yamemasu', { title: 'Yuusha Yamemasu', preserveExistingSeasons: true }],
  ['yuusha yamemasu specials', { title: 'Yuusha Yamemasu', preserveExistingSeasons: true }],
  ['the legend of heroes trails of cold steel northern war', { title: 'The Legend of Heroes Trails of Cold Steel Northern War' }],
  ['the magical revolution of the reincarnated princess and the genius young lady', { title: 'The Magical Revolution of the Reincarnated' }],
  ['the magical revolution of the reincarnated princess', { title: 'The Magical Revolution of the Reincarnated' }],
  ['persona 4 the animation', { title: 'Persona 4' }],
  ['osananajimi ga zettai ni makenai lovecome', { title: 'Osananajimi Ga Zettai Ni Makenai' }],
  ['reborn to master the blade from hero king to extraordinary squire', { title: 'Reborn to Master the Blade from Hero King' }],
  ['seisen cerberus', { title: 'Seisen Cerberus- Ryuukoku no Fatalité' }],
  ['uchuu kyoudai', { title: 'Uchuu Kyoudai - Space Brother' }],
])

const filmTitleAliases = new Map<string, string>([
  ['amer beton', 'Amer Béton'],
  ['presage flower', 'Fate/stay night Heaven’s Feel I Presage Flower'],
  ['lost butterfly', 'Fate/stay night Heaven’s Feel II Lost Butterfly'],
  ['spring song', 'Fate/stay night Heaven’s Feel III Spring Song'],
  ['bungo stray dogs', 'Bungo Stray Dogs Dead Apple'],
  ['mahou shoujo madoka magica part i hajimari no monogatari 01', 'Puella Magi Madoka Magica the Movie Part I Beginnings'],
  ['mahou shoujo madoka magica part ii eien no monogatari 01', 'Puella Magi Madoka Magica the Movie Part II Eternal'],
  ['mahou shoujo madoka magica part iii hangyaku no monogatari 01', 'Puella Magi Madoka Magica the Movie Part III Rebellion'],
  ['shokugeki no souma jump festa special', 'Food Wars Jump Festa Special'],
  ['that time i got reincarnated as a slime scarlet bond', 'That Time I Got Reincarnated as a Slime Scarlet Bond'],
  ['tensei shitara slime datta ken guren no kizuna hen', 'That Time I Got Reincarnated as a Slime Scarlet Bond'],
])

function scanAssociationTitle(title: string) {
  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2})?\)/g, ' ')
    .replace(/\b(?:10\s*bits?|bd(?:\s*1080p)?|blu\s*ray|bluray|hevc|vostfr|vost|vf|remux|mkv|mp4|avi|mpeg2|funi|sceneguardians|monkey d lulu)\b.*$/i, ' ')
    .replace(/\s+(?:episode|ep)\s*(?:special\s*)?\d*.*$/i, ' ')
    .replace(/\s+\d{1,3}\s*[-–]\s*\d{1,3}(?:\s+mkv)?$/i, ' ')
    .replace(/\s*-\s*(?:dl|ddp\d*|funi|cr|adn|nc|e-ac-3|mpeg2|remux|sceneguardians|monkey d lulu)\b.*$/i, ' ')
    .replace(/\s+v\d+$/i, ' ')
    .replace(/\s+\d{4}$/i, ' ')
    .replace(/[\s._-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const normalized = normalizeTitle(cleaned)
  return scanAliases.get(normalized) ?? { title: cleaned || title.trim() }
}

export function scannedCatalogMatch(row: ScannedItem, items: CatalogItem[]) {
  const filmAlias = row.category === 'anime' && row.media_format === 'film' ? filmTitleAliases.get(normalizeTitle(row.title)) : undefined
  const alias = filmAlias ? { title: filmAlias } : row.category === 'anime' ? scanAssociationTitle(row.title) : { title: row.title.trim() }
  const identity = (category: CatalogItem['category'], mediaType: CatalogItem['media_type'], title: string, mediaFormat?: CatalogItem['media_format']) => {
    const associatedTitle = category === 'anime' ? scanAssociationTitle(title).title : title
    return catalogIdentity(category, mediaType, associatedTitle, mediaFormat)
  }
  const key = identity(row.category, row.media_type, alias.title, row.media_format)
  let existing = items.find((item) => identity(item.category, item.media_type, item.title, item.media_format) === key)
  // Le dossier porte parfois le titre japonais et les fichiers le titre anglais (ou l'inverse).
  if (!existing && row.alt_title) {
    const altKey = identity(row.category, row.media_type, row.alt_title, row.media_format)
    existing = items.find((item) => identity(item.category, item.media_type, item.title, item.media_format) === altKey)
  }
  return { alias, existing, key }
}

export function isCatalogNoiseTitle(title: string) {
  return /^\[\s*\d+\s+fichiers?\s*\]$/i.test(title.trim()) || importTitle(title).length === 0
}

export function catalogIdentity(category: CatalogItem['category'], mediaType: CatalogItem['media_type'], title: string, mediaFormat?: CatalogItem['media_format']) {
  return `${category}:${category === 'anime' ? 'anime' : category === 'dramas' ? mediaType ?? 'unknown' : 'none'}:${mediaFormat ?? 'series'}:${importTitle(title)}`
}

export function sameCatalogTitle(left: Pick<CatalogItem, 'category' | 'media_type' | 'title' | 'media_format'>, right: Pick<CatalogItem, 'category' | 'media_type' | 'title' | 'media_format'>) {
  return catalogIdentity(left.category, left.media_type, left.title, left.media_format) === catalogIdentity(right.category, right.media_type, right.title, right.media_format)
}

export function mergeCatalogUpdate(input: ItemInput, existing?: CatalogItem, fallback?: CatalogItem): ItemInput {
  if (!existing && !fallback) return input
  return {
    ...input,
    synopsis: input.synopsis?.trim() ? input.synopsis : existing?.synopsis ?? fallback?.synopsis ?? null,
    poster_url: input.poster_url ?? existing?.poster_url ?? fallback?.poster_url ?? null,
    genres: input.genres.length ? input.genres : existing?.genres.length ? existing.genres : fallback?.genres ?? [],
    year: input.year ?? existing?.year ?? fallback?.year ?? null,
    source: input.source === 'manual' ? existing?.source ?? fallback?.source ?? 'manual' : input.source,
    source_id: input.source_id ?? existing?.source_id ?? fallback?.source_id ?? null,
    source_url: input.source_url ?? existing?.source_url ?? fallback?.source_url ?? null,
    seasons_count: input.seasons_count ?? existing?.seasons_count ?? fallback?.seasons_count ?? null,
    game_size_gb: input.game_size_gb ?? existing?.game_size_gb ?? fallback?.game_size_gb ?? null,
  }
}

export function scannedItemInput(row: ScannedItem, existing?: CatalogItem): ItemInput {
  const mediaType = row.category === 'anime' ? 'anime' : row.category === 'dramas' ? row.media_type : null
  const title = existing?.title ?? row.title.trim()
  const seasonsMissing = row.warning?.includes('Saison non indiquée') ?? false
  return {
    category: row.category,
    media_type: mediaType,
    media_format: row.category === 'anime' && row.media_format === 'film' ? 'film' : null,
    title,
    title_key: existing?.title_key ?? titleKey(row.category, mediaType, title, row.category === 'anime' ? row.media_format ?? null : null),
    synopsis: existing?.synopsis ?? null,
    poster_url: existing?.poster_url ?? null,
    genres: existing?.genres ?? [],
    year: existing?.year ?? null,
    source: existing?.source ?? 'scan',
    source_id: existing?.source_id ?? null,
    source_url: existing?.source_url ?? null,
    active: existing?.active ?? true,
    // Un disque ne retire jamais de saisons : « S04 » seul sur le disque d'hiver ne ramène pas une fiche de 5 saisons à 4.
    seasons_count: row.category === 'games' ? null : seasonsMissing ? existing?.seasons_count ?? row.seasons_count
      : Math.max(row.seasons_count ?? 0, existing?.seasons_count ?? 0) || null,
    game_size_gb: row.category === 'games' ? row.game_size_gb ?? existing?.game_size_gb ?? null : null,
  }
}

export type ScanPlanStatus = 'new' | 'update' | 'unchanged'

export interface ScanPlanEntry {
  key: string
  rows: ScannedItem[]
  existing?: CatalogItem
  status: ScanPlanStatus
  changes: string[]
  input: ItemInput
}

/**
 * Prépare l'import d'un scan sans rien écrire : fusionne les lignes qui désignent la même fiche,
 * les rapproche du catalogue (titre nettoyé, titre alternatif) et décrit ce qui changera.
 */
export function planScanImport(rows: ScannedItem[], items: CatalogItem[]): ScanPlanEntry[] {
  const merged = new Map<string, { row: ScannedItem; rows: ScannedItem[]; existing?: CatalogItem }>()
  for (const row of rows) {
    if (isCatalogNoiseTitle(row.title)) continue
    const match = scannedCatalogMatch(row, items)
    const title = match.existing?.title ?? match.alias.title
    const key = match.existing ? `id:${match.existing.id}` : catalogIdentity(row.category, row.media_type, title, row.media_format)
    const seasons = row.category === 'games' ? null : match.alias.preserveExistingSeasons
      ? match.existing?.seasons_count ?? row.seasons_count
      : Math.max(row.seasons_count ?? 0, match.alias.seasonFloor ?? 0) || null
    const normalized: ScannedItem = { ...row, title, seasons_count: seasons }
    const previous = merged.get(key)
    if (!previous) { merged.set(key, { row: normalized, rows: [row], existing: match.existing }); continue }
    merged.set(key, {
      row: {
        ...previous.row,
        seasons_count: Math.max(previous.row.seasons_count ?? 0, normalized.seasons_count ?? 0) || null,
        game_size_gb: Math.max(previous.row.game_size_gb ?? 0, normalized.game_size_gb ?? 0) || null,
        file_count: previous.row.file_count + normalized.file_count,
        warning: previous.row.warning?.includes('Saison non indiquée') && !normalized.warning?.includes('Saison non indiquée') ? normalized.warning : previous.row.warning,
      },
      rows: [...previous.rows, row],
      existing: previous.existing ?? match.existing,
    })
  }
  return [...merged].map(([key, { row, rows: sources, existing }]) => {
    const input = scannedItemInput(row, existing)
    const changes: string[] = []
    if (existing) {
      if (input.category !== 'games' && (input.seasons_count ?? 0) !== (existing.seasons_count ?? 0)) changes.push(`Saisons ${existing.seasons_count ?? '?'} → ${input.seasons_count ?? '?'}`)
      if (input.category === 'games' && input.game_size_gb && Math.abs((existing.game_size_gb ?? 0) - input.game_size_gb) > Math.max(0.05, input.game_size_gb * 0.02)) changes.push(`Taille ${existing.game_size_gb ?? '?'} → ${input.game_size_gb} Go`)
    }
    if (sources.length > 1) changes.push(`${sources.length} dossiers fusionnés`)
    const status: ScanPlanStatus = !existing ? 'new' : changes.some((change) => !change.endsWith('fusionnés')) ? 'update' : 'unchanged'
    return { key, rows: sources, existing, status, changes, input }
  })
}

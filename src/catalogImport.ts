import type { CatalogItem, ItemInput, MetadataResult } from './types'
import { normalizeTitle, titleKey } from './types'
import type { ScannedItem } from './folderScan'

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
  return normalizeTitle(title
    .replace(/\s*\[(?:adn|crunchyroll|crunchy roll|netflix|disney\+?|prime video|wakanim|funimation)\]\s*$/i, '')
    .replace(/\s*\[(?:\d+\s+)?fichiers?\]\s*$/i, ''))
}

type ScanAlias = { title: string; seasonFloor?: number; preserveExistingSeasons?: boolean }

// Associations confirmées pendant l’audit de l’import D:\ANIMES. Les suites
// nommées sont reliées à leur série principale avec leur vrai total de saisons.
// Les titres d’œuvres dérivées restent volontairement autonomes.
const scanAliases = new Map<string, ScanAlias>([
  ['blue lock vs u 20 japan', { title: 'Blue Lock', seasonFloor: 2 }],
  ['blue lock', { title: 'Blue Lock', seasonFloor: 2 }],
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
  const alias = row.category === 'anime' ? scanAssociationTitle(row.title) : { title: row.title.trim() }
  const identity = (category: CatalogItem['category'], mediaType: CatalogItem['media_type'], title: string) => {
    const associatedTitle = category === 'anime' ? scanAssociationTitle(title).title : title
    return catalogIdentity(category, mediaType, associatedTitle)
  }
  const key = identity(row.category, row.media_type, alias.title)
  const existing = items.find((item) => identity(item.category, item.media_type, item.title) === key)
  return { alias, existing, key }
}

export function isCatalogNoiseTitle(title: string) {
  return /^\[\s*\d+\s+fichiers?\s*\]$/i.test(title.trim()) || importTitle(title).length === 0
}

export function catalogIdentity(category: CatalogItem['category'], mediaType: CatalogItem['media_type'], title: string) {
  return `${category}:${category === 'anime' ? 'anime' : category === 'dramas' ? mediaType ?? 'unknown' : 'none'}:${importTitle(title)}`
}

export function sameCatalogTitle(left: Pick<CatalogItem, 'category' | 'media_type' | 'title'>, right: Pick<CatalogItem, 'category' | 'media_type' | 'title'>) {
  return catalogIdentity(left.category, left.media_type, left.title) === catalogIdentity(right.category, right.media_type, right.title)
}

export function mergeCatalogUpdate(input: ItemInput, existing?: CatalogItem): ItemInput {
  if (!existing) return input
  return {
    ...input,
    synopsis: input.synopsis?.trim() ? input.synopsis : existing.synopsis,
    poster_url: input.poster_url ?? existing.poster_url,
    genres: input.genres.length ? input.genres : existing.genres,
    year: input.year ?? existing.year,
    source: input.source === 'manual' ? existing.source : input.source,
    source_id: input.source_id ?? existing.source_id,
    source_url: input.source_url ?? existing.source_url,
    seasons_count: input.seasons_count ?? existing.seasons_count,
    game_size_gb: input.game_size_gb ?? existing.game_size_gb,
  }
}

export function scannedItemInput(row: ScannedItem, existing?: CatalogItem): ItemInput {
  const mediaType = row.category === 'anime' ? 'anime' : row.category === 'dramas' ? row.media_type : null
  const title = existing?.title ?? row.title.trim()
  const seasonsMissing = row.warning?.includes('Saison non indiquée') ?? false
  return {
    category: row.category,
    media_type: mediaType,
    title,
    title_key: existing?.title_key ?? titleKey(row.category, mediaType, title),
    synopsis: existing?.synopsis ?? null,
    poster_url: existing?.poster_url ?? null,
    genres: existing?.genres ?? [],
    year: existing?.year ?? null,
    source: existing?.source ?? 'scan',
    source_id: existing?.source_id ?? null,
    source_url: existing?.source_url ?? null,
    active: existing?.active ?? true,
    seasons_count: row.category === 'games' ? null : seasonsMissing ? existing?.seasons_count ?? row.seasons_count : row.seasons_count ?? existing?.seasons_count ?? null,
    game_size_gb: row.category === 'games' ? row.game_size_gb ?? existing?.game_size_gb ?? null : null,
  }
}

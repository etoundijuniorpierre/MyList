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

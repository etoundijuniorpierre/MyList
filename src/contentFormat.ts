import type { CatalogItem } from './types'

type SeasonalItem = Pick<CatalogItem, 'category' | 'media_format'> & Partial<Pick<CatalogItem, 'metadata_preferences' | 'seasons_total' | 'seasons_count'>>

export function isEpisodeCollection(item: SeasonalItem) {
  return item.category === 'anime' && item.media_format !== 'film' && item.metadata_preferences?.content_kind === 'episode-collection'
}

export function usesCommercialSeasons(item: SeasonalItem) {
  return item.category === 'anime' && item.media_format !== 'film' && !isEpisodeCollection(item)
    && item.metadata_preferences?.seasons_quantity_mode === 'commercial-total'
    && Number.isInteger(item.seasons_total) && item.seasons_total! >= 1 && item.seasons_total! <= 999
    && !(item.seasons_count! > item.seasons_total!)
}

/** Le panier conserve son nombre de saisons choisies ; une collection vaut une unité. */
export function billableSeasonUnits(item: SeasonalItem) {
  return isEpisodeCollection(item) ? 1 : Number(item.seasons_count) || 0
}

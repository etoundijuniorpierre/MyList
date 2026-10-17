import type { CatalogItem } from './types'
import type { MetadataPreferences } from './metadataDecisions'
import type { Candidate } from './metadataMatch'

export interface CompletionData {
  poster_url?: string
  synopsis?: string
  synopsisInFrench?: boolean
  genres?: string[]
  year?: number
  source?: string
  source_id?: string | null
  source_url?: string | null
  seasons_total?: number | null
  seasons_checked_at?: string
  seasons_note?: string
  seasons_source_url?: string
  seasons_error?: string
  binding?: Candidate
  sources: string[]
}

export function completionPatch(item: CatalogItem, found: CompletionData, extra: Record<string, unknown> = {}) {
  const patch: Record<string, unknown> = { ...extra }
  if ('metadata_preferences' in item && found.binding && (!item.metadata_preferences?.match || (item.metadata_preferences.match.key === found.binding.key && JSON.stringify(item.metadata_preferences.match) !== JSON.stringify(found.binding)))) {
    patch.metadata_preferences = { ...item.metadata_preferences, ...(extra.metadata_preferences as MetadataPreferences | undefined), match: { ...found.binding, synopsis: found.binding.synopsis?.slice(0, 1500) ?? null } }
  }
  if (found.poster_url && !item.poster_url) patch.poster_url = found.poster_url
  if (found.genres?.length && !item.genres.length) patch.genres = found.genres
  if (found.year && !item.year) patch.year = found.year
  if (found.synopsis && !item.synopsis?.trim()) patch.synopsis = found.synopsis
  if (found.source && !item.metadata_preferences?.match) {
    patch.source = found.source; patch.source_id = found.source_id ?? null; patch.source_url = found.source_url ?? null
  }
  if ('metadata_preferences' in item && found.seasons_checked_at) {
    patch.seasons_checked_at = found.seasons_checked_at
    patch.metadata_preferences = { ...item.metadata_preferences, ...(patch.metadata_preferences as MetadataPreferences | undefined), seasons_note: found.seasons_note, seasons_source_url: found.seasons_source_url }
    if (found.seasons_total) {
      patch.seasons_total = found.seasons_total
      // Un total public ne prouve pas que toutes les saisons sont disponibles à la vente.
      if (item.category !== 'games' && item.media_format !== 'film' && !item.metadata_preferences?.seasons_manual && (!item.seasons_count || item.metadata_preferences?.seasons_auto)) {
        patch.seasons_count = found.seasons_total
        patch.metadata_preferences = { ...(patch.metadata_preferences as MetadataPreferences), seasons_auto: true }
      }
    }
  }
  return patch
}

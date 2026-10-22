import type { CatalogItem } from './types'
import type { Candidate } from './metadataMatch'

export interface MetadataPreferences {
  seasons_reference?: { count: number; locked: boolean; scheme: string; note: string; source_url: string; checked_at: string; episodes?: number }
  title?: string
  match?: Candidate
  rejected?: boolean
  ignore_source?: boolean
  seasons_manual?: number
  seasons_auto?: boolean
  seasons_note?: string
  seasons_source_url?: string
}

export function acceptedPreferences(item: CatalogItem, candidate: Candidate, title = item.title): MetadataPreferences {
  return { ...item.metadata_preferences, title, rejected: false, ignore_source: false,
    match: { ...candidate, aliases: candidate.aliases.slice(0, 8), synopsis: candidate.synopsis?.slice(0, 1500) ?? null } }
}

/** Réutilise aussi les identifiants déjà enregistrés avant cette migration. */
export function retainedCandidate(item: CatalogItem): Candidate | null {
  if (item.metadata_preferences?.match) return item.metadata_preferences.match
  if (item.metadata_preferences?.ignore_source || item.metadata_preferences?.rejected || !item.source_id || !['tvmaze', 'tvdb', 'anilist', 'jikan-anime', 'kitsu', 'rawg', 'igdb', 'steam', 'nautiljon'].includes(item.source)) return null
  return { key: `${item.source}:${item.source_id}`, title: item.title, aliases: [], year: item.year,
    format: item.media_format ?? (item.category === 'games' ? null : 'series'), category: item.category,
    poster_url: item.poster_url, synopsis: item.synopsis, genres: item.genres, source: item.source, source_id: item.source_id,
    source_url: item.source_url, sources: [item.source], identities: [{ source: item.source, id: item.source_id }], score: 1, notes: [] }
}

export function needsSeasonLookup(item: CatalogItem, now = Date.now()) {
  if (item.category === 'games' || item.media_format === 'film') return false
  if (hasVerifiedSeasonTotal(item)) return false
  const checked = Date.parse(item.seasons_checked_at ?? '')
  const age = item.seasons_total ? 30 * 86400_000 : 86400_000
  return !Number.isFinite(checked) || now - checked >= age
}

export function hasVerifiedSeasonTotal(item: Pick<CatalogItem, 'seasons_total' | 'metadata_preferences'>) {
  const reference = item.metadata_preferences?.seasons_reference
  return Boolean(reference?.locked && Number.isInteger(reference.count) && reference.count >= 1 && reference.count <= 999 && reference.count === item.seasons_total)
}

export function needsCompletion(item: CatalogItem) {
  if (item.metadata_preferences?.rejected) return false
  return !item.poster_url || !item.synopsis?.trim() || !item.genres.length || !item.year || needsSeasonLookup(item) || needsSeasonDetails(item)
}

export function needsSeasonDetails(item: CatalogItem, now = Date.now()) {
  if (!['series', 'anime'].includes(item.category) || item.media_format === 'film') return false
  const checked = Date.parse(item.season_details_checked_at ?? '')
  return !Number.isFinite(checked) || now - checked >= (item.season_details_note ? 86400_000 : 30 * 86400_000)
}

export function reviewIsPending(item: CatalogItem, dismissed?: boolean) {
  return !dismissed && !retainedCandidate(item) && !item.metadata_preferences?.rejected
}

export function requireDecisionStorage(item: CatalogItem) {
  if (!('metadata_preferences' in item)) throw new Error('La migration « persist_metadata_decisions » doit être exécutée dans Supabase pour conserver vos validations. Aucune décision n’a été effacée.')
}

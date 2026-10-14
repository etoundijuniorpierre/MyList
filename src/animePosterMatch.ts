import type { CatalogItem, MetadataResult } from './types'
import { normalizeTitle } from './types'

type AnimeIdentity = Pick<CatalogItem, 'title' | 'year' | 'media_format'>

// A film and a series with the same name must never share a cover. Search
// providers without a format are useful for discovery, but not for films.
export function compatibleAnimePoster(item: AnimeIdentity, result: MetadataResult): boolean {
  if (result.category !== 'anime' || result.match !== 'exact' || !result.poster_url) return false
  try { if (new URL(result.poster_url).protocol !== 'https:') return false } catch { return false }
  const expectedFormat = item.media_format === 'film' ? 'film' : 'series'
  if (result.media_format !== expectedFormat) return false
  if (item.year && (!result.year || Math.abs(item.year - result.year) > 1)) return false
  return true
}

export function selectAnimePoster(item: AnimeIdentity, results: MetadataResult[]): MetadataResult | null {
  const candidates = results.filter((result) => compatibleAnimePoster(item, result))
  if (!candidates.length) return null
  // Prefer the literal title when aliases yielded multiple distinct works.
  // A single alias match remains valid when providers use a translated title.
  const literal = candidates.filter((result) => normalizeTitle(result.title) === normalizeTitle(item.title))
  const pool = literal.length ? literal : candidates
  const identities = new Set(pool.map((result) => `${normalizeTitle(result.title)}:${result.year ?? '?'}`))
  if (identities.size !== 1) return null
  const sourceRank: Record<string, number> = { anilist: 0, 'jikan-anime': 1, tvdb: 2, wikipedia: 3 }
  return [...pool].sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9))[0]
}

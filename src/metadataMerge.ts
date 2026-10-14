import type { MetadataResult } from './types'

export function mergeMetadataResults(...groups: MetadataResult[][]): MetadataResult[] {
  const merged = new Map<string, MetadataResult>()
  for (const result of groups.flat()) {
    const current = merged.get(result.title_key)
    if (!current) { merged.set(result.title_key, result); continue }
    const winner = current.poster_url ? current : result.poster_url ? result : current
    merged.set(result.title_key, {
      ...winner,
      synopsis: current.synopsis ?? result.synopsis,
      genres: current.genres.length ? current.genres : result.genres,
      year: current.year ?? result.year,
      match: current.match === 'exact' || result.match === 'exact' ? 'exact' : 'approximate',
    })
  }
  return [...merged.values()]
}

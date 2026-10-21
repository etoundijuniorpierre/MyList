import { supabase } from './supabase'
import { retainedCandidate, needsSeasonDetails } from './metadataDecisions'
import { availableSeasonNumbers } from './seasonSelection'
import { forgetSeasons } from './catalogSeasons'
import { safeUrl } from './urls'
import type { Candidate } from './metadataMatch'
import type { CatalogItem, CatalogSeason } from './types'

export async function completeSeasonDetails(item: CatalogItem, binding: Candidate | undefined, authorized: () => boolean) {
  if (!supabase || !needsSeasonDetails(item)) return item
  const candidate = binding ?? retainedCandidate(item)
  if (!candidate || !authorized()) return item
  const identities = [...(candidate.identities ?? []), { source: candidate.source, id: candidate.source_id ?? '' }]
  const identity = identities.find(entry => entry.source === (item.category === 'anime' ? 'anilist' : 'tvmaze')) ?? identities.find(entry => ['tvmaze', 'anilist', 'jikan-anime', 'tvdb', 'kitsu', 'wikipedia'].includes(entry.source))
  if (!identity) return item
  const params = new URLSearchParams({ source: identity.source, id: /^\d+$/.test(identity.id) ? identity.id : '', title: candidate.title.slice(0, 160), category: item.category })
  if (candidate.year) params.set('year', String(candidate.year))
  if (item.seasons_total || item.seasons_count) params.set('expected', String(Math.max(item.seasons_total ?? 0, item.seasons_count ?? 0)))
  candidate.aliases.filter(alias => alias.length >= 2 && alias.length <= 160).slice(0, 2).forEach(alias => params.append('alias', alias))
  const response = await fetch(`/api/seasons?${params}`, { signal: AbortSignal.timeout(22000) })
  if (!response.ok) throw new Error('Les détails des saisons doivent être repris. Les fiches et décisions déjà enregistrées sont conservées.')
  const result = await response.json() as { seasons: CatalogSeason[]; note: string | null }
  const available = availableSeasonNumbers(item)
  const rows = result.seasons.filter(row => available.includes(row.number)).map(row => ({ number: row.number, title: row.title?.slice(0, 300) || null, poster_url: safeUrl(row.poster_url) ?? null,
    year: row.year, source: row.source, source_id: row.source_id, source_url: safeUrl(row.source_url) ?? null }))
  if (!authorized()) throw new Error('Session interrompue')
  const saved = await supabase.rpc('complete_catalog_seasons', { p_item_id: item.id, p_rows: rows, p_expected_updated_at: item.updated_at ?? null, p_note: result.note })
  const parent = Array.isArray(saved.data) ? saved.data[0] : saved.data
  if (saved.error || !parent?.id) throw new Error(saved.error?.message ?? 'Les saisons n’ont pas été enregistrées. Relancez la complétion.')
  forgetSeasons(item.id)
  // Persist metadata first; a failed image cache never loses a found season.
  const { cachePosterUrl, isCachedPosterUrl } = await import('./metadata')
  for (let start = 0; start < rows.length && authorized(); start += 4) {
    await Promise.allSettled(rows.slice(start, start + 4).map(async row => {
      if (!row.poster_url || isCachedPosterUrl(row.poster_url)) return
      const poster = await cachePosterUrl(row.poster_url)
      if (!poster || !isCachedPosterUrl(poster) || !authorized()) return
      await supabase!.from('catalog_seasons').update({ poster_url: poster }).eq('item_id', item.id).eq('number', row.number).eq('poster_url', row.poster_url).eq('manual', false)
    }))
  }
  forgetSeasons(item.id)
  return parent as CatalogItem
}

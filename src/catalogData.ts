import type { CatalogItem } from './types'

export const CATALOG_PAGE_SIZE = 500
export const BROWSE_PAGE_SIZE = 24

export interface CatalogBrowseResult {
  items: CatalogItem[]
  total: number
  summary: { count: number; seasons: number; size: number; genres: number }
  years: number[]
  genres: Array<{ name: string; count: number }>
}

export interface CatalogBrowseFilters {
  category: CatalogItem['category']
  page: number
  query: string
  genre: string
  year: string
  origin: string
  format: string
  sort: string
  byYear: boolean
}

export function filterDemoCatalog(items: CatalogItem[], filters: CatalogBrowseFilters): CatalogBrowseResult {
  const scoped = items.filter(item => item.active && item.category === filters.category
    && (!filters.origin || item.media_type === filters.origin)
    && (!filters.format || (filters.format === 'film' ? item.media_format === 'film' : item.media_format !== 'film')))
  const counts = new Map<string, number>()
  scoped.forEach(item => item.genres.forEach(name => counts.set(name, (counts.get(name) ?? 0) + 1)))
  const genres = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'))
  const years = [...new Set(scoped.map(item => item.year).filter((year): year is number => year !== null))].sort((a, b) => b - a)
  let filtered = scoped.filter(item => (!filters.query || `${item.title} ${item.genres.join(' ')}`.toLocaleLowerCase('fr').includes(filters.query.toLocaleLowerCase('fr')))
    && (!filters.genre || item.genres.includes(filters.genre))
    && (!filters.year || (filters.year === 'inconnue' ? item.year === null : item.year === Number(filters.year))))
  const byTitle = (a: CatalogItem, b: CatalogItem) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
  if (filters.sort === 'az') filtered = filtered.sort(byTitle)
  if (filters.sort === 'za') filtered = filtered.sort((a, b) => byTitle(b, a))
  if (filters.sort === 'year-desc' || filters.byYear) filtered = filtered.sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || byTitle(a, b))
  if (filters.sort === 'year-asc') filtered = filtered.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b))
  const start = (filters.page - 1) * BROWSE_PAGE_SIZE
  return {
    items: filtered.slice(start, start + BROWSE_PAGE_SIZE), total: filtered.length,
    summary: { count: scoped.length, seasons: scoped.reduce((sum, item) => sum + (item.seasons_count ?? 0), 0), size: scoped.reduce((sum, item) => sum + (Number(item.game_size_gb) || 0), 0), genres: counts.size },
    years, genres,
  }
}

export async function fetchCatalogPages(fetchPage: (from: number, to: number, withCount: boolean) => PromiseLike<{ data: CatalogItem[] | null; count: number | null; error: { message: string } | null }>) {
  const first = await fetchPage(0, CATALOG_PAGE_SIZE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const rows = [...(first.data ?? [])]
  if (first.count === null) throw new Error('Le nombre de titres est indisponible. Réessayez.')
  // Respect the server's page limit, even if configured below our requested size.
  const size = rows.length || CATALOG_PAGE_SIZE
  for (let offset = size; offset < first.count; offset += size * 3) {
    const pages = await Promise.all(Array.from({ length: Math.min(3, Math.ceil((first.count - offset) / size)) }, (_, index) => fetchPage(offset + index * size, offset + (index + 1) * size - 1, false)))
    for (const page of pages) {
      if (page.error) throw new Error(page.error.message)
      rows.push(...(page.data ?? []))
    }
  }
  return [...new Map(rows.map(item => [item.id, item])).values()]
}

import type { CatalogItem } from './types'

export const CATALOG_PAGE_SIZE = 500
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

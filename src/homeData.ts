import { categories, type CatalogItem, type Category } from './types'

export interface HomeShelf { category: Category; count: number; latest: CatalogItem[]; featured: CatalogItem[] }
export const HOME_RELEASE_LIMIT = 16

export function currentReleaseYear(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Africa/Lagos' }).format(date))
}

export function makeHomeShelf(category: Category, count: number, candidates: CatalogItem[], featuredCandidates: CatalogItem[], year: number): HomeShelf {
  const latest = candidates.filter(item => item.active && item.category === category && item.year === year)
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .slice(0, HOME_RELEASE_LIMIT)
  const featured = [...new Map([...latest, ...featuredCandidates].filter(item => item.active && item.category === category && item.poster_url).map(item => [item.id, item])).values()].slice(0, 3)
  return { category, count, latest, featured }
}

export function demoHomeShelves(items: CatalogItem[], year: number): HomeShelf[] {
  return categories.map(({ key }) => makeHomeShelf(key, items.filter(item => item.active && item.category === key).length, items, items, year))
}

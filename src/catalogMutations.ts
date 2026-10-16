import type { CatalogItem } from './types'

export interface CatalogMutation { sequence: number; item: CatalogItem | null }

export function confirmedCatalogItem(items: CatalogItem[], item: CatalogItem, field?: 'synopsis' | 'poster_url', expected?: string) {
  if (!field) return item
  const current = items.find(row => row.id === item.id)
  return current && current[field] === expected ? { ...current, [field]: item[field] } : null
}

export function applyCatalogRows(current: CatalogItem[], rows: CatalogItem[], removedIds: string[] = []) {
  const removed = new Set(removedIds)
  return [...new Map([...current.filter(item => !removed.has(item.id)), ...rows].map(item => [item.id, item])).values()]
}

/** Une lecture commencée avant une écriture ne doit pas annuler cette écriture. */
export function reconcileCatalogRows(rows: CatalogItem[], mutations: Map<string, CatalogMutation>, since: number) {
  const recent = [...mutations].filter(([, mutation]) => mutation.sequence > since)
  return applyCatalogRows(rows, recent.flatMap(([, mutation]) => mutation.item ? [mutation.item] : []), recent.filter(([, mutation]) => !mutation.item).map(([id]) => id))
}

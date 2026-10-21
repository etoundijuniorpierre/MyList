import type { CartItem, CatalogItem, CatalogSeason } from './types'

export interface CartSelection { ids: string[]; seasons: Record<string, number[]> }
export const CART_KEY = 'mylist-cart-v2'
export function hasSeasonChoices(item: Pick<CatalogItem, 'category' | 'media_format'>) {
  return (item.category === 'series' || item.category === 'anime') && item.media_format !== 'film'
}
export function validSeasonNumbers(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 999))].sort((a, b) => a - b) : []
}
export function availableSeasonNumbers(item: CatalogItem): number[] {
  if (!hasSeasonChoices(item)) return []
  if (Array.isArray(item.available_seasons)) return validSeasonNumbers(item.available_seasons)
  const count = item.seasons_count
  return Number.isInteger(count) && count! > 0 && count! <= 999 ? Array.from({ length: count! }, (_, i) => i + 1) : []
}
export function cleanCartSelection(value: unknown): CartSelection {
  const raw = value as Partial<CartSelection> | null
  const ids = Array.isArray(raw?.ids) ? [...new Set(raw.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))] : []
  const seasons: Record<string, number[]> = {}
  const kept = ids.filter(id => {
    if (!raw?.seasons || !Object.hasOwn(raw.seasons, id)) return true
    const chosen = validSeasonNumbers(raw.seasons[id])
    if (!chosen.length) return false
    seasons[id] = chosen
    return true
  })
  return { ids: kept, seasons }
}
export function readCartSelection(storage: Pick<Storage, 'getItem'>): CartSelection {
  try {
    const saved = storage.getItem(CART_KEY)
    if (saved) return cleanCartSelection(JSON.parse(saved))
    return cleanCartSelection({ ids: JSON.parse(storage.getItem('mylist-selection') ?? '[]') })
  } catch { return { ids: [], seasons: {} } }
}
export function selectItemSeasons(cart: CartSelection, item: CatalogItem, numbers: number[] | null): CartSelection {
  const next = { ids: [...cart.ids], seasons: { ...cart.seasons } }
  delete next.seasons[item.id]
  if (numbers !== null) {
    const available = availableSeasonNumbers(item)
    const chosen = validSeasonNumbers(numbers).filter(n => available.includes(n))
    if (!chosen.length) return { ...next, ids: next.ids.filter(id => id !== item.id) }
    if (chosen.length !== available.length) next.seasons[item.id] = chosen
  }
  if (!next.ids.includes(item.id)) next.ids.push(item.id)
  return next
}
export function remapCartSelection(cart: CartSelection, removed: string, kept: string): CartSelection {
  if (removed === kept || !cart.ids.includes(removed)) return cart
  const seasons = { ...cart.seasons }
  if (seasons[removed] && (!cart.ids.includes(kept) || seasons[kept])) seasons[kept] = validSeasonNumbers([...(seasons[kept] ?? []), ...seasons[removed]])
  else delete seasons[kept]
  delete seasons[removed]
  return { ids: [...new Set(cart.ids.map(id => id === removed ? kept : id))], seasons }
}
export function restoreCartItem(current: CartSelection, before: CartSelection, id: string): CartSelection {
  const seasons = { ...current.seasons }; delete seasons[id]
  if (!before.ids.includes(id)) return { ids: current.ids.filter(entry => entry !== id), seasons }
  if (before.seasons[id]) seasons[id] = before.seasons[id]
  return { ids: current.ids.includes(id) ? current.ids : [...current.ids, id], seasons }
}
export function cartItems(items: CatalogItem[], cart: CartSelection): CartItem[] {
  const byId = new Map(items.filter(item => item.active).map(item => [item.id, item]))
  return cart.ids.flatMap(id => {
    const item = byId.get(id)
    if (!item) return []
    if (!hasSeasonChoices(item)) return [item]
    const available = availableSeasonNumbers(item)
    const requested = cart.seasons[id]
    const chosen = requested ?? available
    const invalid = requested?.some(number => !available.includes(number))
    return [{ ...item, seasons_count: invalid ? null : chosen.length || null, cart_seasons: chosen, cart_all_seasons: !requested,
      ...(invalid ? { selection_error: 'Une saison choisie n’est plus disponible. Modifiez votre choix dans la fiche.' } : {}) }]
  })
}
export function seasonSelectionLabel(item: CatalogItem) {
  const cart = item as CartItem
  const numbers = cart.cart_seasons
  if (!numbers?.length) return ''
  const ranges: string[] = []
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i]
    while (i + 1 < numbers.length && numbers[i + 1] === numbers[i] + 1) i++
    ranges.push(numbers[i] === start ? String(start) : `${start} à ${numbers[i]}`)
  }
  return `${cart.cart_all_seasons ? 'Intégrale · ' : ''}${numbers.length === 1 ? 'Saison' : 'Saisons'} ${ranges.join(', ')}`
}
export function displaySeasons(item: CatalogItem, rows: CatalogSeason[]): CatalogSeason[] {
  const byNumber = new Map(rows.map(row => [row.number, row]))
  return availableSeasonNumbers(item).map(number => byNumber.get(number) ?? {
    item_id: item.id, number, title: null, synopsis: null, poster_url: null, year: null, source: null, source_id: null, source_url: null, manual: false,
  })
}

import type { CatalogItem, GameCountDiscount, GamePriceTier, PriceRule } from './types'

export interface ItemPricing { amount: number; currency: string; detail: string }

function positiveAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const amount = Math.round(Number(value) * 100) / 100
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function validDiscount(discount: GameCountDiscount) {
  const amount = positiveAmount(discount.price_per_game)
  return Number.isInteger(discount.min_games) && discount.min_games! >= 2 && amount !== null && discount.currency
    ? { amount, currency: discount.currency, count: discount.min_games! } : null
}

export function itemPrice(item: CatalogItem, selection: CatalogItem[], rules: PriceRule[], gameTiers: GamePriceTier[], gameDiscount: GameCountDiscount): ItemPricing | null {
  if (item.category === 'games') {
    const gameCount = selection.filter((entry) => entry.category === 'games').length
    const discount = validDiscount(gameDiscount)
    if (discount && gameCount >= discount.count) {
      return { amount: discount.amount, currency: discount.currency, detail: `Tarif dès ${discount.count} jeux` }
    }
    const size = Number(item.game_size_gb)
    if (!Number.isFinite(size) || size <= 0) return null
    const billableGb = Math.ceil(size)
    const tier = gameTiers.find((entry) => billableGb >= entry.min_gb && billableGb <= entry.max_gb)
    const amount = positiveAmount(tier?.price)
    return tier?.currency && amount !== null ? { amount, currency: tier.currency, detail: `${size.toLocaleString('fr-FR')} Go` } : null
  }
  const category = item.category
  const priceCategory = category === 'anime' && item.media_format === 'film' ? 'anime-film' : category
  const rule = rules.find((entry) => entry.category === priceCategory)
  const standard = positiveAmount(rule?.standard_price)
  if (!rule?.currency || standard === null) return null
  if (priceCategory === 'anime-film') return { amount: standard, currency: rule.currency, detail: `1 film × ${standard}` }
  const seasons = Number(item.seasons_count)
  if (!Number.isInteger(seasons) || seasons < 1) return null
  const totalSeasons = selection.filter((entry) => category === 'series' || category === 'anime'
    ? entry.category === 'series' || (entry.category === 'anime' && entry.media_format !== 'film')
    : entry.category === category).reduce((sum, entry) => sum + (Number(entry.seasons_count) || 0), 0)
  const reduced = positiveAmount(rule.threshold_price)
  const unit = rule.threshold_seasons != null && rule.threshold_seasons >= 2 && totalSeasons >= rule.threshold_seasons && reduced !== null
    ? reduced : standard
  return { amount: Math.round(unit * seasons * 100) / 100, currency: rule.currency, detail: `${seasons} saison${seasons > 1 ? 's' : ''} × ${unit}` }
}

/** Un même calcul alimente le panier, la barre de total et le message WhatsApp. */
export function calculateCart(items: CatalogItem[], rules: PriceRule[], tiers: GamePriceTier[], discount: GameCountDiscount) {
  const priced = items.map(item => ({ item, pricing: itemPrice(item, items, rules, tiers, discount), standard: standardItemPrice(item, rules, tiers) }))
  const missingPrice = priced.some(entry => !entry.pricing)
  const currencies = [...new Set(priced.flatMap(entry => entry.pricing ? [entry.pricing.currency] : []))]
  const currency = currencies.length === 1 ? currencies[0] : null
  const total = items.length && !missingPrice && currency
    ? priced.reduce((sum, entry) => sum + Math.round(entry.pricing!.amount * 100), 0) / 100 : null
  const standardTotal = items.length && priced.every(entry => entry.standard !== null)
    ? priced.reduce((sum, entry) => sum + Math.round(entry.standard! * 100), 0) / 100 : null
  const savings = total !== null && standardTotal !== null ? Math.max(0, Math.round((standardTotal - total) * 100) / 100) : 0
  return { priced, missingPrice, currencies, currency, total, standardTotal, savings }
}

export function validateGameTiers(tiers: GamePriceTier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.min_gb - b.min_gb)
  for (const [index, tier] of sorted.entries()) {
    if (!Number.isInteger(tier.min_gb) || !Number.isInteger(tier.max_gb) || tier.min_gb < 1 || tier.max_gb < tier.min_gb || positiveAmount(tier.price) === null) return 'Chaque palier doit avoir des bornes entières valides et un prix strictement supérieur à zéro.'
    if (index > 0 && tier.min_gb <= sorted[index - 1].max_gb) return 'Les paliers de jeux ne doivent pas se chevaucher.'
  }
  return null
}

/** Prix sans remise de volume : sert à afficher l'économie réalisée dans le panier. */
export function standardItemPrice(item: CatalogItem, rules: PriceRule[], gameTiers: GamePriceTier[]): number | null {
  if (item.category === 'games') {
    const size = Math.ceil(Number(item.game_size_gb))
    const tier = gameTiers.find((entry) => size >= entry.min_gb && size <= entry.max_gb)
    return tier?.currency ? positiveAmount(tier.price) : null
  }
  const rule = rules.find((entry) => entry.category === (item.category === 'anime' && item.media_format === 'film' ? 'anime-film' : item.category))
  const amount = positiveAmount(rule?.standard_price)
  if (!rule?.currency || amount === null) return null
  if (item.media_format === 'film') return amount
  const seasons = Number(item.seasons_count)
  return Number.isInteger(seasons) && seasons > 0 ? Math.round(amount * seasons * 100) / 100 : null
}

export interface DiscountProgress {
  key: string
  label: string
  current: number
  target: number
  unit: string
  reached: boolean
  reward: string
}

/** Où en est le panier par rapport à chaque palier de remise configuré par l'admin. */
export function discountProgress(selection: CatalogItem[], rules: PriceRule[], gameDiscount: GameCountDiscount, format: (amount: number, currency: string) => string): DiscountProgress[] {
  const progress: DiscountProgress[] = []
  const seasonsOf = (filter: (item: CatalogItem) => boolean) => selection.filter(filter).reduce((sum, item) => sum + (Number(item.seasons_count) || 0), 0)
  const groups: { key: string; label: string; categories: PriceRule['category'][]; filter: (item: CatalogItem) => boolean }[] = [
    { key: 'series-anime', label: 'Séries et animés', categories: ['series', 'anime'], filter: (item) => item.category === 'series' || (item.category === 'anime' && item.media_format !== 'film') },
    { key: 'novelas', label: 'Novelas', categories: ['novelas'], filter: (item) => item.category === 'novelas' },
    { key: 'dramas', label: 'Dramas', categories: ['dramas'], filter: (item) => item.category === 'dramas' },
  ]
  for (const group of groups) {
    const current = seasonsOf(group.filter)
    if (!current) continue
    for (const category of group.categories) {
      const rule = rules.find((entry) => entry.category === category)
      if (!rule?.threshold_seasons || rule.threshold_price == null || !rule.currency) continue
      if (group.key === 'series-anime' && !selection.some((item) => category === 'series' ? item.category === 'series' : item.category === 'anime' && item.media_format !== 'film')) continue
      progress.push({
        key: `${group.key}:${category}`, label: group.key === 'series-anime' ? (category === 'series' ? 'Séries' : 'Animés') : group.label,
        current, target: rule.threshold_seasons, unit: 'saison', reached: current >= rule.threshold_seasons,
        reward: `${format(Number(rule.threshold_price), rule.currency)} la saison`,
      })
    }
  }
  const games = selection.filter((item) => item.category === 'games').length
  const discount = validDiscount(gameDiscount)
  if (games && discount) {
    progress.push({ key: 'games', label: 'Jeux PC', current: games, target: discount.count, unit: 'jeu', reached: games >= discount.count, reward: `${format(discount.amount, discount.currency)} le jeu` })
  }
  return progress
}

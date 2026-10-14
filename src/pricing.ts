import type { CatalogItem, GameCountDiscount, GamePriceTier, PriceRule } from './types'

export function itemPrice(item: CatalogItem, selection: CatalogItem[], rules: PriceRule[], gameTiers: GamePriceTier[], gameDiscount: GameCountDiscount): { amount: number; currency: string; detail: string } | null {
  if (item.category === 'games') {
    const gameCount = selection.filter((entry) => entry.category === 'games').length
    if (gameDiscount.min_games != null && gameDiscount.price_per_game != null && gameDiscount.currency && gameCount >= gameDiscount.min_games) {
      return { amount: Number(gameDiscount.price_per_game), currency: gameDiscount.currency, detail: `Tarif dès ${gameDiscount.min_games} jeux` }
    }
    const size = Number(item.game_size_gb)
    if (!Number.isFinite(size) || size <= 0) return null
    const billableGb = Math.ceil(size)
    const tier = gameTiers.find((entry) => billableGb >= entry.min_gb && billableGb <= entry.max_gb)
    return tier ? { amount: Number(tier.price), currency: tier.currency, detail: `${size.toLocaleString('fr-FR')} Go` } : null
  }
  const category = item.category
  const priceCategory = category === 'anime' && item.media_format === 'film' ? 'anime-film' : category
  const rule = rules.find((entry) => entry.category === priceCategory)
  if (!rule?.currency || rule.standard_price == null) return null
  if (priceCategory === 'anime-film') return { amount: Number(rule.standard_price), currency: rule.currency, detail: `1 film × ${Number(rule.standard_price)}` }
  const seasons = Number(item.seasons_count)
  if (!Number.isInteger(seasons) || seasons < 1) return null
  const totalSeasons = selection.filter((entry) => category === 'series' || category === 'anime'
    ? entry.category === 'series' || (entry.category === 'anime' && entry.media_format !== 'film')
    : entry.category === category).reduce((sum, entry) => sum + (Number(entry.seasons_count) || 0), 0)
  const unit = rule.threshold_seasons != null && totalSeasons >= rule.threshold_seasons && rule.threshold_price != null
    ? Number(rule.threshold_price) : Number(rule.standard_price)
  return { amount: unit * seasons, currency: rule.currency, detail: `${seasons} saison${seasons > 1 ? 's' : ''} × ${unit}` }
}

export function validateGameTiers(tiers: GamePriceTier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.min_gb - b.min_gb)
  for (const [index, tier] of sorted.entries()) {
    if (!Number.isInteger(tier.min_gb) || !Number.isInteger(tier.max_gb) || tier.min_gb < 1 || tier.max_gb < tier.min_gb || !Number.isFinite(tier.price) || tier.price < 0) return 'Chaque palier doit avoir des bornes entières valides et un prix positif.'
    if (index > 0 && tier.min_gb <= sorted[index - 1].max_gb) return 'Les paliers de jeux ne doivent pas se chevaucher.'
  }
  return null
}

/** Prix sans remise de volume : sert à afficher l'économie réalisée dans le panier. */
export function standardItemPrice(item: CatalogItem, rules: PriceRule[], gameTiers: GamePriceTier[]): number | null {
  if (item.category === 'games') {
    const size = Math.ceil(Number(item.game_size_gb))
    const tier = gameTiers.find((entry) => size >= entry.min_gb && size <= entry.max_gb)
    return tier ? Number(tier.price) : null
  }
  const rule = rules.find((entry) => entry.category === (item.category === 'anime' && item.media_format === 'film' ? 'anime-film' : item.category))
  if (rule?.standard_price == null) return null
  if (item.media_format === 'film') return Number(rule.standard_price)
  const seasons = Number(item.seasons_count)
  return Number.isInteger(seasons) && seasons > 0 ? Number(rule.standard_price) * seasons : null
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
  if (games && gameDiscount.min_games && gameDiscount.price_per_game != null && gameDiscount.currency) {
    progress.push({ key: 'games', label: 'Jeux PC', current: games, target: gameDiscount.min_games, unit: 'jeu', reached: games >= gameDiscount.min_games, reward: `${format(Number(gameDiscount.price_per_game), gameDiscount.currency)} le jeu` })
  }
  return progress
}

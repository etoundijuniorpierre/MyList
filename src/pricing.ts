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

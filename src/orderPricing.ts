import { validateGameTiers } from './pricing'
import type { OrderPricing } from './types'

export const orderPriceCategories = ['series', 'anime', 'anime-film', 'novelas', 'dramas'] as const
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const currency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value)

/** Validate before saving and quoting JSON read from the public settings table. */
export function orderPricingError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'La grille des commandes est invalide.'
  const config = value as OrderPricing
  if (!Array.isArray(config.prices) || config.prices.length !== orderPriceCategories.length || !Array.isArray(config.gameTiers) || !config.gameDiscount) return 'La grille doit contenir toutes les catégories.'
  for (const category of orderPriceCategories) {
    const rows = config.prices.filter(rule => rule?.category === category)
    if (rows.length !== 1) return 'Chaque catégorie doit avoir une seule règle de prix.'
    const rule = rows[0]
    if (rule.standard_price !== null && (!amount(rule.standard_price) || !currency(rule.currency))) return 'Les prix doivent être positifs et la devise doit avoir trois lettres (ex. XAF).'
    if (rule.standard_price === null && rule.currency !== null && !currency(rule.currency)) return 'La devise est invalide.'
    const threshold = rule.threshold_seasons, reduced = rule.threshold_price
    if (category === 'anime-film') {
      if (threshold !== null || reduced !== null) return 'Les films utilisent un prix fixe par film.'
    } else if (threshold !== null || reduced !== null) {
      if (!Number.isInteger(threshold) || threshold! < 2 || !amount(reduced) || !amount(rule.standard_price) || reduced! > rule.standard_price!) return 'Renseignez ensemble un seuil entier d’au moins 2 saisons et un prix réduit positif, inférieur ou égal au prix standard.'
    }
  }
  if (config.gameTiers.some(tier => !tier || !currency(tier.currency))) return 'Chaque palier de jeux doit avoir une devise valide.'
  const tierError = validateGameTiers(config.gameTiers)
  if (tierError) return tierError
  const discount = config.gameDiscount
  if (discount.min_games !== null || discount.price_per_game !== null) {
    if (!Number.isInteger(discount.min_games) || discount.min_games! < 2 || !amount(discount.price_per_game) || !currency(discount.currency)) return 'La remise jeux exige au moins 2 jeux et un prix par jeu positif.'
  } else if (discount.currency !== null && !currency(discount.currency)) return 'La devise de la remise jeux est invalide.'
  const currencies = new Set([...config.prices.filter(rule => rule.standard_price !== null).map(rule => rule.currency), ...config.gameTiers.map(tier => tier.currency), ...(discount.price_per_game !== null ? [discount.currency] : [])])
  return currencies.size > 1 ? 'Utilisez la même devise pour toute la grille des commandes.' : null
}

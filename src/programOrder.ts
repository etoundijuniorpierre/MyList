import { itemPrice } from './pricing'
import { orderPricingError } from './orderPricing'
import { categoryLabel, type CatalogItem, type PricingSettings } from './types'

export interface OrderCandidate {
  item: CatalogItem
  inCatalog: boolean
  catalogChecked?: boolean
  aliases?: string[]
}

export function catalogSearchPattern(title: string) {
  return `%${title.trim().split(/\s+/).map(word => word.replace(/[\\%_]/g, char => `\\${char}`)).join('%')}%`
}

/** A catalog failure must not be reported as an unavailable title. */
export async function catalogFirstSearch(
  local: () => Promise<OrderCandidate[]>,
  external: () => Promise<OrderCandidate[]>,
) {
  const found = await local()
  return found.length ? { candidates: found, external: false } : { candidates: await external(), external: true }
}

export function programQuote(candidate: OrderCandidate, settings: PricingSettings) {
  const custom = !candidate.inCatalog ? settings.settings.order_pricing : null
  if (custom && orderPricingError(custom)) return null
  const grid = custom ?? settings
  return itemPrice(candidate.item, [candidate.item], grid.prices, grid.gameTiers, grid.gameDiscount)
}

export function programOrderMessage(candidate: OrderCandidate, settings: PricingSettings, name: string, format: (amount: number, currency: string) => string) {
  const item = candidate.item
  const pricing = programQuote(candidate, settings)
  const quantity = item.category === 'games' ? (item.game_size_gb ? `${item.game_size_gb.toLocaleString('fr-FR')} Go` : 'Poids à confirmer')
    : item.media_format === 'film' ? '1 film d’animation'
    : item.seasons_count ? `${item.seasons_count} saison${item.seasons_count > 1 ? 's' : ''}` : 'Nombre de saisons à confirmer'
  return [
    `Bonjour${name.trim() ? `, je suis ${name.trim().replace(/[\r\n]+/g, ' ').slice(0, 80)}` : ''}. Je souhaite passer une commande Ma Liste :`, '',
    categoryLabel(item.category).toUpperCase(), `${item.title}${item.year ? ` (${item.year})` : ''}`, quantity,
    candidate.inCatalog ? 'Titre présent au catalogue.' : candidate.catalogChecked === false ? 'Présence au catalogue et disponibilité à confirmer.' : 'Demande hors catalogue : disponibilité à confirmer.',
    pricing ? `${candidate.inCatalog ? 'Prix' : 'Prix estimé, sous réserve de disponibilité'} : ${format(pricing.amount, pricing.currency)}` : 'Prix à confirmer (aucun montant validé).',
    ...(pricing ? [pricing.detail] : []),
    ...(!candidate.inCatalog && settings.settings.order_pricing ? ['Tarif commande hors catalogue.'] : []),
    ...(!candidate.inCatalog && item.source_url ? [`Référence : ${item.source_url}`] : []),
    '', 'Commande pour ce titre uniquement, hors panier. Merci de confirmer la disponibilité et le montant avant règlement.',
  ].join('\n')
}

import { kindLabel } from './display'
import { categories } from './types'
import type { calculateCart } from './pricing'

export function buildCartMessage(cart: ReturnType<typeof calculateCart>, name: string, format: (amount: number, currency: string) => string): string {
  if (!cart.priced.length || cart.total === null || !Number.isFinite(cart.total) || cart.total <= 0 || !cart.currency) {
    throw new Error('Le total du panier est incomplet. Vérifiez les tarifs avant de l’envoyer.')
  }
  const lines = categories.flatMap(category => {
    const entries = cart.priced.filter(entry => entry.item.category === category.key)
    return entries.length ? [
      `*${category.label.toUpperCase()}*`,
      ...entries.map(({ item, pricing }, index) => `${index + 1}. ${item.title}${item.media_type === 'chinese-drama' || item.media_type === 'korean-drama' || item.media_format === 'film' ? ` [${kindLabel(item)}]` : ''} (${pricing!.detail}) — ${format(pricing!.amount, pricing!.currency)}`),
      '',
    ] : []
  })
  const greeting = name.trim() ? `Bonjour, c’est ${name.trim()}. Je souhaite ce panier Ma Liste :` : 'Bonjour, je souhaite ce panier Ma Liste :'
  return `${greeting}\n\n${lines.join('\n')}\n*Total : ${format(cart.total, cart.currency)}*${cart.savings ? `\n(remises incluses : −${format(cart.savings, cart.currency)})` : ''}\n\nMerci !`
}

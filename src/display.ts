import { categoryLabel, type CatalogItem, type Category } from './types'

export interface CategoryMeta {
  route: string
  accent: string
  glow: string
  eyebrow: string
  title: [string, string]
  copy: string
  tagline: string
}

// Chaque univers garde sa propre ambiance : couleur d'accent, accroche et ton.
export const categoryMeta: Record<Category, CategoryMeta> = {
  series: { route: '/series', accent: '#ff8a65', glow: '#ff8a6533', eyebrow: 'Univers 01', title: ['Des histoires à', 'dévorer.'], copy: 'Explorez les séries disponibles, trouvez votre prochaine obsession et ajoutez-la à votre panier.', tagline: 'Saisons entières, soirées sans fin' },
  games: { route: '/jeux-pc', accent: '#56c8f5', glow: '#56c8f533', eyebrow: 'Univers 02', title: ['Votre prochain', 'univers.'], copy: 'Des jeux PC pour chaque envie d’explorer, de gagner ou simplement de s’évader.', tagline: 'Action, aventure, compétition' },
  anime: { route: '/animes', accent: '#c28bff', glow: '#c28bff33', eyebrow: 'Univers 03', title: ['L’imaginaire sans', 'limites.'], copy: 'Séries animées et films d’animation : découvrez les titres disponibles, puis composez votre panier.', tagline: 'Shōnen, seinen, films cultes' },
  novelas: { route: '/novelas', accent: '#ff6f9c', glow: '#ff6f9c33', eyebrow: 'Univers 04', title: ['Des émotions à', 'suivre.'], copy: 'Passions, secrets et rebondissements : composez votre panier saison par saison.', tagline: 'Passion, secrets, rebondissements' },
  dramas: { route: '/dramas', accent: '#3ed6b5', glow: '#3ed6b533', eyebrow: 'Univers 05', title: ['Vos dramas', 'préférés.'], copy: 'Explorez les dramas coréens et chinois, puis composez votre sélection.', tagline: 'Séoul, Shanghai et au-delà' },
}

export const routeCategory: Record<string, Category> = Object.fromEntries(Object.entries(categoryMeta).map(([key, meta]) => [meta.route, key as Category]))

export function kindLabel(item: Pick<CatalogItem, 'category' | 'media_type' | 'media_format'>) {
  if (item.media_format === 'film') return 'Film d’animation'
  if (item.media_type === 'chinese-drama') return 'Drama chinois'
  if (item.media_type === 'korean-drama') return 'Drama coréen'
  if (item.category === 'anime') return 'Animé'
  if (item.category === 'games') return 'Jeu PC'
  return categoryLabel(item.category).replace(/s$/, '')
}

export function measureLabel(item: Pick<CatalogItem, 'category' | 'media_format' | 'seasons_count' | 'seasons_total' | 'game_size_gb'>) {
  if (item.category === 'games') return item.game_size_gb ? `${Number(item.game_size_gb).toLocaleString('fr-FR')} Go` : 'Taille à venir'
  if (item.media_format === 'film') return 'Film'
  if (item.seasons_count && item.seasons_total && item.seasons_count > item.seasons_total) return `${item.seasons_count} disponibles · total à vérifier`
  if (item.seasons_total && item.seasons_total !== item.seasons_count) {
    if (!item.seasons_count) return `${item.seasons_total} saison${item.seasons_total > 1 ? 's' : ''} au total · disponibilité à confirmer`
    return `${item.seasons_count} disponible${item.seasons_count > 1 ? 's' : ''} / ${item.seasons_total} saison${item.seasons_total > 1 ? 's' : ''}`
  }
  if (!item.seasons_count) return 'Saisons à venir'
  return `${item.seasons_count} saison${item.seasons_count > 1 ? 's' : ''}`
}

// Teinte stable par titre : une affiche manquante garde toujours la même couleur.
export function titleHue(title: string) {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`
}

export function setPageMeta(title: string, robots?: 'noindex') {
  document.title = title ? `${title} · Ma Liste` : 'Ma Liste — Séries, jeux PC, animés, novelas & dramas'
  let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (robots) {
    if (!tag) { tag = document.createElement('meta'); tag.name = 'robots'; document.head.append(tag) }
    tag.content = 'noindex, nofollow'
  } else tag?.remove()
}

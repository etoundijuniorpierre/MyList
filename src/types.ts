export type Category = 'series' | 'games' | 'anime' | 'novelas' | 'dramas'
export type MediaType = 'anime' | 'chinese-drama' | 'korean-drama' | null
export type MediaFormat = 'series' | 'film' | null

export interface CatalogItem {
  id: string
  category: Category
  media_type: MediaType
  media_format?: MediaFormat
  title: string
  title_key: string
  synopsis: string | null
  poster_url: string | null
  genres: string[]
  year: number | null
  source: string
  source_id: string | null
  source_url: string | null
  active: boolean
  seasons_count: number | null
  game_size_gb: number | null
  created_at?: string
  updated_at?: string
  metadata_preferences?: import('./metadataDecisions').MetadataPreferences
  seasons_total?: number | null
  seasons_checked_at?: string | null
}

export type ItemInput = Omit<CatalogItem, 'id' | 'created_at'>

export interface PriceRule {
  category: 'series' | 'anime' | 'anime-film' | 'novelas' | 'dramas'
  standard_price: number | null
  threshold_seasons: number | null
  threshold_price: number | null
  currency: string | null
}

export interface GamePriceTier {
  id?: string
  min_gb: number
  max_gb: number
  price: number
  currency: string
}

export interface GameCountDiscount {
  min_games: number | null
  price_per_game: number | null
  currency: string | null
}

export interface SiteSettings {
  whatsapp_number: string
}

export interface PricingSettings {
  prices: PriceRule[]
  gameTiers: GamePriceTier[]
  gameDiscount: GameCountDiscount
  settings: SiteSettings
}

export interface MetadataResult extends ItemInput {
  match?: 'exact' | 'approximate'
  /** Autres titres de l'œuvre (romaji, anglais, natif) : servent au rapprochement avec un nom de dossier. */
  aliases?: string[]
}

export const categories: { key: Category; label: string; singular: string; number: string }[] = [
  { key: 'series', label: 'Séries', singular: 'Série', number: '01' },
  { key: 'games', label: 'Jeux PC', singular: 'Jeu PC', number: '02' },
  { key: 'anime', label: 'Animés', singular: 'Animé', number: '03' },
  { key: 'novelas', label: 'Novelas', singular: 'Novela', number: '04' },
  { key: 'dramas', label: 'Dramas', singular: 'Drama', number: '05' },
]

export function categoryLabel(category: Category) {
  return categories.find((entry) => entry.key === category)?.label ?? category
}

export function normalizeTitle(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function titleKey(category: Category, type: MediaType, title: string, format: MediaFormat = null) {
  return `${category}:${type ?? 'none'}:${normalizeTitle(title)}${format === 'film' ? ':film' : ''}`
}

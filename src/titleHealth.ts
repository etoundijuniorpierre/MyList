import { cleanTitle, seasonsFromSuffix } from './folderScan'
import { catalogIdentity } from './catalogImport'
import type { CatalogItem } from './types'

// Sigles et chiffres romains qui restent en capitales quand un titre crié est remis en casse normale.
const keepUpper = new Set(['FBI', 'NCIS', 'CSI', 'FIFA', 'PES', 'GTA', 'NFS', 'FC', 'EA', 'MF', 'USA', 'UK', 'NBA', 'NFL', 'WWE', 'WWII', 'DC', 'HD', 'VR', 'RPG', 'SVU', 'NY', 'NYC', 'TV', 'UFC', 'SWAT', 'S.W.A.T.', 'MIB', 'DMC', 'FF', 'XCOM', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'XIII', 'XV', 'XVI', 'MGS', 'COD', 'RDR', 'TLOU', 'GOW', 'BMX', 'F1', 'MXGP', 'WRC', 'NHL', 'MLB', 'PGA', 'GT', 'LEGO', 'DLC', 'ONU', 'BTS', 'JAG', 'MASH', 'CIA', 'NSA', 'K-POP'])
const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'vs', 'with', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'à', 'au', 'aux', 'sur', 'ses', 'son', 'sa', 'un', 'une', 'y', 'del', 'no', 'wo', 'ni'])

function isShouting(title: string) {
  const letters = title.replace(/[^\p{L}]/gu, '')
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

export function softenCase(title: string) {
  if (!isShouting(title)) return title
  return title.split(/(\s+)/).map((word, index) => {
    if (/^\s+$/.test(word) || !word) return word
    const bare = word.replace(/[^\p{L}\d.-]/gu, '')
    if (keepUpper.has(bare) || /\d/.test(bare) && bare.length <= 4) return word
    const lower = word.toLocaleLowerCase('fr-FR')
    if (index > 0 && smallWords.has(lower.replace(/[^\p{L}]/gu, ''))) return lower
    // « L'Illusionniste » prend une capitale après l'apostrophe, pas le « 's » anglais de « Darwin's ».
    return lower.replace(/(^|[-'’(])(\p{L})(?=(\p{L}?))/gu, (_, before: string, letter: string, next: string) => before + (/['’]/.test(before) && !next ? letter : letter.toLocaleUpperCase('fr-FR')))
  }).join('')
}

export interface TitleSuggestion {
  title: string
  seasons_count: number | null
  year: number | null
}

/** Propose un titre propre (sans balises de release, suffixe de saisons ni capitales criées) ou null s'il n'y a rien à corriger. */
export function suggestTitle(item: Pick<CatalogItem, 'title' | 'seasons_count' | 'year' | 'category' | 'metadata_preferences'>): TitleSuggestion | null {
  if (item.metadata_preferences?.title === item.title) return null
  const original = item.title.trim()
  const yearMatch = original.match(/\(((?:19|20)\d{2})\)/)
  const seasons = item.category === 'games' ? null : seasonsFromSuffix(original)
  const cleaned = softenCase(cleanTitle(original)).replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length < 2 || cleaned === original) return null
  const year = yearMatch ? Number(yearMatch[1]) : null
  return {
    title: cleaned,
    seasons_count: item.seasons_count ?? seasons,
    year: item.year ?? (year && year >= 1900 && year <= 2100 ? year : null),
  }
}

export type HealthIssue = 'poster' | 'synopsis' | 'genres' | 'year' | 'measure' | 'title' | 'seasons'

export const issueLabels: Record<HealthIssue, string> = {
  poster: 'Sans affiche',
  synopsis: 'Sans description',
  genres: 'Sans genre',
  year: 'Sans année',
  measure: 'Saisons ou taille manquantes',
  title: 'Titre à nettoyer',
  seasons: 'Total des saisons manquant',
}

export function itemIssues(item: CatalogItem): HealthIssue[] {
  const issues: HealthIssue[] = []
  if (!item.poster_url) issues.push('poster')
  if (!item.synopsis?.trim()) issues.push('synopsis')
  if (!item.genres.length) issues.push('genres')
  if (!item.year) issues.push('year')
  if (item.category === 'games' ? !item.game_size_gb : item.media_format !== 'film' && !item.seasons_count) issues.push('measure')
  if (suggestTitle(item)) issues.push('title')
  if (item.category !== 'games' && item.media_format !== 'film' && !item.seasons_total) issues.push('seasons')
  return issues
}

/** Regroupe les fiches qui désignent probablement le même titre une fois les balises retirées. */
export function probableDuplicates(items: CatalogItem[]): CatalogItem[][] {
  const groups = new Map<string, CatalogItem[]>()
  for (const item of items) {
    const key = catalogIdentity(item.category, item.media_type, softenCase(cleanTitle(item.title)), item.media_format)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

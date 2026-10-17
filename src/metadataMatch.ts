import { cleanTitle } from './folderScan'
import { similarity, titleScore } from './titleMatch'
import { normalizeTitle, type CatalogItem, type Category, type MediaFormat, type MetadataResult } from './types'

/** Une œuvre proposée pour compléter une fiche, après regroupement des sources qui la décrivent. */
export interface Candidate {
  key: string
  title: string
  aliases: string[]
  year: number | null
  format: MediaFormat
  category: Category
  poster_url: string | null
  synopsis: string | null
  genres: string[]
  source: string
  source_id: string | null
  source_url: string | null
  sources: string[]
  identities?: { source: string; id: string }[]
  /** Ressemblance de 0 à 1 avec le titre de la fiche, après pénalités de format et d'année. */
  score: number
  notes: string[]
}

const sourceRank: Record<string, number> = { anilist: 0, 'jikan-anime': 1, tvmaze: 0, tvdb: 1, igdb: 0, rawg: 1, kitsu: 2, steam: 2, wikipedia: 8 }

/**
 * Titres à essayer pour une fiche au nom de dossier : nettoyé, sans sous-titre français, chaque moitié
 * d'un « A - B », titre entre parenthèses, et sans les mots tronqués en fin de nom.
 */
export function titleVariants(raw: string): string[] {
  return variantsWithKind(raw).map((variant) => variant.text)
}

/** Une variante « tronquée » (dernier mot retiré) peut désigner une autre œuvre : elle ne décide jamais seule. */
export function variantsWithKind(raw: string): { text: string; truncated: boolean }[] {
  const base = (cleanTitle(raw) || raw).replace(/\s+/g, ' ').trim()
  const out: { text: string; truncated: boolean }[] = [{ text: base, truncated: false }]
  let truncating = false
  const add = (value: string | undefined) => {
    const text = value?.replace(/\s+/g, ' ').replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '').trim()
    if (text && text.length >= 3 && /\p{L}{2}/u.test(text) && !out.some((entry) => normalizeTitle(entry.text) === normalizeTitle(text))) out.push({ text, truncated: truncating })
  }
  const paren = base.match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/)
  if (paren) { add(`${paren[1]} ${paren[3]}`); add(paren[2]) }
  if (base.includes(',')) add(base.split(',')[0])
  const parts = base.split(/\s+[-–:]\s+/)
  if (parts.length > 1) for (const part of parts) if (part.split(' ').length >= 2 || part.length >= 6) add(part)
  // Mot tronqué en fin de nom (« … Remast », « … p ») : jamais un numéro d'opus (« Street Fighter 2V », « Index III »).
  const words = base.split(' ')
  const installment = (word: string) => /\d/.test(word) && !/^(?:19|20)\d{2}$/.test(word) || /^(?:[ivx]{1,4})$/i.test(word)
  truncating = true
  if (words.length >= 3 && !installment(words.at(-1)!)) add(words.slice(0, -1).join(' '))
  if (words.length >= 4 && !installment(words.at(-1)!) && /^(?:(?:19|20)\d{2}|\p{L}{1,7})$/u.test(words.at(-2)!)) add(words.slice(0, -2).join(' '))
  return out.slice(0, 5)
}

function expectedFormat(item: Pick<CatalogItem, 'media_format'>): 'series' | 'film' {
  return item.media_format === 'film' ? 'film' : 'series'
}

/** Ressemblance d'un résultat avec la fiche : le meilleur couple (variante, titre ou alias), pénalisé si format ou année divergent. */
export function scoreResult(item: Pick<CatalogItem, 'category' | 'media_format' | 'year'>, result: MetadataResult, variants: (string | { text: string; truncated: boolean })[]) {
  const titles = [result.title, ...(result.aliases ?? [])].filter(Boolean)
  let score = 0
  for (const [index, entry] of variants.entries()) {
    const variant = typeof entry === 'string' ? { text: entry, truncated: false } : entry
    // Le titre complet compte plus qu'une variante ; une variante tronquée reste sous le seuil de décision automatique.
    const weight = index === 0 ? 1 : variant.truncated ? 0.86 : 0.96
    for (const title of titles) score = Math.max(score, titleScore(title, variant.text) * weight)
  }
  if (result.match === 'exact' && score < 0.9) score = Math.max(score, 0.9)
  const notes: string[] = []
  if (item.category === 'anime' && result.media_format && result.media_format !== expectedFormat(item)) {
    score -= 0.12
    notes.push(result.media_format === 'film' ? 'Film, alors que la fiche est une série' : 'Série, alors que la fiche est un film')
  }
  if (item.year && result.year && Math.abs(item.year - result.year) > 1) {
    score -= 0.3
    notes.push(`Sortie en ${result.year}, la fiche indique ${item.year}`)
  }
  return { score: Math.max(0, Math.min(1, score)), notes }
}

function sameWork(left: Pick<Candidate, 'title' | 'aliases' | 'year' | 'format'>, right: Pick<Candidate, 'title' | 'aliases' | 'year' | 'format'>) {
  if (left.format && right.format && left.format !== right.format) return false
  if (left.year && right.year && Math.abs(left.year - right.year) > 1) return false
  const names = (entry: typeof left) => [entry.title, ...entry.aliases].map((title) => normalizeTitle(title)).filter(Boolean)
  const rightNames = names(right)
  return names(left).some((name) => rightNames.some((other) => name === other || similarity(name, other) >= 0.92))
}

/** Regroupe les résultats de toutes les sources par œuvre, garde les meilleurs champs et trie par ressemblance. */
export function buildCandidates(item: Pick<CatalogItem, 'category' | 'media_format' | 'year'>, results: MetadataResult[], variants: (string | { text: string; truncated: boolean })[]): Candidate[] {
  const groups: Candidate[] = []
  const ranked = [...results].filter((result) => result.category === item.category)
    .sort((a, b) => (sourceRank[a.source] ?? 5) - (sourceRank[b.source] ?? 5))
  for (const result of ranked) {
    const { score, notes } = scoreResult(item, result, variants)
    if (score < 0.45 || (result.source === 'wikipedia' && score < 0.9)) continue
    const entry: Candidate = {
      key: `${result.source}:${result.source_id ?? result.title}`, title: result.title, aliases: result.aliases ?? [], year: result.year,
      format: result.media_format ?? null, category: result.category, poster_url: result.poster_url, synopsis: result.synopsis,
      genres: result.genres, source: result.source, source_id: result.source_id, source_url: result.source_url, sources: [result.source], score, notes,
      identities: result.source_id ? [{ source: result.source, id: result.source_id }] : [],
    }
    const existing = groups.find((group) => sameWork(group, entry))
    if (!existing) { groups.push(entry); continue }
    existing.poster_url ??= entry.poster_url
    if ((entry.synopsis?.length ?? 0) > (existing.synopsis?.length ?? 0) && entry.source !== 'wikipedia') existing.synopsis = entry.synopsis
    if (!existing.genres.length) existing.genres = entry.genres
    existing.year ??= entry.year
    existing.format ??= entry.format
    existing.aliases = [...new Set([...existing.aliases, entry.title, ...entry.aliases])]
    if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source)
    existing.identities = [...(existing.identities ?? []), ...(entry.identities ?? [])].filter((entry, index, all) => all.findIndex(other => other.source === entry.source && other.id === entry.id) === index)
    if (entry.score > existing.score) { existing.score = entry.score; existing.notes = entry.notes }
  }
  return groups.sort((a, b) => b.score - a.score || Number(Boolean(b.poster_url)) - Number(Boolean(a.poster_url))).slice(0, 5)
}

/**
 * Décision automatique, volontairement prudente : une seule œuvre très ressemblante, sans doute sur le format
 * ni l'année. Sinon la fiche part en arbitrage et c'est l'administrateur qui tranche.
 */
export function pickCandidate(candidates: Candidate[]): Candidate | null {
  const [top, second] = candidates
  if (!top || top.score < 0.9 || top.notes.length) return null
  if (second && second.score >= top.score - 0.08) return null
  return top
}

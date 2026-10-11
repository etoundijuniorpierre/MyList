import type { Category, MediaType, MetadataResult } from './types'
import { normalizeTitle, titleKey } from './types'
import { searchQueries } from './titleAliases'
import { supabase } from './supabase'

type TvShow = { show: { id: number; name: string; summary: string | null; premiered: string | null; genres: string[]; image: { medium: string; original: string } | null; url: string } }
type AnimeSearch = { data: { mal_id: number; title: string; title_english?: string | null; title_synonyms?: string[]; synopsis: string | null; year?: number | null; aired?: { from: string | null }; genres: { name: string }[]; images?: { jpg?: { large_image_url?: string; image_url?: string } }; url: string }[] }
type GameSearch = { results: { id: number; name: string; released: string | null; background_image: string | null; genres: { name: string }[]; slug: string; source?: 'rawg' | 'igdb'; source_url?: string }[] }
type WikiPage = { pageid: number; title: string; index?: number; pageimage?: string; thumbnail?: { source: string }; terms?: { description?: string[] } }
type WikiSearch = { query?: { pages?: WikiPage[] } }

const cachedSearches = new Map<string, Promise<MetadataResult[]>>()
let rawgUnavailableUntil = 0

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(response.status === 429 ? 'Le service de fiches répond trop vite. Réessayez dans quelques instants.' : `Recherche indisponible (${response.status}).`)
  return response.json() as Promise<T>
}

function exactTitle(title: string, query: string) {
  const normalized = normalizeTitle(title.replace(/\s*\([^)]*\)$/, ''))
  return searchQueries(query).some((candidate) => normalized === normalizeTitle(candidate))
}

function plainText(html: string | null): string | null {
  if (!html) return null
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || null
}

function wikiCategory(description: string): Category | null {
  if (/telenovela|soap opera|novela televisiva|novela télévisée/i.test(description)) return 'novelas'
  if (/\banime\b|Japanese animated series|animation japonaise/i.test(description)) return 'anime'
  if (/video game|computer game|videogame|jeu vidéo|videojuego/i.test(description)) return 'games'
  if (/television series|TV series|série télévisée|serie de televisión|television show/i.test(description)) return 'series'
  return null
}

function wikiGenres(description: string, category: Category): string[] {
  const labels: [RegExp, string][] = [
    [/action[- ]adventure|action-aventure/i, 'Action-aventure'], [/role[- ]playing|jeu de rôle|RPG/i, 'RPG'],
    [/platform|plates-formes/i, 'Plateforme'], [/racing|course automobile/i, 'Course'],
    [/strategy|stratégie/i, 'Stratégie'], [/horror|horreur/i, 'Horreur'],
    [/drama|drame/i, 'Drame'], [/romance|romantique/i, 'Romance'], [/comedy|comédie/i, 'Comédie'],
  ]
  const genres = labels.filter(([pattern]) => pattern.test(description)).map(([, label]) => label)
  return genres.length ? genres : category === 'novelas' ? ['Telenovela'] : []
}

async function wikipedia(query: string, wanted: Category | null): Promise<MetadataResult[]> {
  const languages = wanted === 'novelas' ? ['es', 'en', 'fr'] : ['en', 'fr', 'es']
  const searches = languages.map(async (language): Promise<MetadataResult[]> => {
    const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
    const params = { action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: '8', prop: 'pageimages|pageterms', piprop: 'thumbnail|name', pithumbsize: '600', pilicense: 'free', wbptterms: 'description', format: 'json', formatversion: '2', origin: '*' }
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    try {
      const response = await getJson<WikiSearch>(url.href)
      const found: MetadataResult[] = []
      for (const page of [...(response.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
        const description = page.terms?.description?.[0] ?? ''
        const category = wikiCategory(description)
        if (!category || (wanted && category !== wanted)) continue
        const image = page.thumbnail?.source?.startsWith('https://upload.wikimedia.org/wikipedia/commons/') ? page.thumbnail.source : null
        const title = page.title.replace(/\s*\([^)]*\)$/, '')
        const article = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
        const imageCredit = image && page.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage.replace(/^File:/, '').replace(/ /g, '_'))}` : null
        found.push({ category, media_type: category === 'anime' ? 'anime' : null, title,
          title_key: titleKey(category, category === 'anime' ? 'anime' : null, title),
          synopsis: description || null, poster_url: image, genres: wikiGenres(description, category),
          year: Number(description.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/)?.[1]) || null,
          source: 'wikipedia', source_id: `${language}:${page.pageid}`, source_url: imageCredit ?? article,
          active: true, seasons_count: null, game_size_gb: null,
          match: exactTitle(page.title, query) ? 'exact' : 'approximate',
        })
      }
      return found
    } catch { return [] }
  })
  return (await Promise.all(searches)).flat()
}

async function tvmaze(query: string, category: 'series' | 'novelas'): Promise<MetadataResult[]> {
  const queries = searchQueries(query)
  for (const [index, candidate] of queries.entries()) {
    const response = await getJson<TvShow[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(candidate)}`)
    const matches: MetadataResult[] = response.slice(0, 8).map(({ show }) => ({
      category, media_type: null, title: show.name, title_key: titleKey(category, null, show.name),
      synopsis: plainText(show.summary), poster_url: show.image?.original ?? show.image?.medium ?? null,
      genres: show.genres ?? [], year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
      source: 'tvmaze', source_id: String(show.id), source_url: show.url,
      active: true, seasons_count: null, game_size_gb: null,
      match: exactTitle(show.name, query) ? 'exact' : 'approximate',
    }))
    if (matches.some((item) => item.match === 'exact') || index === queries.length - 1) return matches
  }
  return []
}

async function jikan(query: string): Promise<MetadataResult[]> {
  const queries = searchQueries(query)
  for (const [index, candidate] of queries.entries()) {
    const response = await getJson<AnimeSearch>(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(candidate)}&limit=8&sfw=true`)
    const matches: MetadataResult[] = response.data.map((anime) => ({
      category: 'anime', media_type: 'anime', title: anime.title, title_key: titleKey('anime', 'anime', anime.title),
      synopsis: anime.synopsis?.replace(/\s+\[Written by MAL Rewrite\]$/, '') ?? null,
      poster_url: anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? null,
      genres: anime.genres?.map((genre) => genre.name) ?? [],
      year: anime.year ?? (anime.aired?.from ? Number(anime.aired.from.slice(0, 4)) : null),
      source: 'jikan-anime', source_id: String(anime.mal_id), source_url: anime.url,
      active: true, seasons_count: null, game_size_gb: null,
      match: [anime.title, anime.title_english, ...(anime.title_synonyms ?? [])].some((title) => title && exactTitle(title, query)) ? 'exact' : 'approximate',
    }))
    if (matches.some((item) => item.match === 'exact') || index === queries.length - 1) return matches
  }
  return []
}

async function rawg(query: string): Promise<MetadataResult[]> {
  if (!supabase || Date.now() < rawgUnavailableUntil) return []
  try {
    const { data, error } = await supabase.functions.invoke<GameSearch>('game-search', { body: { query: searchQueries(query)[0] }, signal: AbortSignal.timeout(12_000) })
    if (error || !data) throw error ?? new Error('Recherche indisponible')
    return data.results.map((game) => ({
      category: 'games', media_type: null, title: game.name, title_key: titleKey('games', null, game.name),
      synopsis: null, poster_url: game.background_image, genres: game.genres?.map((genre) => genre.name) ?? [],
      year: game.released ? Number(game.released.slice(0, 4)) : null,
      source: game.source ?? 'rawg', source_id: String(game.id), source_url: game.source_url ?? `https://rawg.io/games/${game.slug}`,
      active: true, seasons_count: null, game_size_gb: null,
      match: exactTitle(game.name, query) ? 'exact' : 'approximate',
    }))
  } catch { rawgUnavailableUntil = Date.now() + 5 * 60_000; return [] }
}

async function lookup(query: string, category: Category): Promise<MetadataResult[]> {
  if (query.trim().length < 2) return []
  let main: MetadataResult[] = []
  try {
    if (category === 'series' || category === 'novelas') main = await tvmaze(query, category)
    else if (category === 'anime') main = await jikan(query)
    else main = await rawg(query)
  } catch { /* La source gratuite de repli reste disponible. */ }
  if (main.some((entry) => entry.match === 'exact' && entry.poster_url && entry.genres.length)) return main
  const wiki = await wikipedia(searchQueries(query)[0], category)
  const seen = new Set(main.map((entry) => entry.title_key))
  return [...main, ...wiki.filter((entry) => !seen.has(entry.title_key))]
    .sort((a, b) => Number(b.match === 'exact') - Number(a.match === 'exact'))
}

export function searchMetadata(query: string, category: Category, _mediaType: MediaType = null): Promise<MetadataResult[]> {
  const key = `${category}:${normalizeTitle(query)}`
  const hit = cachedSearches.get(key)
  if (hit) return hit
  const pending = lookup(query, category).catch((error) => { cachedSearches.delete(key); throw error })
  if (cachedSearches.size > 300) cachedSearches.clear()
  cachedSearches.set(key, pending)
  return pending
}

export async function identifyMetadata(query: string, guessedCategory: Category): Promise<MetadataResult | null> {
  const wiki = await wikipedia(searchQueries(query)[0], null)
  const detected = wiki.find((entry) => entry.match === 'exact' && entry.category !== guessedCategory)
  if (!detected) return null
  const specific = await searchMetadata(query, detected.category)
  return specific.find((entry) => entry.match === 'exact') ?? detected
}

export function isCachedPosterUrl(url: string | null): boolean {
  return Boolean(url && import.meta.env.VITE_SUPABASE_URL && url.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`))
}

export async function cachePosterUrl(url: string | null): Promise<string | null> {
  if (!url || !supabase || isCachedPosterUrl(url)) return url
  let hostname: string
  try { hostname = new URL(url).hostname } catch { return url }
  if (!['static.tvmaze.com', 'cdn.myanimelist.net', 'media.rawg.io', 'images.igdb.com', 'upload.wikimedia.org'].includes(hostname)) return url
  try {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('cache-poster', { body: { url }, signal: AbortSignal.timeout(20_000) })
    return !error && data?.url?.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`) ? data.url : url
  } catch { return url }
}

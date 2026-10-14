import type { CatalogItem, Category, MediaFormat, MediaType, MetadataResult } from './types'
import { normalizeTitle, titleKey } from './types'
import { searchQueries } from './titleAliases'
import { isExactTitle } from './titleMatch'
import { cleanTitle } from './folderScan'
import { supabase } from './supabase'
import { mergeMetadataResults } from './metadataMerge'

type TvShow = { show: { id: number; name: string; summary: string | null; premiered: string | null; genres: string[]; image: { medium: string; original: string } | null; url: string } }
type AnimeSearch = { data: { mal_id: number; title: string; title_english?: string | null; title_synonyms?: string[]; type?: string | null; synopsis: string | null; year?: number | null; aired?: { from: string | null }; genres: { name: string }[]; images?: { jpg?: { large_image_url?: string; image_url?: string } }; url: string }[] }
type AniListSearch = { results: { id: string; title: string; aliases: string[]; format: string | null; synopsis: string | null; year: number | null; poster_url: string | null; genres: string[] }[] }
type KitsuSearch = { results: { id: string; title: string; aliases: string[]; format: string | null; synopsis: string | null; year: number | null; poster_url: string | null }[] }
type GameSearch = { results: { id: number; name: string; released: string | null; background_image: string | null; genres: { name: string }[]; slug: string; source?: 'rawg' | 'igdb'; source_url?: string }[] }
type TvdbSearch = { results: { id: string; name: string; aliases: string[]; overview: string | null; released: string | null; poster_url: string | null; genres: string[] }[] }
type WikiPage = { pageid: number; title: string; index?: number; pageimage?: string; thumbnail?: { source: string }; terms?: { description?: string[] } }
type WikiSearch = { query?: { pages?: WikiPage[] } }

const cachedSearches = new Map<string, Promise<MetadataResult[]>>()
let rawgUnavailableUntil = 0
let tvdbUnavailableUntil = 0
let jikanUnavailableUntil = 0
let jikanQueue: Promise<void> = Promise.resolve()
let nextJikanRequestAt = 0
let aniListQueue: Promise<void> = Promise.resolve()
let nextAniListRequestAt = 0

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(response.status === 429 ? 'Le service de fiches répond trop vite. Réessayez dans quelques instants.' : `Recherche indisponible (${response.status}).`)
  return response.json() as Promise<T>
}

async function getJikanJson<T>(url: string): Promise<T> {
  let release!: () => void
  const previous = jikanQueue
  jikanQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, nextJikanRequestAt - Date.now())
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      nextJikanRequestAt = Date.now() + 500
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 1000 * (attempt + 1)))
        continue
      }
      if (!response.ok) throw new Error(response.status === 429 ? 'MyAnimeList limite temporairement la recherche.' : `MyAnimeList indisponible (${response.status}).`)
      return response.json() as Promise<T>
    }
    throw new Error('MyAnimeList reste temporairement indisponible.')
  } finally {
    release()
  }
}

async function getAniListJson<T>(url: string): Promise<T> {
  let release!: () => void
  const previous = aniListQueue
  aniListQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    const wait = Math.max(0, nextAniListRequestAt - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    nextAniListRequestAt = Date.now() + 700
    return await getJson<T>(url)
  } finally { release() }
}

function animeFormat(value: string | null | undefined): MediaFormat {
  if (!value) return null
  return /^(?:movie)$/i.test(value) ? 'film' : /^(?:tv|tv_short|ova|ona|special)$/i.test(value) ? 'series' : null
}

function hasAnimePoster(results: MetadataResult[], format: MediaFormat, year: number | null = null): boolean {
  return results.some((result) => result.match === 'exact' && result.poster_url &&
    (format === 'film' ? result.media_format === 'film' : result.media_format === 'series') &&
    (!year || Boolean(result.year && Math.abs(year - result.year) <= 1)))
}

async function kitsu(query: string): Promise<MetadataResult[]> {
  const response = await getJson<KitsuSearch>(`/api/kitsu-search?q=${encodeURIComponent(searchQueries(query)[0])}`)
  return response.results.map((anime) => ({
    category: 'anime', media_type: 'anime', media_format: animeFormat(anime.format), title: anime.title,
    title_key: titleKey('anime', 'anime', anime.title, animeFormat(anime.format)),
    synopsis: plainText(anime.synopsis), poster_url: anime.poster_url, genres: [], year: anime.year,
    source: 'kitsu', source_id: anime.id, source_url: `https://kitsu.io/anime/${anime.id}`,
    active: true, seasons_count: null, game_size_gb: null,
    match: anime.aliases.some((title) => isExactTitle(title, query)) ? 'exact' : 'approximate',
  }))
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
          match: isExactTitle(page.title, query) ? 'exact' : 'approximate',
        })
      }
      return found
    } catch { return [] }
  })
  return (await Promise.all(searches)).flat()
}

async function tvmaze(query: string, category: 'series' | 'novelas' | 'dramas'): Promise<MetadataResult[]> {
  const queries = searchQueries(query)
  for (const [index, candidate] of queries.entries()) {
    const response = await getJson<TvShow[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(candidate)}`)
    const matches: MetadataResult[] = response.slice(0, 8).map(({ show }) => ({
      category, media_type: null, title: show.name, title_key: titleKey(category, null, show.name),
      synopsis: plainText(show.summary), poster_url: show.image?.original ?? show.image?.medium ?? null,
      genres: show.genres ?? [], year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
      source: 'tvmaze', source_id: String(show.id), source_url: show.url,
      active: true, seasons_count: null, game_size_gb: null,
      match: isExactTitle(show.name, query) ? 'exact' : 'approximate',
    }))
    if (matches.some((item) => item.match === 'exact') || index === queries.length - 1) return matches
  }
  return []
}

async function jikan(query: string): Promise<MetadataResult[]> {
  if (Date.now() < jikanUnavailableUntil) throw new Error('MyAnimeList reste temporairement indisponible.')
  const queries = searchQueries(query)
  for (const [index, candidate] of queries.entries()) {
    const response = await getJikanJson<AnimeSearch>(`/api/anime-search?q=${encodeURIComponent(candidate)}`)
    const matches: MetadataResult[] = response.data.map((anime) => ({
      category: 'anime', media_type: 'anime', title: anime.title, title_key: titleKey('anime', 'anime', anime.title, animeFormat(anime.type)),
      media_format: animeFormat(anime.type),
      synopsis: anime.synopsis?.replace(/\s+\[Written by MAL Rewrite\]$/, '') ?? null,
      poster_url: anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? null,
      genres: anime.genres?.map((genre) => genre.name) ?? [],
      year: anime.year ?? (anime.aired?.from ? Number(anime.aired.from.slice(0, 4)) : null),
      source: 'jikan-anime', source_id: String(anime.mal_id), source_url: anime.url,
      active: true, seasons_count: null, game_size_gb: null,
      match: [anime.title, anime.title_english, ...(anime.title_synonyms ?? [])].some((title) => title && isExactTitle(title, query)) ? 'exact' : 'approximate',
    }))
    if (matches.some((item) => item.match === 'exact') || index === queries.length - 1) return matches
  }
  return []
}

async function anilist(query: string): Promise<MetadataResult[]> {
  const response = await getAniListJson<AniListSearch>(`/api/anilist-search?q=${encodeURIComponent(searchQueries(query)[0])}`)
  return response.results.map((anime) => ({
    category: 'anime', media_type: 'anime', media_format: animeFormat(anime.format), title: anime.title, title_key: titleKey('anime', 'anime', anime.title, animeFormat(anime.format)),
    synopsis: plainText(anime.synopsis), poster_url: anime.poster_url, genres: anime.genres ?? [], year: anime.year,
    source: 'anilist', source_id: anime.id, source_url: `https://anilist.co/anime/${anime.id}`,
    active: true, seasons_count: null, game_size_gb: null,
    match: anime.aliases.some((title) => isExactTitle(title, query)) ? 'exact' : 'approximate',
  }))
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
      match: isExactTitle(game.name, query) ? 'exact' : 'approximate',
    }))
  } catch { rawgUnavailableUntil = Date.now() + 5 * 60_000; return [] }
}

async function tvdb(query: string, category: 'series' | 'novelas' | 'dramas' | 'anime'): Promise<MetadataResult[]> {
  if (!supabase || Date.now() < tvdbUnavailableUntil) return []
  try {
    const { data, error } = await supabase.functions.invoke<TvdbSearch>('tvdb-search', { body: { query: searchQueries(query)[0] }, signal: AbortSignal.timeout(12_000) })
    if (error || !data) throw error ?? new Error('Recherche indisponible')
    return data.results.map((show) => ({
      category, media_type: category === 'anime' ? 'anime' : null, media_format: category === 'anime' ? 'series' : null, title: show.name, title_key: titleKey(category, category === 'anime' ? 'anime' : null, show.name),
      synopsis: show.overview, poster_url: show.poster_url, genres: show.genres ?? [],
      year: show.released ? Number(show.released.slice(0, 4)) : null,
      source: 'tvdb', source_id: show.id, source_url: `https://www.thetvdb.com/dereferrer/series/${show.id}`,
      active: true, seasons_count: null, game_size_gb: null,
      // Le nom du dossier (doublage FR) est comparé au titre et à ses alias multilingues.
      match: [show.name, ...show.aliases].some((title) => title && isExactTitle(title, query)) ? 'exact' : 'approximate',
    }))
  } catch { tvdbUnavailableUntil = Date.now() + 5 * 60_000; return [] }
}

async function lookup(query: string, category: Category, format: MediaFormat = null, year: number | null = null): Promise<MetadataResult[]> {
  if (query.trim().length < 2) return []
  let main: MetadataResult[] = []
  try {
    if (category === 'series' || category === 'novelas' || category === 'dramas') {
      main = await tvmaze(query, category)
      // TVMaze (sans clé) d'abord ; TheTVDB complète surtout les novelas au nom de doublage.
      if (!main.some((entry) => entry.match === 'exact' && entry.poster_url && entry.genres.length)) {
        const seen = new Set(main.map((entry) => entry.title_key))
        main = [...main, ...(await tvdb(query, category)).filter((entry) => !seen.has(entry.title_key))]
      }
    } else if (category === 'anime') {
      let publicSourceResponded = false
      // Compare multiple public catalogs. A result counts as usable only when
      // its title, year and series/film format pass the same safety checks as
      // the final association; one wrong exact-title hit must not stop fallback.
      try { main = await anilist(query); publicSourceResponded = true } catch { /* Jikan reste disponible. */ }
      if (!hasAnimePoster(main, format, year)) {
        try { main = mergeMetadataResults(main, await jikan(query)); publicSourceResponded = true }
        catch { jikanUnavailableUntil = Date.now() + 5 * 60_000 }
      }
      if (!hasAnimePoster(main, format, year)) {
        try { main = mergeMetadataResults(main, await kitsu(query)); publicSourceResponded = true }
        catch { /* Kitsu complète les catalogues publics sans clé. */ }
      }
      if (!hasAnimePoster(main, format, year) && format !== 'film') main = mergeMetadataResults(main, await tvdb(query, 'anime'))
      if (!publicSourceResponded && !hasAnimePoster(main, format, year)) throw new Error('Les sources d’affiches anime sont temporairement indisponibles. Reprenez la recherche plus tard.')
    }
    else main = await rawg(query)
  } catch (error) {
    if (category === 'anime') throw error
    /* La source gratuite de repli reste disponible. */
  }
  if (category === 'anime' ? hasAnimePoster(main, format, year) : main.some((entry) => entry.match === 'exact' && entry.poster_url && entry.genres.length)) return main
  if (category === 'anime' && format === 'film') return main
  const wiki = await wikipedia(searchQueries(query)[0], category)
  const seen = new Set(main.map((entry) => entry.title_key))
  return [...main, ...wiki.filter((entry) => !seen.has(entry.title_key))]
    .sort((a, b) => Number(b.match === 'exact') - Number(a.match === 'exact'))
}

export function searchMetadata(query: string, category: Category, _mediaType: MediaType = null, format: MediaFormat = null, year: number | null = null): Promise<MetadataResult[]> {
  // Les fiches déjà en base gardent le nom du dossier d'origine : on le nettoie avant d'interroger les sources.
  const search = cleanTitle(query) || query.trim()
  const key = `${category}:${format ?? 'series'}:${year ?? 'any'}:${normalizeTitle(search)}`
  const hit = cachedSearches.get(key)
  if (hit) return hit
  const pending = lookup(search, category, format, year)
    .then((results) => {
      const usablePoster = category === 'anime' ? hasAnimePoster(results, format, year)
        : results.some((item) => item.match === 'exact' && item.poster_url)
      if (!usablePoster) cachedSearches.delete(key)
      return results
    })
    .catch((error) => { cachedSearches.delete(key); throw error })
  if (cachedSearches.size > 300) cachedSearches.clear()
  cachedSearches.set(key, pending)
  return pending
}

export async function identifyMetadata(query: string, guessedCategory: Category): Promise<MetadataResult | null> {
  const search = cleanTitle(query) || query.trim()
  const wiki = await wikipedia(searchQueries(search)[0], null)
  const detected = wiki.find((entry) => entry.match === 'exact' && entry.category !== guessedCategory)
  if (!detected) return null
  const specific = await searchMetadata(search, detected.category)
  return specific.find((entry) => entry.match === 'exact') ?? detected
}

const posterHosts = [
  'static.tvmaze.com', 'cdn.myanimelist.net', 'media.rawg.io', 'images.igdb.com', 'upload.wikimedia.org',
  'cdn.akamai.steamstatic.com', 'shared.akamai.steamstatic.com', 'artworks.thetvdb.com',
  's1.anilist.co', 's2.anilist.co', 's3.anilist.co', 's4.anilist.co', 'media.kitsu.app',
]

export function isCachedPosterUrl(url: string | null): boolean {
  return Boolean(url && import.meta.env.VITE_SUPABASE_URL && url.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`))
}

export async function cachePosterUrl(url: string | null): Promise<string | null> {
  if (!url || !supabase || isCachedPosterUrl(url)) return url
  let hostname: string
  try { hostname = new URL(url).hostname } catch { return url }
  if (!posterHosts.includes(hostname)) return url
  try {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('cache-poster', { body: { url }, signal: AbortSignal.timeout(20_000) })
    return !error && data?.url?.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`) ? data.url : url
  } catch { return url }
}

type WikiExtract = { query?: { pages?: { pageid: number; title: string; index?: number; extract?: string; description?: string }[] } }

const wikiHints: Record<Category, string> = { series: 'série télévisée', novelas: 'telenovela', dramas: 'série télévisée', anime: 'anime', games: 'jeu vidéo' }

/** Résumé d'introduction de Wikipédia en français : une description déjà dans la langue du site. */
export async function frenchWikiSummary(query: string, category: Category): Promise<{ synopsis: string; source_url: string } | null> {
  const url = new URL('https://fr.wikipedia.org/w/api.php')
  const params = { action: 'query', generator: 'search', gsrsearch: `${query} ${wikiHints[category]}`, gsrnamespace: '0', gsrlimit: '5', prop: 'extracts|description', exintro: '1', explaintext: '1', exsentences: '5', exlimit: '5', format: 'json', formatversion: '2', origin: '*' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  try {
    const response = await getJson<WikiExtract>(url.href)
    const pages = [...(response.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const page of pages) {
      const extract = page.extract?.replace(/\s+/g, ' ').trim() ?? ''
      if (extract.length < 60 || !isExactTitle(page.title.replace(/\s*\([^)]*\)$/, ''), query)) continue
      // Une page d'homonymie liste plusieurs œuvres : elle ne décrit pas celle du catalogue.
      if (/\b(?:peut désigner|peut faire référence|notamment porté par|est un titre porté par|homonymie)\b/i.test(extract.slice(0, 200)) || /homonymie/i.test(page.description ?? '')) continue
      const detected = wikiCategory(`${page.description ?? ''} ${extract.slice(0, 320)}`)
      const accepted = detected === category || (detected === 'series' && (category === 'dramas' || category === 'novelas')) || (detected === 'anime' && category === 'anime')
      if (!accepted) continue
      const cut = extract.length > 900 ? `${extract.slice(0, 900).replace(/\s+\S*$/, '')}…` : extract
      return { synopsis: cut, source_url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` }
    }
  } catch { /* Wikipédia reste un complément facultatif. */ }
  return null
}

export interface Completion {
  poster_url?: string
  synopsis?: string
  synopsisInFrench?: boolean
  genres?: string[]
  year?: number
  source?: string
  source_id?: string | null
  source_url?: string | null
  sources: string[]
}

const completionRank: Record<string, number> = { anilist: 0, 'jikan-anime': 1, kitsu: 2, tvmaze: 0, tvdb: 1, igdb: 0, rawg: 1, steam: 2, wikipedia: 8 }

function compatibleResult(item: Pick<CatalogItem, 'category' | 'media_format' | 'year'>, result: MetadataResult) {
  if (result.match !== 'exact' || result.category !== item.category) return false
  if (item.category === 'anime' && result.media_format && result.media_format !== (item.media_format === 'film' ? 'film' : 'series')) return false
  if (item.year && result.year && Math.abs(item.year - result.year) > 1) return false
  return true
}

/**
 * Cherche dans toutes les sources disponibles les informations qui manquent à une fiche.
 * Seules les correspondances exactes et cohérentes (format, année) sont retenues, et rien n'est renvoyé
 * si plusieurs œuvres homonymes d'années différentes restent possibles.
 */
export async function completeMetadata(item: CatalogItem): Promise<Completion | null> {
  const need = { poster: !item.poster_url, synopsis: !item.synopsis?.trim(), genres: !item.genres.length, year: !item.year }
  if (!Object.values(need).some(Boolean)) return null
  const query = cleanTitle(item.title) || item.title.trim()
  let results: MetadataResult[] = []
  try { results = await searchMetadata(item.title, item.category, item.media_type, item.media_format, item.year) } catch { /* Les sources complémentaires restent interrogées. */ }
  const present = new Set(results.map((result) => result.source))
  if (need.synopsis || need.genres || need.poster) {
    const extra: Promise<MetadataResult[]>[] = []
    if (item.category === 'anime') {
      if (!present.has('anilist')) extra.push(anilist(query))
      if (!present.has('jikan-anime') && Date.now() >= jikanUnavailableUntil) extra.push(jikan(query))
      if (!present.has('kitsu')) extra.push(kitsu(query))
    } else if (item.category !== 'games') {
      if (!present.has('tvmaze')) extra.push(tvmaze(query, item.category))
      if (!present.has('tvdb')) extra.push(tvdb(query, item.category))
    }
    for (const outcome of await Promise.allSettled(extra)) if (outcome.status === 'fulfilled') results = mergeMetadataResults(results, outcome.value)
  }
  let compatible = results.filter((result) => compatibleResult(item, result))
  if (!item.year) {
    // Deux œuvres homonymes d'années éloignées : on ne choisit pas au hasard.
    const years = [...new Set(compatible.map((result) => result.year).filter((year): year is number => Boolean(year)))].sort()
    if (years.length > 1 && years.at(-1)! - years[0] > 1) {
      const literal = compatible.filter((result) => normalizeTitle(result.title) === normalizeTitle(query))
      const literalYears = new Set(literal.map((result) => result.year).filter(Boolean))
      if (literalYears.size !== 1) return null
      compatible = literal
    }
  }
  compatible.sort((a, b) => (completionRank[a.source] ?? 5) - (completionRank[b.source] ?? 5))
  const completion: Completion = { sources: [] }
  const use = (result: MetadataResult) => { if (!completion.sources.includes(result.source)) completion.sources.push(result.source) }
  if (need.poster) {
    const poster = compatible.find((result) => result.poster_url && result.poster_url.startsWith('https://'))
    if (poster) { completion.poster_url = poster.poster_url!; use(poster) }
  }
  if (need.genres) {
    const genres = compatible.find((result) => result.genres.length && result.source !== 'wikipedia')
    if (genres) { completion.genres = genres.genres.slice(0, 6); use(genres) }
  }
  if (need.year) {
    const counts = new Map<number, number>()
    for (const result of compatible) if (result.year) counts.set(result.year, (counts.get(result.year) ?? 0) + 1)
    const year = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (year) completion.year = year
  }
  if (need.synopsis) {
    const french = await frenchWikiSummary(query, item.category)
    if (french) { completion.synopsis = french.synopsis; completion.synopsisInFrench = true; completion.sources.push('wikipedia-fr') }
    else {
      const described = compatible.find((result) => (result.synopsis?.length ?? 0) >= 40 && result.source !== 'wikipedia')
      if (described) { completion.synopsis = described.synopsis!; completion.synopsisInFrench = false; use(described) }
    }
  }
  const best = compatible[0]
  if (best && ['scan', 'manual'].includes(item.source)) {
    completion.source = best.source
    completion.source_id = best.source_id
    completion.source_url = best.source_url
  }
  return completion.sources.length || completion.year ? completion : null
}

const cache = new Map()
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const properties = { anilist: 'P8729', 'jikan-anime': 'P4086', tvdb: 'P4835' }

async function json(url, fetcher) {
  const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'MyList/1.0 (catalog season metadata)' }, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Source indisponible (${response.status})`)
  return response.json()
}

export function releasedSeasonCount(seasons, today = new Date().toISOString().slice(0, 10)) {
  const numbers = new Set(seasons.filter(season => Number.isInteger(season.number) && season.number > 0 && season.premiereDate && season.premiereDate <= today).map(season => season.number))
  return numbers.size && numbers.size <= 999 ? numbers.size : null
}

async function tvmazeCount({ source, id, titles, year, category }, fetcher) {
  let showId = source === 'tvmaze' ? id : null
  if (!showId) {
    for (const title of titles.slice(0, 2)) {
      const results = await json(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`, fetcher)
      const matches = results.map(entry => entry.show).filter(show => titles.some(alias => normalize(alias) === normalize(show.name))
        && (!year || Number(show.premiered?.slice(0, 4)) === year)
        && (category !== 'anime' || show.type === 'Animation'))
      const ids = [...new Set(matches.map(show => show.id))]
      if (ids.length === 1) { showId = String(ids[0]); break }
      if (ids.length > 1) return null
    }
  }
  if (!showId) return null
  const count = releasedSeasonCount(await json(`https://api.tvmaze.com/shows/${showId}/seasons`, fetcher))
  return count ? { count, source: 'tvmaze', source_url: `https://www.tvmaze.com/shows/${showId}` } : null
}

async function wikidataCount({ source, id }, fetcher) {
  const property = properties[source]
  if (!property || !id) return null
  // Identifiant de l'œuvre confirmé, jamais une recherche libre sur un nom homonyme.
  const query = `SELECT DISTINCT ?work ?count WHERE { ?work wdt:${property} "${id}"; wdt:P2437 ?count. FILTER(?count > 0 && ?count < 1000) } LIMIT 3`
  const payload = await json(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, fetcher)
  const bindings = payload.results?.bindings ?? []
  const counts = [...new Set(bindings.map(entry => Number(entry.count?.value)).filter(Number.isInteger))]
  return counts.length === 1 ? { count: counts[0], source: 'wikidata', source_url: bindings[0].work.value } : null
}

export async function resolveSeasonCount(input, fetcher = fetch) {
  const results = await Promise.allSettled([tvmazeCount(input, fetcher), wikidataCount(input, fetcher)])
  const found = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  if (new Set(found.map(result => result.count)).size > 1) return { count: null, reason: 'Les sources ne comptent pas les saisons de la même façon.' }
  if (found.length) return found[0]
  if (results[0].status === 'rejected' && results[1].status === 'rejected') throw new Error('Les sources de saisons sont indisponibles.')
  if (results[0].status === 'rejected' && !properties[input.source]) throw new Error('La source de saisons est indisponible.')
  return { count: null, reason: 'Aucun total suffisamment sûr. Aucune valeur inventée.' }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'Méthode non autorisée.' }) }
  const params = new URL(request.url, 'https://site.invalid').searchParams
  const source = params.get('source') ?? ''
  const id = params.get('id') ?? ''
  const titles = [...new Set([params.get('title'), ...params.getAll('alias')].filter(Boolean))].slice(0, 3)
  const year = params.get('year') ? Number(params.get('year')) : null
  const category = params.get('category')
  if (!['tvmaze', 'tvdb', 'anilist', 'jikan-anime', 'kitsu', 'wikipedia'].includes(source) || !titles.length || titles.some(title => title.length < 2 || title.length > 160)
    || (id && !/^\d{1,12}$/.test(id)) || (year !== null && (!Number.isInteger(year) || year < 1850 || year > 2200))
    || !['anime', 'series', 'novelas', 'dramas'].includes(category)) return response.status(400).json({ error: 'Fiche de saison invalide.' })
  const input = { source, id, titles, year, category }
  const key = JSON.stringify(input)
  try {
    const hit = cache.get(key)
    let result = hit?.expires > Date.now() ? hit.value : null
    if (!result) {
      result = await resolveSeasonCount(input)
      if (cache.size >= 200) cache.delete(cache.keys().next().value)
      cache.set(key, { value: result, expires: Date.now() + (result.count ? 86400_000 : 900_000) })
    }
    response.setHeader('Cache-Control', `public, max-age=300, s-maxage=${result.count ? 21600 : 900}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json(result)
  } catch { return response.status(503).json({ error: 'La recherche de saisons est temporairement indisponible.' }) }
}

// Public metadata only. No privileged key, catalog write or user-supplied URL.
const animeQuery = `query ($search: String!) { Page(page: 1, perPage: 6) { media(search: $search, type: ANIME, isAdult: false) { id format title { english romaji native } startDate { year } coverImage { large } } } }`

async function json(url, options, fetcher) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(4000) })
  if (!response.ok) throw new Error('Source indisponible')
  return response.json()
}

export async function searchPrograms(title, category, fetcher = fetch) {
  if (category === 'games') {
    const data = await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=french&cc=FR`, {}, fetcher)
    return (data.items ?? []).slice(0, 6).map(item => ({ id: String(item.id), title: item.name, source: 'steam', source_url: `https://store.steampowered.com/app/${item.id}/`, poster_url: item.tiny_image ?? null, year: null, format: null }))
  }
  if (category === 'anime') {
    try {
      const data = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: animeQuery, variables: { search: title } }) }, fetcher)
      if (!data.data?.Page?.media) throw new Error('Réponse invalide')
      return data.data.Page.media.map(item => ({ id: String(item.id), title: item.title.english || item.title.romaji || item.title.native,
        aliases: [item.title.english, item.title.romaji, item.title.native].filter(Boolean), source: 'anilist', source_url: `https://anilist.co/anime/${item.id}`,
        poster_url: item.coverImage?.large ?? null, year: item.startDate?.year ?? null, format: item.format === 'MOVIE' ? 'film' : 'series' }))
    } catch {
      const data = await json(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=6&sfw=true`, {}, fetcher)
      return (data.data ?? []).map(item => ({ id: String(item.mal_id), title: item.title, aliases: [item.title, item.title_english, item.title_japanese].filter(Boolean),
        source: 'jikan-anime', source_url: item.url, poster_url: item.images?.jpg?.image_url ?? null,
        year: item.year ?? item.aired?.prop?.from?.year ?? null, format: item.type === 'Movie' ? 'film' : 'series' }))
    }
  }
  const data = await json(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`, {}, fetcher)
  return data.map(entry => entry.show).filter(show => category !== 'dramas' || ['Korean', 'Chinese', 'Mandarin'].includes(show.language)).slice(0, 6)
    .map(show => ({ id: String(show.id), title: show.name, source: 'tvmaze', source_url: show.url, poster_url: show.image?.medium ?? null,
      year: Number(show.premiered?.slice(0, 4)) || null, format: 'series', media_type: category === 'dramas' ? show.language === 'Korean' ? 'korean-drama' : 'chinese-drama' : null }))
}

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'Méthode non autorisée.' }) }
  const params = new URL(request.url, 'https://site.invalid').searchParams
  const title = params.get('q')?.trim() ?? ''
  const category = params.get('category')
  if (title.length < 2 || title.length > 160 || !['series', 'anime', 'games', 'novelas', 'dramas'].includes(category)) return response.status(400).json({ error: 'Titre ou catégorie invalide.' })
  try {
    const results = await searchPrograms(title, category)
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json({ results })
  } catch {
    return response.status(503).json({ error: 'La recherche externe est indisponible. Vous pouvez envoyer votre demande sans estimation.' })
  }
}

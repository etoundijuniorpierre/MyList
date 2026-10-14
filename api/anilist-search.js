const endpoint = 'https://graphql.anilist.co'
const query = `query ($search: String!) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME, isAdult: false) {
      id
      format
      title { english romaji native }
      synonyms
      description(asHtml: false)
      startDate { year }
      coverImage { extraLarge large }
      genres
    }
  }
}`

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Méthode non autorisée.' })
  }
  const title = new URL(request.url, 'https://site.invalid').searchParams.get('q')?.trim() ?? ''
  if (title.length < 2 || title.length > 160) return response.status(400).json({ error: 'Titre invalide.' })

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { search: title } }),
      signal: AbortSignal.timeout(8_000),
    })
    if (upstream.status === 429) {
      response.setHeader('Retry-After', upstream.headers.get('retry-after') ?? '2')
      return response.status(503).json({ error: 'AniList limite temporairement la recherche.' })
    }
    if (!upstream.ok) return response.status(502).json({ error: 'La source alternative anime est indisponible.' })
    const payload = await upstream.json()
    const results = (payload?.data?.Page?.media ?? []).map((item) => ({
      id: String(item.id),
      title: item.title?.english || item.title?.romaji || item.title?.native || '',
      aliases: [...new Set([item.title?.english, item.title?.romaji, item.title?.native, ...(item.synonyms ?? [])].filter(Boolean))],
      synopsis: item.description ?? null,
      year: item.startDate?.year ?? null,
      format: item.format ?? null,
      poster_url: item.coverImage?.extraLarge || item.coverImage?.large || null,
      genres: item.genres ?? [],
    })).filter((item) => item.id && item.title)
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json({ results })
  } catch {
    return response.status(502).json({ error: 'La recherche AniList a expiré.' })
  }
}

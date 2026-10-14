const apiOrigin = 'https://kitsu.io/api/edge/anime'

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Méthode non autorisée.' })
  }

  const query = new URL(request.url, 'https://site.invalid').searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 160) return response.status(400).json({ error: 'Titre invalide.' })

  try {
    const upstreamUrl = new URL(apiOrigin)
    upstreamUrl.searchParams.set('filter[text]', query)
    upstreamUrl.searchParams.set('page[limit]', '10')
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: 'application/vnd.api+json, application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (upstream.status === 429) {
      response.setHeader('Retry-After', upstream.headers.get('retry-after') ?? '2')
      return response.status(503).json({ error: 'Kitsu limite temporairement la recherche.' })
    }
    if (!upstream.ok) return response.status(502).json({ error: 'La source anime complémentaire est indisponible.' })

    const payload = await upstream.json()
    const results = (payload?.data ?? []).map((entry) => {
      const attributes = entry.attributes ?? {}
      const titles = attributes.titles ?? {}
      const aliases = [...new Set([attributes.canonicalTitle, titles.en, titles.en_jp, titles.ja_jp, ...(attributes.abbreviatedTitles ?? [])].filter((value) => typeof value === 'string' && value.trim()))]
      const subtype = String(attributes.subtype ?? '').toLowerCase()
      return {
        id: String(entry.id),
        title: titles.en || titles.en_jp || attributes.canonicalTitle || aliases[0] || '',
        aliases,
        format: subtype === 'movie' ? 'MOVIE' : ['tv', 'ova', 'ona', 'special'].includes(subtype) ? 'TV' : null,
        synopsis: attributes.synopsis ?? null,
        year: Number(String(attributes.startDate ?? '').slice(0, 4)) || null,
        poster_url: attributes.posterImage?.large || attributes.posterImage?.original || attributes.posterImage?.medium || null,
      }
    }).filter((entry) => entry.id && entry.title && entry.poster_url)

    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json({ results })
  } catch {
    return response.status(502).json({ error: 'La recherche Kitsu a expiré.' })
  }
}

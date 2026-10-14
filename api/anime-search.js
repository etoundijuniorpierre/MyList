const apiOrigin = 'https://api.jikan.moe/v4/anime'

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Méthode non autorisée.' })
  }

  const query = new URL(request.url, 'https://site.invalid').searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 160) return response.status(400).json({ error: 'Titre invalide.' })

  try {
    const upstreamUrl = new URL(apiOrigin)
    upstreamUrl.searchParams.set('q', query)
    upstreamUrl.searchParams.set('limit', '8')
    upstreamUrl.searchParams.set('sfw', 'true')
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (upstream.status === 429) {
      response.setHeader('Retry-After', upstream.headers.get('retry-after') ?? '2')
      return response.status(503).json({ error: 'La source anime est temporairement limitée.' })
    }
    if (!upstream.ok) return response.status(502).json({ error: 'La source anime est temporairement indisponible.' })

    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json(await upstream.json())
  } catch {
    return response.status(502).json({ error: 'La recherche anime a expiré.' })
  }
}

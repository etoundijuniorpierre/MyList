import { searchNautiljon } from '../lib/nautiljon.mjs'
export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'Méthode non autorisée.' }) }
  const query = new URL(request.url, 'https://site.invalid').searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 160) return response.status(400).json({ error: 'Titre invalide.' })
  try {
    const results = await searchNautiljon(query)
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json({ results })
  } catch { return response.status(503).json({ error: 'Nautiljon ne répond pas à la recherche publique. Les autres sources restent disponibles.' }) }
}

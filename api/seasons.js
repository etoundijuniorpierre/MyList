import { resolveSeasonDetails } from '../lib/seasonSources.mjs'
export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'Méthode non autorisée.' }) }
  const params = new URL(request.url, 'https://site.invalid').searchParams
  const source = params.get('source') ?? '', id = params.get('id') ?? '', category = params.get('category')
  const titles = [...new Set([params.get('title'), ...params.getAll('alias')].filter(Boolean))].slice(0, 3)
  const year = params.get('year') ? Number(params.get('year')) : null
  const expected = params.get('expected') === null ? null : Number(params.get('expected'))
  if (!['series', 'anime'].includes(category) || !['tvmaze', 'tvdb', 'anilist', 'jikan-anime', 'kitsu', 'wikipedia'].includes(source)
    || (id && !/^\d{1,12}$/.test(id)) || !titles.length || titles.some(title => title.length < 2 || title.length > 160)
    || (year !== null && (!Number.isInteger(year) || year < 1850 || year > 2200))
    || (expected !== null && (!Number.isInteger(expected) || expected < 1 || expected > 999))) return response.status(400).json({ error: 'Référence de saisons invalide.' })
  try {
    const result = await resolveSeasonDetails({ source, id, category, titles, year, expected })
    response.setHeader('Cache-Control', `public, max-age=300, s-maxage=${result.seasons.length ? 21600 : 900}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json(result)
  } catch { return response.status(503).json({ error: 'Les sources des saisons sont momentanément indisponibles.' }) }
}

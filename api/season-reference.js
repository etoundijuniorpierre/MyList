import { readReference } from '../lib/seasonReference.mjs'
export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'Méthode non autorisée.' }) }
  const url = new URL(request.url, 'https://site.invalid').searchParams.get('url') ?? ''
  if (!url || url.length > 600) return response.status(400).json({ error: 'Lien invalide.' })
  try {
    const result = await readReference(url)
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).json(result)
  } catch (error) { return response.status(422).json({ error: error instanceof Error ? error.message : 'Lecture de la source impossible.' }) }
}

import sharp from 'sharp'

const projectRef = process.env.SUPABASE_PROJECT_REF || 'glmseokfaljqcjibrhci'
const maxInputBytes = 4 * 1024 * 1024
const allowedWidths = new Set([384, 640])

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).end()
  }

  const parameters = new URL(request.url, 'https://site.invalid').searchParams
  const path = parameters.get('path') ?? ''
  const width = Number(parameters.get('w'))
  if (!allowedWidths.has(width) || !/^[a-f\d]{2}\/[a-f\d]{64}$/i.test(path)) {
    return response.status(400).json({ error: 'Affiche invalide.' })
  }

  const source = `https://${projectRef}.supabase.co/storage/v1/object/public/posters/${path}`
  try {
    const upstream = await fetch(source, { signal: AbortSignal.timeout(7500), redirect: 'error' })
    if (!upstream.ok || !upstream.body) return response.status(404).end()
    const size = Number(upstream.headers.get('content-length') ?? 0)
    if (size > maxInputBytes) return response.status(413).end()
    const input = Buffer.from(await upstream.arrayBuffer())
    if (!input.length || input.byteLength > maxInputBytes) return response.status(413).end()

    const image = sharp(input, { limitInputPixels: 12_000_000, failOn: 'error' })
    const details = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(details.format)) return response.status(415).end()
    const avif = String(request.headers.accept ?? '').includes('image/avif')
    const optimized = await image.rotate().resize({ width, height: 900, fit: 'inside', withoutEnlargement: true })
      .toFormat(avif ? 'avif' : 'webp', avif ? { quality: 58, effort: 3 } : { quality: 74, effort: 4 })
      .toBuffer()

    response.setHeader('Content-Type', avif ? 'image/avif' : 'image/webp')
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400')
    response.setHeader('Vary', 'Accept')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).send(optimized)
  } catch {
    return response.status(502).json({ error: 'Compression d’affiche temporairement indisponible.' })
  }
}

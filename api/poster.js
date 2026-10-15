import sharp from 'sharp'

const projectRef = process.env.SUPABASE_PROJECT_REF || 'glmseokfaljqcjibrhci'
const maxInputBytes = 4 * 1024 * 1024
const allowedWidths = new Set([240, 384, 640])
const variants = new Map()
const preparing = new Map()
const maxCacheBytes = 8 * 1024 * 1024
let cachedBytes = 0

function saveVariant(key, variant) {
  while (variants.size && cachedBytes + variant.body.byteLength > maxCacheBytes) {
    const oldest = variants.keys().next().value
    cachedBytes -= variants.get(oldest).body.byteLength
    variants.delete(oldest)
  }
  if (variant.body.byteLength <= maxCacheBytes) {
    variants.set(key, { ...variant, expiresAt: Date.now() + 3600_000 })
    cachedBytes += variant.body.byteLength
  }
}

async function prepareVariant(path, width, avif) {
  const source = `https://${projectRef}.supabase.co/storage/v1/object/public/posters/${path}`
  const upstream = await fetch(source, { signal: AbortSignal.timeout(7500), redirect: 'error' })
  if (!upstream.ok || !upstream.body) return { status: 404 }
  const size = Number(upstream.headers.get('content-length') ?? 0)
  if (size > maxInputBytes) return { status: 413 }
  const input = Buffer.from(await upstream.arrayBuffer())
  if (!input.length || input.byteLength > maxInputBytes) return { status: 413 }

  const image = sharp(input, { limitInputPixels: 12_000_000, failOn: 'error' })
  const details = await image.metadata()
  if (!['jpeg', 'png', 'webp'].includes(details.format)) return { status: 415 }
  const body = await image.rotate().resize({ width, height: 900, fit: 'inside', withoutEnlargement: true })
    .toFormat(avif ? 'avif' : 'webp', avif ? { quality: 58, effort: 3 } : { quality: 74, effort: 4 })
    .toBuffer()
  return { status: 200, body, type: avif ? 'image/avif' : 'image/webp' }
}

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

  try {
    const avif = String(request.headers.accept ?? '').includes('image/avif')
    const key = `${path}:${width}:${avif ? 'avif' : 'webp'}`
    let variant = variants.get(key)
    if (variant && variant.expiresAt <= Date.now()) {
      cachedBytes -= variant.body.byteLength
      variants.delete(key)
      variant = undefined
    }
    if (!variant) {
      let task = preparing.get(key)
      if (!task) {
        task = prepareVariant(path, width, avif).then(result => {
          if (result.status === 200) saveVariant(key, result)
          return result
        }).finally(() => preparing.delete(key))
        preparing.set(key, task)
      }
      variant = await task
    }
    if (variant.status !== 200) return response.status(variant.status).end()

    response.setHeader('Content-Type', variant.type)
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400')
    response.setHeader('Vary', 'Accept')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).send(variant.body)
  } catch {
    return response.status(502).json({ error: 'Compression d’affiche temporairement indisponible.' })
  }
}

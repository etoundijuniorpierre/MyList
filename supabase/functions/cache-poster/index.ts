import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

const allowedHosts = new Set([
  'static.tvmaze.com',
  'cdn.myanimelist.net',
  'media.rawg.io',
  'images.igdb.com',
  'upload.wikimedia.org',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'artworks.thetvdb.com',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  's4.anilist.co',
])
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxBytes = 5 * 1024 * 1024

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'POST' || !originAllowed(request)) return json(request, { error: 'Requête refusée.' }, 403)

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const serverKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!projectUrl || !serverKey) return json(request, { error: 'Service indisponible.' }, 503)
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(request, { error: 'Connexion requise.' }, 401)

  const service = createClient(projectUrl, serverKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: userData, error: userError } = await service.auth.getUser(token)
  if (userError || !userData.user) return json(request, { error: 'Connexion requise.' }, 401)
  const { data: admin } = await service.from('app_admins').select('user_id').eq('user_id', userData.user.id).maybeSingle()
  if (!admin) return json(request, { error: 'Accès refusé.' }, 403)

  let source: URL
  try {
    const body = await request.json()
    if (typeof body.url !== 'string' || body.url.length > 2048) throw new Error('URL invalide')
    source = new URL(body.url)
  } catch { return json(request, { error: 'Adresse d’image invalide.' }, 400) }
  if (source.protocol !== 'https:' || !allowedHosts.has(source.hostname) || source.username || source.password || (source.port && source.port !== '443')) {
    return json(request, { error: 'Source d’image non prise en charge.' }, 400)
  }

  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.href)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const path = `${hash.slice(0, 2)}/${hash}`
  const bucket = service.storage.from('posters')
  const downloadUrl = source.hostname === 'static.tvmaze.com'
    ? new URL(source.href.replace('/uploads/images/original_untouched/', '/uploads/images/medium_portrait/'))
    : source

  try {
    const response = await fetch(downloadUrl, {
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok || !response.body) return json(request, { error: 'Affiche indisponible.' }, 502)
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (!allowedTypes.has(contentType)) return json(request, { error: 'Format d’image non pris en charge.' }, 415)
    const announcedLength = Number(response.headers.get('content-length') ?? '0')
    if (announcedLength > maxBytes) return json(request, { error: 'Affiche trop volumineuse.' }, 413)

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return json(request, { error: 'Affiche trop volumineuse.' }, 413) }
      chunks.push(value)
    }
    if (!size) return json(request, { error: 'Affiche vide.' }, 502)

    const { error } = await bucket.upload(path, new Blob(chunks, { type: contentType }), {
      contentType,
      cacheControl: '31536000',
      upsert: true,
    })
    if (error) {
      console.error('poster_upload_failed', error.name, error.message)
      return json(request, { error: 'Enregistrement de l’affiche impossible.' }, 502)
    }
    return json(request, { url: bucket.getPublicUrl(path).data.publicUrl, cached: true })
  } catch {
    return json(request, { error: 'Récupération de l’affiche impossible.' }, 502)
  }
})

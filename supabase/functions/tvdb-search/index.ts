import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

// TheTVDB v4 : clé gratuite pour un compte personnel. Le jeton de session vaut environ un mois.
let session: { token: string; expiresAt: number } | null = null

async function login(apiKey: string, pin: string | undefined): Promise<string> {
  if (session && session.expiresAt > Date.now() + 60_000) return session.token
  const response = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pin ? { apikey: apiKey, pin } : { apikey: apiKey }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Authentification TheTVDB indisponible')
  const payload = await response.json() as { data?: { token?: string } }
  const token = payload.data?.token
  if (!token) throw new Error('Jeton TheTVDB manquant')
  session = { token, expiresAt: Date.now() + 25 * 24 * 60 * 60 * 1000 }
  return token
}

type TvdbItem = {
  objectID?: string
  tvdb_id?: string
  name?: string
  overview?: string
  overviews?: Record<string, string>
  translations?: Record<string, string>
  aliases?: string[]
  image_url?: string
  year?: string
  genres?: string[]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'POST' || !originAllowed(request)) return json(request, { error: 'Requête refusée.' }, 403)
  const url = Deno.env.get('SUPABASE_URL')
  const serverKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serverKey) return json(request, { error: 'Service indisponible.' }, 503)
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(request, { error: 'Connexion requise.' }, 401)
  const service = createClient(url, serverKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: userData, error: userError } = await service.auth.getUser(token)
  if (userError || !userData.user) return json(request, { error: 'Connexion requise.' }, 401)
  const { data: admin } = await service.from('app_admins').select('user_id').eq('user_id', userData.user.id).maybeSingle()
  if (!admin) return json(request, { error: 'Accès refusé.' }, 403)

  const apiKey = Deno.env.get('TVDB_API_KEY')
  const pin = Deno.env.get('TVDB_PIN')
  if (!apiKey) return json(request, { error: 'Recherche indisponible.' }, 503)

  let query: string
  try { query = String((await request.json()).query ?? '').trim() }
  catch { return json(request, { error: 'Requête invalide.' }, 400) }
  if (query.length < 2 || query.length > 120) return json(request, { error: 'Recherche invalide.' }, 400)

  try {
    const sessionToken = await login(apiKey, pin)
    const target = new URL('https://api4.thetvdb.com/v4/search')
    target.searchParams.set('query', query)
    target.searchParams.set('type', 'series')
    target.searchParams.set('limit', '8')
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 401) { session = null; return json(request, { error: 'Recherche indisponible.' }, 502) }
    if (!response.ok) return json(request, { error: 'Recherche indisponible.' }, 502)
    const payload = await response.json() as { data?: TvdbItem[] }
    const results = (payload.data ?? []).map((item) => {
      // Le nom alternatif français ou espagnol sert à reconnaître une fiche indexée sous son titre original.
      const aliases = [...new Set([...(item.aliases ?? []), ...Object.values(item.translations ?? {})].filter(Boolean))]
      const image = item.image_url && /^https:\/\/artworks\.thetvdb\.com\//.test(item.image_url) ? item.image_url : null
      return {
        id: (item.tvdb_id ?? item.objectID ?? '').replace(/^series-/, ''),
        name: item.name ?? '',
        aliases,
        overview: item.overviews?.fra ?? item.overviews?.spa ?? item.overviews?.eng ?? item.overview ?? null,
        released: item.year ? `${item.year}-01-01` : null,
        poster_url: image,
        genres: item.genres ?? [],
      }
    }).filter((entry) => entry.id && entry.name)
    return json(request, { results })
  } catch { return json(request, { error: 'Recherche indisponible.' }, 502) }
})

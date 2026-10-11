import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

let igdbToken: { value: string; expiresAt: number } | null = null

async function searchIgdb(query: string, clientId: string, clientSecret: string) {
  if (!igdbToken || igdbToken.expiresAt < Date.now() + 60_000) {
    const authUrl = new URL('https://id.twitch.tv/oauth2/token')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('client_secret', clientSecret)
    authUrl.searchParams.set('grant_type', 'client_credentials')
    const auth = await fetch(authUrl, { method: 'POST', signal: AbortSignal.timeout(10_000) })
    if (!auth.ok) throw new Error('Authentification IGDB indisponible')
    const token = await auth.json() as { access_token: string; expires_in: number }
    igdbToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }
  }
  const safeQuery = query.replace(/["\\;\r\n]/g, ' ').trim()
  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${igdbToken.value}`, 'Content-Type': 'text/plain' },
    body: `search "${safeQuery}"; fields name,first_release_date,cover.image_id,genres.name,slug,url; where platforms = (6); limit 8;`,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Recherche IGDB indisponible')
  const games = await response.json() as { id: number; name: string; first_release_date?: number; cover?: { image_id?: string }; genres?: { name: string }[]; slug: string; url?: string }[]
  return games.map((game) => ({
    id: game.id, name: game.name,
    released: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10) : null,
    background_image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
    genres: game.genres ?? [], slug: game.slug, source: 'igdb',
    source_url: game.url ?? `https://www.igdb.com/games/${game.slug}`,
  }))
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
  const rawgKey = Deno.env.get('RAWG_API_KEY')
  const igdbClientId = Deno.env.get('IGDB_CLIENT_ID')
  const igdbClientSecret = Deno.env.get('IGDB_CLIENT_SECRET')
  if (!rawgKey && !(igdbClientId && igdbClientSecret)) return json(request, { error: 'Recherche indisponible.' }, 503)
  let query: string
  try { query = String((await request.json()).query ?? '').trim() }
  catch { return json(request, { error: 'Requête invalide.' }, 400) }
  if (query.length < 2 || query.length > 120) return json(request, { error: 'Recherche invalide.' }, 400)
  try {
    if (igdbClientId && igdbClientSecret) {
      try { return json(request, { results: await searchIgdb(query, igdbClientId, igdbClientSecret) }) }
      catch { if (!rawgKey) return json(request, { error: 'Recherche indisponible.' }, 502) }
    }
    const target = new URL('https://api.rawg.io/api/games')
    target.searchParams.set('key', rawgKey!)
    target.searchParams.set('search', query)
    target.searchParams.set('platforms', '4')
    target.searchParams.set('page_size', '8')
    const response = await fetch(target, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return json(request, { error: 'Recherche indisponible.' }, 502)
    const data = await response.json()
    return json(request, { results: (data.results ?? []).map((game: Record<string, unknown>) => ({ ...game, source: 'rawg', source_url: `https://rawg.io/games/${game.slug}` })) })
  } catch { return json(request, { error: 'Recherche indisponible.' }, 502) }
})

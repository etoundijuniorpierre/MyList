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

type SteamDetails = { released: string | null; genres: { name: string }[] }

async function steamDetails(appId: number): Promise<SteamDetails | null> {
  try {
    const url = new URL('https://store.steampowered.com/api/appdetails')
    url.searchParams.set('appids', String(appId))
    url.searchParams.set('l', 'french')
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    const payload = await response.json() as Record<string, { success?: boolean; data?: { genres?: { description: string }[]; release_date?: { date?: string }; header_image?: string } }>
    const data = payload[String(appId)]
    if (!data?.success || !data.data) return null
    const year = data.data.release_date?.date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
    return {
      released: year ? `${year}-01-01` : null,
      genres: (data.data.genres ?? []).map((genre) => ({ name: genre.description })),
    }
  } catch { return null }
}

async function coverExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(6_000) })
    return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/')
  } catch { return false }
}

// Repli sans clé : la recherche publique du magasin Steam et son visuel portrait 600x900.
async function searchSteam(query: string) {
  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', query)
  url.searchParams.set('l', 'french')
  url.searchParams.set('cc', 'FR')
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Recherche Steam indisponible')
  const payload = await response.json() as { items?: { id: number; name: string; type?: string }[] }
  const games = (payload.items ?? [])
    .filter((item) => item.type === 'app' && !/\b(?:demo|soundtrack|artbook|bundle|dlc|pack)\b/i.test(item.name))
    .slice(0, 6)
  return await Promise.all(games.map(async (item, index) => {
    const cover = `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`
    // Les détails sont limités en débit côté Steam : seuls les premiers résultats y passent.
    const [hasCover, details] = await Promise.all([coverExists(cover), index < 4 ? steamDetails(item.id) : Promise.resolve(null)])
    return {
      id: item.id,
      name: item.name,
      released: details?.released ?? null,
      // Never substitute Steam's wide header: cards need a commercial portrait cover.
      background_image: hasCover ? cover : null,
      genres: details?.genres ?? [],
      slug: String(item.id),
      source: 'steam',
      source_url: `https://store.steampowered.com/app/${item.id}/`,
    }
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
  let query: string
  try { query = String((await request.json()).query ?? '').trim() }
  catch { return json(request, { error: 'Requête invalide.' }, 400) }
  if (query.length < 2 || query.length > 120) return json(request, { error: 'Recherche invalide.' }, 400)

  // Les sources sont essayées de la plus riche à la plus accessible ; Steam ne demande aucune clé.
  if (igdbClientId && igdbClientSecret) {
    try {
      const results = await searchIgdb(query, igdbClientId, igdbClientSecret)
      if (results.some((game) => game.background_image)) return json(request, { results })
    } catch { /* La source suivante prend le relais. */ }
  }
  // Steam provides a free vertical store capsule. Prefer it before sources whose
  // default images are promotional screenshots with a landscape crop.
  try {
    const results = await searchSteam(query)
    if (results.some((game) => game.background_image)) return json(request, { results })
  } catch { /* RAWG can still supply release and genre data below. */ }
  if (rawgKey) {
    try {
      const target = new URL('https://api.rawg.io/api/games')
      target.searchParams.set('key', rawgKey)
      target.searchParams.set('search', query)
      target.searchParams.set('platforms', '4')
      target.searchParams.set('page_size', '8')
      const response = await fetch(target, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (response.ok) {
        const data = await response.json()
        const results = (data.results ?? []).map((game: Record<string, unknown>) => ({ ...game, background_image: null, source: 'rawg', source_url: `https://rawg.io/games/${game.slug}` }))
        if (results.length) return json(request, { results })
      }
    } catch { /* La source suivante prend le relais. */ }
  }
  try { return json(request, { results: await searchSteam(query) }) }
  catch { return json(request, { error: 'Recherche indisponible.' }, 502) }
})

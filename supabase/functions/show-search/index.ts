import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

type TmdbShow = {
  id: number
  name: string
  original_name?: string
  overview?: string
  first_air_date?: string
  poster_path?: string | null
  genre_ids?: number[]
}

let genreNames: { value: Map<number, string>; fetchedAt: number } | null = null

function tmdbRequest(path: string, params: Record<string, string>, apiKey: string | undefined, accessToken: string | undefined) {
  const url = new URL(`https://api.themoviedb.org/3${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (!accessToken && apiKey) url.searchParams.set('api_key', apiKey)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
}

async function loadGenres(apiKey: string | undefined, accessToken: string | undefined): Promise<Map<number, string>> {
  if (genreNames && Date.now() - genreNames.fetchedAt < 86_400_000) return genreNames.value
  try {
    const response = await tmdbRequest('/genre/tv/list', { language: 'fr-FR' }, apiKey, accessToken)
    if (!response.ok) return genreNames?.value ?? new Map()
    const payload = await response.json() as { genres?: { id: number; name: string }[] }
    const value = new Map((payload.genres ?? []).map((genre) => [genre.id, genre.name]))
    genreNames = { value, fetchedAt: Date.now() }
    return value
  } catch { return genreNames?.value ?? new Map() }
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

  const apiKey = Deno.env.get('TMDB_API_KEY')
  const accessToken = Deno.env.get('TMDB_ACCESS_TOKEN')
  if (!apiKey && !accessToken) return json(request, { error: 'Recherche indisponible.' }, 503)

  let query: string
  let language: string
  try {
    const body = await request.json()
    query = String(body.query ?? '').trim()
    // Les novelas se cherchent mieux dans leur langue d'origine ou en espagnol.
    language = body.category === 'novelas' ? 'es-ES' : 'fr-FR'
  } catch { return json(request, { error: 'Requête invalide.' }, 400) }
  if (query.length < 2 || query.length > 120) return json(request, { error: 'Recherche invalide.' }, 400)

  try {
    const response = await tmdbRequest('/search/tv', { query, language, include_adult: 'false' }, apiKey, accessToken)
    if (!response.ok) return json(request, { error: 'Recherche indisponible.' }, 502)
    const payload = await response.json() as { results?: TmdbShow[] }
    const genres = await loadGenres(apiKey, accessToken)
    const results = (payload.results ?? []).slice(0, 8).map((show) => ({
      id: show.id,
      name: show.name || show.original_name || '',
      original_name: show.original_name ?? null,
      overview: show.overview?.trim() || null,
      released: show.first_air_date || null,
      poster_url: show.poster_path ? `https://image.tmdb.org/t/p/w780${show.poster_path}` : null,
      genres: (show.genre_ids ?? []).map((id) => genres.get(id)).filter((name): name is string => Boolean(name)),
      source_url: `https://www.themoviedb.org/tv/${show.id}`,
    }))
    return json(request, { results })
  } catch { return json(request, { error: 'Recherche indisponible.' }, 502) }
})

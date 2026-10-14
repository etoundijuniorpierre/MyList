import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

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

  let text: string
  try { text = String((await request.json()).text ?? '').trim() }
  catch { return json(request, { error: 'Texte invalide.' }, 400) }
  if (!text) return json(request, { text: '' })
  if (text.length > 5000) return json(request, { error: 'Description trop longue.' }, 413)

  try {
    const target = new URL('https://translate.googleapis.com/translate_a/single')
    for (const [key, value] of Object.entries({ client: 'gtx', sl: 'auto', tl: 'fr', dt: 't', q: text })) target.searchParams.set(key, value)
    const response = await fetch(target, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return json(request, { error: 'Traduction temporairement indisponible.' }, 502)
    const payload = await response.json() as [Array<[string]> | undefined, unknown, string?]
    const translated = (payload[0] ?? []).map((part) => part?.[0] ?? '').join('').trim()
    if (!translated) return json(request, { error: 'La traduction est vide.' }, 502)
    return json(request, { text: translated, detectedLanguage: payload[2] ?? null })
  } catch {
    return json(request, { error: 'Traduction temporairement indisponible.' }, 502)
  }
})

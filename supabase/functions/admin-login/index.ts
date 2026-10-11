import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { corsHeaders, json, originAllowed } from '../_shared/http.ts'
import { projectKey } from '../_shared/keys.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'POST' || !originAllowed(request)) return json(request, { error: 'Requête refusée.' }, 403)
  const url = Deno.env.get('SUPABASE_URL')
  const publicKey = projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const serverKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publicKey || !serverKey) return json(request, { error: 'Service indisponible.' }, 503)

  let username: string; let password: string
  try {
    const body = await request.json()
    username = String(body.username ?? '').trim().toLowerCase()
    password = String(body.password ?? '')
  } catch { return json(request, { error: 'Requête invalide.' }, 400) }
  if (!/^[a-z0-9_]{3,32}$/.test(username) || !password || password.length > 1024) return json(request, { error: 'Identifiants incorrects.' }, 401)

  const service = createClient(url, serverKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const publicClient = createClient(url, publicKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${username}:${ip}`))
  const attemptKey = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const { data: allowed, error: limitError } = await service.rpc('admin_login_rate_limit', { p_key: attemptKey })
  if (limitError) return json(request, { error: 'Service indisponible.' }, 503)
  if (!allowed) return json(request, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, 429)

  const { data: admin } = await service.from('app_admins').select('user_id,email').eq('username', username).maybeSingle()
  const email = admin?.email ?? 'invalid-admin@invalid.example'
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password })
  if (error || !admin || !data.user || data.user.id !== admin.user_id || !data.session) return json(request, { error: 'Identifiants incorrects.' }, 401)
  return json(request, { access_token: data.session.access_token, refresh_token: data.session.refresh_token })
})

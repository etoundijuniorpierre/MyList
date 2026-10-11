import { checkKeepalive } from '../../lib/keepalive.mjs'

export default async function handler() {
  try {
    const result = await checkKeepalive({
      siteUrl: process.env.SITE_URL || process.env.URL,
      supabaseUrl: process.env.VITE_SUPABASE_URL,
      supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
    console.info('Routine quotidienne réussie', result.checkedAt)
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (error) {
    console.error('Routine quotidienne échouée', error)
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'content-type': 'application/json' } })
  }
}


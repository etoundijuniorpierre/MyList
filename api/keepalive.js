import { checkKeepalive } from '../lib/keepalive.mjs'

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false })
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16 || request.headers.authorization !== `Bearer ${secret}`) return response.status(401).json({ ok: false })
  try {
    const result = await checkKeepalive({
      siteUrl: process.env.SITE_URL,
      supabaseUrl: process.env.VITE_SUPABASE_URL,
      supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
    console.info('Routine quotidienne réussie', result.checkedAt)
    return response.status(200).json(result)
  } catch (error) {
    console.error('Routine quotidienne échouée', error)
    return response.status(503).json({ ok: false, error: 'Vérification indisponible' })
  }
}

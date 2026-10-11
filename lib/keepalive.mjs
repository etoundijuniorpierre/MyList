const tables = ['catalog_items', 'price_rules', 'game_price_tiers', 'game_count_discount', 'site_settings']

function secureUrl(value, name) {
  if (!value) throw new Error(`${name} manquant`)
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error(`${name} doit utiliser HTTPS`)
  return url
}

export async function checkKeepalive({ siteUrl, supabaseUrl, supabaseKey, fetcher = fetch }) {
  const site = secureUrl(siteUrl, 'SITE_URL')
  const database = secureUrl(supabaseUrl, 'SUPABASE_URL')
  if (!supabaseKey) throw new Error('Clé publique Supabase manquante')

  const siteResponse = await fetcher(new URL('/series', site), {
    method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  if (!siteResponse.ok || !(siteResponse.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(`Site indisponible (${siteResponse.status})`)
  }
  await siteResponse.body?.cancel()

  const checks = await Promise.all(tables.map(async (table) => {
    const endpoint = new URL(`/rest/v1/${table}`, database)
    endpoint.search = 'select=id&limit=1'
    if (table === 'price_rules') endpoint.search = 'select=category&limit=1'
    if (table === 'game_price_tiers') endpoint.search = 'select=min_gb&limit=1'
    if (table === 'game_count_discount') endpoint.search = 'select=min_games&limit=1'
    const response = await fetcher(endpoint, {
      method: 'GET', headers: { apikey: supabaseKey, Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Supabase ${table} indisponible (${response.status})`)
    await response.body?.cancel()
    return table
  }))
  return { ok: true, checkedAt: new Date().toISOString(), site: 'ok', database: checks }
}

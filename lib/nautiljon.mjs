const ORIGIN = 'https://www.nautiljon.com'
const agent = 'MyList/1.0 (catalog metadata reference)'
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
function text(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, token => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[token])
    .replace(/&#(\d+);|&#x([\da-f]+);/gi, (_, decimal, hex) => { const n = decimal ? Number(decimal) : parseInt(hex, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : '' }).replace(/\s+/g, ' ').trim()
}
const attribute = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? ''
export function parseNautiljonSearch(html) {
  const rows = []
  for (const match of html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\brecherche_carte\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const path = text(attribute(match[1], 'href'))
    if (!/^\/animes\/[^/\\?#%]+\.html$/.test(path)) continue
    const title = text(/<span\b[^>]*class=["']recherche_carte__titre["'][^>]*>([\s\S]*?)<\/span>/i.exec(match[2])?.[1])
    const info = text(/<span\b[^>]*class=["']recherche_carte__infos["'][^>]*>([\s\S]*?)<\/span>/i.exec(match[2])?.[1])
    const format = /\bfilm\b/i.test(info) ? /spécial|special|OVA|OAV/i.test(info) ? null : 'film' : /série|serie/i.test(info) && !/spécial|special|OVA|OAV/i.test(info) ? 'series' : null
    const year = Number(/\b((?:19|20|21)\d{2})\b/.exec(info)?.[1]) || null
    const rawImage = attribute(/<img\b[^>]*>/i.exec(match[2])?.[0] ?? '', 'src')
    let poster = null
    try { const image = new URL(text(rawImage), ORIGIN); if (image.origin === ORIGIN && /^\/images(?:min)?\/(?:anime|animes)\//.test(image.pathname)) poster = image.href } catch { /* An invalid thumbnail cannot become a poster. */ }
    if (!title || !format || rows.some(row => row.source_url === ORIGIN + path)) continue
    rows.push({ title, format, year, poster_url: poster, source_url: ORIGIN + path, id: path.slice('/animes/'.length, -'.html'.length), synopsis: null })
    if (rows.length >= 8) break
  }
  return rows
}
async function htmlResponse(response) {
  if ([401, 403, 429].includes(response.status)) throw new Error('Nautiljon limite sa recherche publique. Réessayez plus tard ou ouvrez la source.')
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) throw new Error('La recherche Nautiljon n’est pas disponible.')
  if (Number(response.headers.get('content-length')) > 1500000) throw new Error('Réponse Nautiljon trop volumineuse.')
  const reader = response.body.getReader(), chunks = []; let size = 0
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1500000) throw new Error('Réponse Nautiljon trop volumineuse.'); chunks.push(value) } }
  finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}
// Submit only the site's public search form, including its issued validation field.
// No logged-in cookie, private endpoint, challenge bypass or blocked detail page.
export async function searchNautiljon(query, fetcher = fetch) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 160) throw new Error('Titre invalide.')
  const signal = AbortSignal.timeout(8500)
  async function preferOriginal(rows) {
    const matches = rows.filter(row => normalized(row.title) === normalized(query))
    if (matches.length !== 1 || !matches[0].poster_url?.includes('/imagesmin/')) return rows
    const row = matches[0], image = new URL(row.poster_url)
    image.pathname = image.pathname.replace('/imagesmin/', '/images/')
    try {
      const response = await fetcher(image.href, { method: 'HEAD', redirect: 'error', headers: { 'User-Agent': agent }, signal })
      if (response.ok && /^image\/(?:jpeg|png|webp)(?:;|$)/.test(response.headers.get('content-type') ?? '') && Number(response.headers.get('content-length')) <= 5 * 1024 * 1024) row.poster_url = image.href
    } catch { /* Keep the found thumbnail if the optional original is unavailable. */ }
    return rows
  }
  const url = new URL('/search.php', ORIGIN); url.searchParams.set('q', query.trim())
  const options = { headers: { Accept: 'text/html', 'User-Agent': agent }, redirect: 'error', signal }
  const first = await fetcher(url.href, options)
  const html = await htmlResponse(first)
  const existing = parseNautiljonSearch(html)
  if (existing.length) return preferOriginal(existing)
  const form = /<form\b[^>]*action=["']\/search\.php["'][^>]*>([\s\S]*?)<\/form>/i.exec(html)?.[1] ?? ''
  const field = [...form.matchAll(/<input\b[^>]*>/gi)].map(entry => entry[0]).find(tag => attribute(tag, 'name') === 'st')
  const token = attribute(field ?? '', 'value')
  if (!/^[a-f\d]{16,128}$/i.test(token)) throw new Error('Le formulaire Nautiljon n’a pas pu être validé.')
  const cookieHeaders = typeof first.headers.getSetCookie === 'function' ? first.headers.getSetCookie() : [first.headers.get('set-cookie')].filter(Boolean)
  const cookies = cookieHeaders.map(value => value.split(';')[0]).filter(value => /^[\w-]+=[^;\r\n]*$/.test(value)).join('; ')
  url.searchParams.set('st', token)
  const submitted = await fetcher(url.href, { ...options, headers: { ...options.headers, ...(cookies ? { Cookie: cookies } : {}) } })
  const resultHtml = await htmlResponse(submitted)
  if (/Validez pour lancer la recherche/i.test(resultHtml)) throw new Error('Nautiljon demande de confirmer la recherche directement sur son site.')
  return preferOriginal(parseNautiljonSearch(resultHtml))
}

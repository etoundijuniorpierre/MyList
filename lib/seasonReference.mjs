const hosts = new Map([['www.allocine.fr', 'allocine'], ['allocine.fr', 'allocine'], ['www.nautiljon.com', 'nautiljon'], ['nautiljon.com', 'nautiljon']])
const MAX_BYTES = 1500000
export function referenceUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Collez une adresse HTTPS Allociné ou Nautiljon.') }
  const source = hosts.get(url.hostname)
  const path = decodeURIComponent(url.pathname)
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !source || path.includes('%')
    || !(source === 'allocine' ? /^\/series\/(?:ficheserie_gen_cserie=\d+\.html|fichesaison_gen_csaison=\d+\.html|ficheserie-\d+\/(?:saison-\d+\/)?)$/.test(path) : /^\/animes\/[^/\\?#%]+\.html$/.test(path))) throw new Error('Utilisez le lien direct d’une fiche de série ou de saison Allociné, ou d’un animé Nautiljon.')
  url.hash = ''; url.search = ''
  return { url, source }
}
function decode(value) {
  return String(value ?? '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, token => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[token])
    .replace(/&#(\d{1,7});/g, (_, number) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : '')
    .replace(/&#x([\da-f]{1,6});/gi, (_, number) => parseInt(number, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(number, 16)) : '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
export function parseReference(html, address) {
  const { url, source } = referenceUrl(address)
  const meta = new Map()
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3]]))
    const key = attrs.property || attrs.name
    if (key && attrs.content) meta.set(key.toLowerCase(), decode(attrs.content))
  }
  const structured = []
  const collect = (value, depth = 0) => {
    if (!value || depth > 5 || structured.length > 100) return
    if (Array.isArray(value)) { value.forEach(entry => collect(entry, depth + 1)); return }
    if (typeof value !== 'object') return
    const types = [].concat(value['@type'] ?? [])
    if (types.some(type => ['TVSeason', 'TVSeries', 'CreativeWork'].includes(type))) structured.push(value)
    if (value['@graph']) collect(value['@graph'], depth + 1)
    if (value.mainEntity) collect(value.mainEntity, depth + 1)
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { collect(JSON.parse(match[1])) } catch { /* Ignore invalid site widgets. */ } }
  const node = structured.find(entry => [].concat(entry['@type']).includes('TVSeason')) ?? structured[0] ?? {}
  const title = decode(node.name || meta.get('og:title') || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]).replace(/\s*[-|:]\s*(?:AlloCiné|Nautiljon).*$/i, '').slice(0, 300)
  const rawImage = typeof node.image === 'string' ? node.image : Array.isArray(node.image) ? node.image[0]?.url || node.image[0] : node.image?.url
  let poster = rawImage || meta.get('og:image') || null
  try { const image = new URL(poster, url); poster = poster && image.protocol === 'https:' && !/empty_portrait|\/empty\/|placeholder|no[-_]?image/i.test(image.pathname) ? image.href : null } catch { poster = null }
  let synopsis = decode(node.description || meta.get('og:description') || meta.get('description')).slice(0, 1200)
  if (/^(?:Découvrez|Retrouvez|La fiche|Tout sur)\b/i.test(synopsis)) synopsis = ''
  const number = Number(node.seasonNumber || /\b(?:saison|season)\s*(\d{1,3})\b/i.exec(title)?.[1])
  const year = Number(String(node.datePublished || '').slice(0, 4))
  if (!title || /just a moment|access denied|captcha|attention required/i.test(title)) throw new Error('Cette source demande une vérification dans le navigateur. Ouvrez la fiche et renseignez les informations manuellement.')
  return { title, synopsis: synopsis || null, poster_url: poster, number: Number.isInteger(number) && number > 0 && number <= 999 ? number : null,
    year: year >= 1850 && year <= 2200 ? year : null, source, source_url: url.href }
}
async function limitedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('La fiche dépasse la taille de lecture autorisée.')
  const reader = response.body.getReader(), chunks = []; let bytes = 0
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BYTES) throw new Error('Fiche trop volumineuse.'); chunks.push(value) }
  } finally { await reader.cancel().catch(() => {}) }
  const joined = new Uint8Array(bytes); let at = 0
  chunks.forEach(chunk => { joined.set(chunk, at); at += chunk.length })
  return new TextDecoder().decode(joined)
}
export async function readReference(address, fetcher = fetch) {
  let target = referenceUrl(address)
  const signal = AbortSignal.timeout(7000)
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(target.url.href, { redirect: 'manual', headers: { Accept: 'text/html', 'User-Agent': 'MyList/1.0 (catalog metadata reference)' }, signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) { target = referenceUrl(new URL(response.headers.get('location'), target.url).href); continue }
    if ([401, 403, 429].includes(response.status)) throw new Error('La source bloque ou limite sa lecture automatique. Ouvrez la fiche et ajoutez son affiche ou sa description manuellement.')
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('La fiche source n’est pas disponible.')
    return parseReference(await limitedText(response), target.url.href)
  }
  throw new Error('La source redirige trop souvent. Utilisez le lien final de la fiche.')
}

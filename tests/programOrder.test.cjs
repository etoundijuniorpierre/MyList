const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { catalogFirstSearch, catalogSearchPattern, programQuote, programOrderMessage } = require('../src/programOrder.ts')
const { releaseTouchFocus, syncModal } = require('../src/dialogState.ts')
const item = (extra = {}) => ({ id: '1', category: 'series', media_type: null, title: 'Un titre', title_key: 'series:none:un titre',
  poster_url: null, synopsis: null, genres: [], year: 2020, source: 'tvmaze', source_id: '1', source_url: null, active: true, seasons_count: 3, game_size_gb: null, ...extra })
const settings = { prices: [
  { category: 'series', standard_price: 500, threshold_seasons: 3, threshold_price: 400, currency: 'XAF' },
  { category: 'anime', standard_price: 300, threshold_seasons: null, threshold_price: null, currency: 'XAF' },
  { category: 'anime-film', standard_price: 700, threshold_seasons: null, threshold_price: null, currency: 'XAF' },
], gameTiers: [{ min_gb: 1, max_gb: 49, price: 1000, currency: 'XAF' }, { min_gb: 50, max_gb: 100, price: 2000, currency: 'XAF' }],
  gameDiscount: { min_games: 5, price_per_game: 800, currency: 'XAF' }, settings: { whatsapp_number: '237600000000' } }
const format = (amount, currency) => `${amount} ${currency}`

test('un titre au catalogue court-circuite toute recherche externe', async () => {
  const candidate = { item: item(), inCatalog: true }
  const result = await catalogFirstSearch(async () => [candidate], async () => { throw new Error('Aucun appel externe attendu') })
  assert.deepEqual(result, { candidates: [candidate], external: false })
})
test('un titre absent est recherché après le catalogue, une panne ne signifie pas une absence', async () => {
  const events = []
  await catalogFirstSearch(async () => { events.push('catalogue'); return [] }, async () => { events.push('source'); return [] })
  assert.deepEqual(events, ['catalogue', 'source'])
  await assert.rejects(catalogFirstSearch(async () => { throw new Error('Réseau') }, async () => assert.fail('Faux hors catalogue')), /Réseau/)
})
test('la recherche conserve les caractères littéraux de SQL et accepte les mots séparés par une ponctuation', () => {
  assert.equal(catalogSearchPattern(' Naruto  Shippuden '), '%Naruto%Shippuden%')
  assert.equal(catalogSearchPattern('100% _test\\'), '%100\\%%\\_test\\\\%')
})
test('une commande applique la vraie remise de saisons et le prix distinct des films', () => {
  assert.equal(programQuote({ item: item(), inCatalog: true }, settings).amount, 1200)
  assert.equal(programQuote({ item: item({ category: 'anime', media_type: 'anime', seasons_count: 20 }), inCatalog: false }, settings).amount, 6000)
  assert.equal(programQuote({ item: item({ category: 'anime', media_format: 'film', seasons_count: null }), inCatalog: false }, settings).amount, 700)
  assert.equal(programQuote({ item: item({ category: 'games', game_size_gb: 49.01 }), inCatalog: true }, settings).amount, 2000)
})
test('poids, saisons ou prix absents ne produisent jamais une commande gratuite', () => {
  for (const entry of [item({ seasons_count: null }), item({ category: 'games', game_size_gb: null }), item({ category: 'novelas' })]) {
    const candidate = { item: entry, inCatalog: false }
    assert.equal(programQuote(candidate, settings), null)
    assert.match(programOrderMessage(candidate, settings, '', format), /Prix à confirmer/)
    assert.doesNotMatch(programOrderMessage(candidate, settings, '', format), /: 0 XAF/)
  }
})
test('WhatsApp distingue estimation externe, présence inconnue et tarif courant après modification', () => {
  const candidate = { item: item(), inCatalog: false }
  assert.match(programOrderMessage(candidate, settings, 'Jean', format), /Prix estimé, sous réserve de disponibilité : 1200 XAF/)
  assert.match(programOrderMessage({ ...candidate, catalogChecked: false }, settings, '', format), /Présence au catalogue et disponibilité à confirmer/)
  const changed = { ...settings, prices: [{ ...settings.prices[0], threshold_price: 600 }] }
  assert.match(programOrderMessage({ ...candidate, inCatalog: true }, changed, '', format), /Prix : 1800 XAF/)
  assert.match(programOrderMessage(candidate, settings, '', format), /hors panier/)
})
test('fermer la modale sur écran tactile libère le focus restauré, sans voler celui de la fiche suivante', () => {
  const previousWindow = global.window, previousDocument = global.document
  let blurred = 0
  try {
    global.window = { matchMedia: () => ({ matches: true }) }
    global.document = { activeElement: { closest: () => null, blur: () => blurred++ } }
    syncModal({ open: true, close() { this.open = false } }, false, () => {})
    assert.equal(blurred, 1)
    global.document.activeElement.closest = () => ({ open: true })
    releaseTouchFocus()
    assert.equal(blurred, 1)
    global.window.matchMedia = () => ({ matches: false })
    global.document.activeElement.closest = () => null
    releaseTouchFocus()
    assert.equal(blurred, 1)
  } finally { global.window = previousWindow; global.document = previousDocument }
})
test('les sources publiques présentent plusieurs homonymes sans déduire de saisons des épisodes', async () => {
  const { searchPrograms } = await import('../api/order-search.js')
  const found = await searchPrograms('Ghosts', 'series', async url => {
    assert.match(url, /^https:\/\/api.tvmaze.com\/search\/shows\?q=Ghosts$/)
    return { ok: true, json: async () => [{ show: { id: 1, name: 'Ghosts', premiered: '2019-04-15', image: null } }, { show: { id: 2, name: 'Ghosts', premiered: '2021-10-07', image: null } }] }
  })
  assert.deepEqual(found.map(row => row.year), [2019, 2021])
  assert.ok(found.every(row => !('seasons_count' in row)))
})
test('la recherche anime a un secours, identifie les films et ne divulgue aucun secret', async () => {
  const { searchPrograms } = await import('../api/order-search.js')
  const urls = []
  const found = await searchPrograms('Your Name', 'anime', async (url, options) => {
    urls.push(url)
    assert.equal(options.headers?.Authorization, undefined)
    if (urls.length === 1) throw new Error('AniList en panne')
    return { ok: true, json: async () => ({ data: [{ mal_id: 32281, title: 'Kimi no Na wa.', type: 'Movie', year: 2016 }] }) }
  })
  assert.equal(urls.length, 2)
  assert.match(urls[1], /^https:\/\/api.jikan.moe/)
  assert.equal(found[0].format, 'film')
  assert.equal(found[0].source, 'jikan-anime')
})
test('le point public refuse les paramètres invalides avant tout accès aux fournisseurs', async () => {
  const { default: handler } = await import('../api/order-search.js')
  for (const request of [{ method: 'POST', url: '/api/order-search?q=Naruto&category=anime' }, { method: 'GET', url: '/api/order-search?q=x&category=anime' }, { method: 'GET', url: '/api/order-search?q=Naruto&category=secret' }]) {
    const response = { setHeader() {}, status(value) { this.statusCode = value; return this }, json(body) { this.body = body } }
    await handler(request, response)
    assert.ok([400, 405].includes(response.statusCode))
    assert.equal(typeof response.body.error, 'string')
  }
})

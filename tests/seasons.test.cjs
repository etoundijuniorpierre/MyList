const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const { availableSeasonNumbers, selectItemSeasons, cartItems, readCartSelection, cleanCartSelection, seasonSelectionLabel, displaySeasons, remapCartSelection, restoreCartItem } = require('../src/seasonSelection.ts')
const { calculateCart } = require('../src/pricing.ts')
const { buildCartMessage } = require('../src/cartMessage.ts')
const { scannedItemInput, planScanImport } = require('../src/catalogImport.ts')
const { needsSeasonDetails } = require('../src/metadataDecisions.ts')
const { measureLabel } = require('../src/display.ts')
const item = (extra = {}) => ({ id: 'a', title: 'Une série', category: 'series', media_type: null, media_format: null, title_key: 'series:none:une serie', active: true, seasons_count: 4,
  game_size_gb: null, genres: [], source: 'manual', source_id: null, source_url: null, synopsis: null, poster_url: null, year: null, ...extra })
const rules = [{ category: 'series', standard_price: 500, threshold_seasons: 3, threshold_price: 400, currency: 'XAF' }, { category: 'anime', standard_price: 300, threshold_seasons: 3, threshold_price: 250, currency: 'XAF' }, { category: 'anime-film', standard_price: 800, threshold_seasons: null, threshold_price: null, currency: 'XAF' }]
const discount = { min_games: null, price_per_game: null, currency: null }
const empty = () => ({ ids: [], seasons: {} })
const calculate = entries => calculateCart(entries, rules, [], discount)

test('le catalogue distingue la disponibilité du total sans changer les quantités facturées', () => {
  const parent = item({ seasons_count: 1, seasons_total: 4 })
  assert.equal(measureLabel(parent), '1 disponible / 4 saisons')
  assert.equal(parent.seasons_count, 1)
  assert.equal(cartItems([parent], { ids: ['a'], seasons: {} })[0].seasons_count, 1)
  assert.equal(measureLabel(item({ seasons_count: 4, seasons_total: 2 })), '4 disponibles · total à vérifier')
  assert.equal(measureLabel(item({ seasons_count: null, seasons_total: 4 })), '4 saisons au total · disponibilité à confirmer')
})

test('une fusion de fiches conserve les saisons choisies et ne transforme pas un choix partiel en intégrale', () => {
  const cart = { ids: ['a', 'b'], seasons: { a: [2], b: [4] } }
  assert.deepEqual(remapCartSelection(cart, 'a', 'b'), { ids: ['b'], seasons: { b: [2, 4] } })
  assert.equal(remapCartSelection(cart, 'non sélectionné', 'b'), cart)
  assert.deepEqual(remapCartSelection({ ids: ['a'], seasons: { a: [2] } }, 'a', 'b'), { ids: ['b'], seasons: { b: [2] } })
})
test('annuler un choix de saisons conserve les modifications faites ensuite sur un autre titre', () => {
  const before = { ids: ['a'], seasons: { a: [2] } }
  const now = { ids: ['a', 'b'], seasons: { a: [2, 4], b: [3] } }
  assert.deepEqual(restoreCartItem(now, before, 'a'), { ids: ['a', 'b'], seasons: { a: [2], b: [3] } })
})

test('un ancien panier reste une sélection intégrale et le panier versionné conserve les saisons choisies', () => {
  const legacy = readCartSelection({ getItem: key => key === 'mylist-selection' ? '["a"]' : null })
  assert.deepEqual(legacy, { ids: ['a'], seasons: {} })
  const partial = selectItemSeasons(legacy, item(), [2, 4])
  assert.deepEqual(readCartSelection({ getItem: key => key === 'mylist-cart-v2' ? JSON.stringify(partial) : null }), partial)
  assert.deepEqual(cleanCartSelection({ ids: ['a', 'a', 'b'], seasons: { a: [3, 3, -1, '1', 9999], b: [], unknown: [1] } }), { ids: ['a'], seasons: { a: [3] } })
})
test('sélectionner quelques saisons, puis l’intégrale, puis retirer ne crée jamais de doublon', () => {
  const parent = item()
  let cart = selectItemSeasons(empty(), parent, [2])
  cart = selectItemSeasons(cart, parent, [2, 4, 4])
  assert.deepEqual(cart, { ids: ['a'], seasons: { a: [2, 4] } })
  assert.equal(cartItems([parent], cart)[0].seasons_count, 2)
  cart = selectItemSeasons(cart, parent, null)
  assert.deepEqual(cart, { ids: ['a'], seasons: {} })
  assert.equal(cartItems([parent], cart)[0].seasons_count, 4)
  assert.deepEqual(selectItemSeasons(cart, parent, []), empty())
})
test('les numéros non consécutifs restent leurs vrais numéros, les saisons hors stock sont refusées', () => {
  const parent = item({ seasons_count: 2, available_seasons: [2, 4] })
  assert.deepEqual(availableSeasonNumbers(parent), [2, 4])
  assert.deepEqual(selectItemSeasons(empty(), parent, [1, 3]), empty())
  const projected = cartItems([parent], { ids: ['a'], seasons: { a: [4] } })[0]
  assert.equal(projected.seasons_count, 1)
  assert.equal(seasonSelectionLabel(projected), 'Saison 4')
  const stale = cartItems([item({ seasons_count: 1, available_seasons: [2] })], { ids: ['a'], seasons: { a: [4] } })[0]
  assert.ok(stale.selection_error)
  assert.equal(calculate([stale]).total, null)
})
test('les remises comptent seulement les saisons choisies, y compris entre séries et animés', () => {
  const series = item(), anime = item({ id: 'b', category: 'anime', media_type: 'anime' })
  let cart = selectItemSeasons(empty(), series, [2])
  cart = selectItemSeasons(cart, anime, [3])
  assert.equal(calculate(cartItems([series, anime], cart)).total, 800)
  cart = selectItemSeasons(cart, anime, [3, 4])
  assert.equal(calculate(cartItems([series, anime], cart)).total, 900)
  assert.equal(series.seasons_count, 4, 'le calcul ne modifie pas la quantité du catalogue')
})
test('le message WhatsApp identifie les saisons et facture uniquement le sous-ensemble', () => {
  const series = item()
  const entries = cartItems([series], selectItemSeasons(empty(), series, [2, 4]))
  const message = buildCartMessage(calculate(entries), '', (amount, code) => `${amount} ${code}`)
  assert.match(message, /Saisons 2, 4/)
  assert.match(message, /2 saisons × 500/)
  assert.match(message, /Total : 1000 XAF/)
  assert.equal(seasonSelectionLabel(cartItems([series], { ids: ['a'], seasons: {} })[0]), 'Intégrale · Saisons 1 à 4')
})
test('les films et jeux ne deviennent jamais des saisons sélectionnables', () => {
  const film = item({ category: 'anime', media_format: 'film', seasons_count: null })
  assert.deepEqual(availableSeasonNumbers(film), [])
  assert.deepEqual(availableSeasonNumbers(item({ category: 'games' })), [])
  assert.equal(calculate(cartItems([film], { ids: ['a'], seasons: {} })).total, 800)
})
test('le détail utilise une saison numérotée en attendant le vrai titre sans écraser les informations connues', () => {
  const saved = { item_id: 'a', number: 2, title: 'Un arc nommé', synopsis: 'Une description propre à cette saison.', poster_url: 'https://example.com/season2.jpg', manual: true }
  const rows = displaySeasons(item(), [saved])
  assert.equal(rows.length, 4)
  assert.equal(rows[1], saved)
  assert.equal(rows[1].synopsis, 'Une description propre à cette saison.')
  assert.equal(rows[0].title, null)
})
test('le scan conserve S02 et S04 et fusionne deux dossiers de saisons sans les confondre', () => {
  const row = number => ({ id: String(number), title: 'Une série', category: 'series', media_type: null, media_format: null, seasons_count: 1, season_numbers: [number], game_size_gb: null, file_count: 1, path: `S0${number}`, selected: true, warning: null })
  const input = scannedItemInput({ ...row(2), seasons_count: 2, season_numbers: [2, 4] })
  assert.deepEqual(input.available_seasons, [2, 4])
  const planned = planScanImport([row(2), row(4)], [])
  assert.equal(planned.length, 1)
  assert.equal(planned[0].input.seasons_count, 2)
  assert.deepEqual(planned[0].input.available_seasons, [2, 4])
  const updated = scannedItemInput(row(4), item({ seasons_count: 1, available_seasons: [2] }))
  assert.deepEqual(updated.available_seasons, [2, 4])
  assert.equal(updated.seasons_count, 2)
})
test('la complétion réclame les saisons détaillées et respecte la durée de conservation des décisions', () => {
  assert.equal(needsSeasonDetails(item()), true)
  assert.equal(needsSeasonDetails(item({ season_details_checked_at: new Date().toISOString() })), false)
  assert.equal(needsSeasonDetails(item({ category: 'anime', media_format: 'film' })), false)
})
const anime = (id, title, year, extra = {}) => ({ id, format: 'TV', title: { english: title }, startDate: { year, month: 1, day: 1 }, coverImage: { large: `https://example.com/${id}.jpg` }, relations: { edges: [] }, ...extra })
test('une chaîne anime vérifiée fournit les vrais titres et affiches, sans films ni OAV', async () => {
  const { safeAnimeSeasons } = await import('../lib/seasonSources.mjs')
  const first = anime(1, 'My Hero Academia', 2016), second = anime(2, 'My Hero Academia Season 2', 2017)
  const film = anime(3, 'My Hero Academia Movie', 2018, { format: 'MOVIE' })
  first.relations.edges = [{ relationType: 'SEQUEL', node: second }, { relationType: 'SEQUEL', node: film }]
  second.relations.edges = [{ relationType: 'PREQUEL', node: first }]
  const found = safeAnimeSeasons(first, 2)
  assert.deepEqual(found.map(row => [row.number, row.title]), [[1, 'My Hero Academia'], [2, 'My Hero Academia Season 2']])
  assert.equal(found[1].poster_url, 'https://example.com/2.jpg')
})
test('les parties de saison, les suites d’une autre série et les chaînes incomplètes ne sont pas numérotées au hasard', async () => {
  const { safeAnimeSeasons } = await import('../lib/seasonSources.mjs')
  const first = anime(1, 'Attack on Titan', 2013)
  first.relations.edges = [{ relationType: 'SEQUEL', node: anime(2, 'Attack on Titan Final Season Part 2', 2022) }]
  assert.deepEqual(safeAnimeSeasons(first, 2), [])
  const naruto = anime(3, 'Naruto Shippuden', 2007)
  naruto.relations.edges = [{ relationType: 'SEQUEL', node: anime(4, 'Boruto Naruto Next Generations', 2017) }]
  assert.deepEqual(safeAnimeSeasons(naruto, 2), [])
  assert.deepEqual(safeAnimeSeasons(anime(1, 'My Hero Academia', 2016), 6), [])
})
test('TVMaze garde les numéros officiels et ignore spéciaux et saisons futures', async () => {
  const { resolveSeasonDetails } = await import('../lib/seasonSources.mjs')
  const result = await resolveSeasonDetails({ source: 'tvmaze', id: '1', category: 'series', titles: ['Under the Dome'], year: 2013, expected: 2 }, async url => {
    assert.equal(url, 'https://api.tvmaze.com/shows/1/seasons')
    return { ok: true, json: async () => [{ id: 10, number: 0, premiereDate: '2013-01-01' }, { id: 11, number: 2, name: 'Une saison nommée', premiereDate: '2014-01-01', image: { original: 'https://example.com/2.jpg' } }, { id: 12, number: 4, premiereDate: '2016-01-01' }, { id: 13, number: 5, premiereDate: '2199-01-01' }] }
  })
  assert.deepEqual(result.seasons.map(row => row.number), [2, 4])
  assert.equal(result.seasons[0].title, 'Une saison nommée')
})
test('une panne AniList utilise les identités et relations MAL sans confondre les films et les saisons', async () => {
  const { resolveSeasonDetails } = await import('../lib/seasonSources.mjs')
  const raw = (id, title, year, relations = []) => ({ mal_id: id, title, title_english: title, type: 'TV', year, aired: { prop: { from: { year, month: 1, day: 1 } } }, images: { jpg: { image_url: `https://example.com/${id}.jpg` } }, relations })
  const first = raw(10, 'Example Saga', 2020, [{ relation: 'Sequel', entry: [{ mal_id: 20, type: 'anime', name: 'Example Saga Season 2' }] }])
  const second = raw(20, 'Example Saga Season 2', 2021, [{ relation: 'Prequel', entry: [{ mal_id: 10, type: 'anime', name: 'Example Saga' }] }])
  const found = await resolveSeasonDetails({ source: 'anilist', id: '42', category: 'anime', titles: ['Example Saga'], year: 2020, expected: 2 }, async url => {
    if (url.includes('graphql.anilist')) return { ok: false }
    if (url.includes('api.tvmaze')) return { ok: true, json: async () => [] }
    if (url.includes('/anime?q=')) return { ok: true, json: async () => ({ data: [first] }) }
    if (url.endsWith('/10/full')) return { ok: true, json: async () => ({ data: first }) }
    if (url.endsWith('/20/full')) return { ok: true, json: async () => ({ data: second }) }
    throw new Error('Requête inattendue')
  })
  assert.equal(found.seasons.length, 2)
  assert.equal(found.seasons[1].source_id, '20')
  assert.equal(found.seasons[1].source_url, 'https://myanimelist.net/anime/20')
})
test('la recherche de saisons refuse les références arbitraires avant tout appel externe', async () => {
  const { default: handler } = await import('../api/seasons.js')
  for (const url of ['/api/seasons?source=http://local&id=1&category=anime&title=Naruto', '/api/seasons?source=tvmaze&id=../secret&category=series&title=Lost', '/api/seasons?source=tvmaze&id=1&category=games&title=Lost']) {
    const response = { setHeader() {}, status(value) { this.code = value; return this }, json() {} }
    await handler({ method: 'GET', url }, response)
    assert.equal(response.code, 400)
  }
})

test('un fournisseur bloqué ne fait pas perdre les saisons déjà trouvées par un autre fournisseur', async () => {
  const { resolveSeasonDetails } = await import('../lib/seasonSources.mjs')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20)
  try {
    const result = await resolveSeasonDetails({ source: 'tvmaze', id: '1', category: 'anime', titles: ['Example Saga'], year: 2020, expected: 2 }, async (url, options) => {
      if (url.includes('api.tvmaze')) return { ok: true, json: async () => [{ id: 1, number: 1, premiereDate: '2020-01-01', image: { original: 'https://example.com/1.jpg' } }] }
      return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }) })
    }, controller.signal)
    assert.equal(result.seasons.length, 1)
    assert.equal(result.seasons[0].poster_url, 'https://example.com/1.jpg')
  } finally { clearTimeout(timer) }
})
test('une panne des saisons ne transforme pas une fiche déjà enregistrée en échec et reste signalée pour reprise', async () => {
  const Module = require('node:module')
  const original = Module._load
  const filename = require.resolve('../src/applyCompletion.ts')
  const parent = item({ updated_at: '2026-01-01T00:00:00Z' })
  const builder = { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: parent, error: null }) }
  try {
    Module._load = function (request, owner, ...rest) {
      if (owner?.filename === filename) {
        if (request === './metadata') return { cachePosterUrl: async () => null, isCachedPosterUrl: () => false }
        if (request === './media') return { safeUrl: value => value || undefined, translateSynopsisToFrench: async value => value }
        if (request === './supabase') return { supabase: { from: () => builder } }
        if (request === './completeSeasonDetails') return { completeSeasonDetails: async () => { throw new Error('Source temporairement indisponible') } }
      }
      return original.call(this, request, owner, ...rest)
    }
    delete require.cache[filename]
    const { applyCompletion } = require(filename)
    const found = { sources: [] }
    const saved = await applyCompletion(parent, found)
    assert.equal(saved.item, parent)
    assert.match(found.seasons_error, /temporairement indisponible/)
  } finally { Module._load = original; delete require.cache[filename] }
})

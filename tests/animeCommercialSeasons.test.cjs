const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const { availableSeasonNumbers, cartItems, selectItemSeasons, hasSeasonChoices, seasonSelectionLabel } = require('../src/seasonSelection.ts')
const { measureLabel } = require('../src/display.ts')
const { calculateCart, discountProgress } = require('../src/pricing.ts')
const { completionPatch } = require('../src/completionPlan.ts')
const { scannedItemInput } = require('../src/catalogImport.ts')
const { needsSeasonDetails, needsSeasonLookup } = require('../src/metadataDecisions.ts')
const item = (extra = {}) => ({ id: 'anime', title: 'Une saga', category: 'anime', media_type: 'anime', media_format: 'series', title_key: 'anime:anime:une saga', active: true, genres: ['Action'], year: 2012, source: 'manual', source_id: null, source_url: null, poster_url: null, synopsis: null, game_size_gb: null, seasons_count: 1, seasons_total: 5, available_seasons: [1], metadata_preferences: { seasons_quantity_mode: 'commercial-total' }, ...extra })
const prices = [{ category: 'anime', standard_price: 500, threshold_seasons: 3, threshold_price: 400, currency: 'XAF' }, { category: 'anime-film', standard_price: 800, currency: 'XAF' }]
const calculate = entries => calculateCart(entries, prices, [], {})

test('le total commercial animé est affiché et sélectionnable, avec un prix qui suit le choix réel', () => {
  const parent = item()
  assert.equal(measureLabel(parent), '5 saisons')
  assert.deepEqual(availableSeasonNumbers(parent), [1, 2, 3, 4, 5])
  const whole = cartItems([parent], { ids: ['anime'], seasons: {} })
  assert.equal(calculate(whole).total, 2000)
  const partial = selectItemSeasons({ ids: [], seasons: {} }, parent, [2, 5])
  const selected = cartItems([parent], partial)
  assert.equal(calculate(selected).total, 1000)
  assert.equal(seasonSelectionLabel(selected[0]), 'Saisons 2, 5')
})

test('un animé utilise son total exact même si une vue publique ne reçoit pas l’ancien indicateur interne', () => {
  const parent = item({ seasons_count: 1, available_seasons: [1], metadata_preferences: {} })
  assert.equal(measureLabel(parent), '5 saisons')
  assert.deepEqual(availableSeasonNumbers(parent), [1, 2, 3, 4, 5])
  assert.equal(calculate(cartItems([parent], { ids: ['anime'], seasons: {} })).total, 2000)
})

test('une nouvelle recherche ou un import ne ramène pas une saga validée à un dossier de saison', () => {
  const parent = item()
  const imported = scannedItemInput({ title: parent.title, category: 'anime', media_type: 'anime', media_format: 'series', seasons_count: 1, season_numbers: [1], game_size_gb: null }, parent)
  assert.equal(imported.seasons_count, 5)
  assert.deepEqual(imported.available_seasons, [1, 2, 3, 4, 5])
  const patched = completionPatch(parent, { seasons_total: 6, seasons_checked_at: '2026-10-22T00:00:00Z', sources: [] })
  assert.equal(patched.seasons_count, 6)
  assert.deepEqual(patched.available_seasons, [1, 2, 3, 4, 5, 6])
  const locked = item({ metadata_preferences: { ...parent.metadata_preferences, seasons_reference: { count: 5, locked: true } } })
  assert.equal(completionPatch(locked, { seasons_total: 1, seasons_checked_at: '2026-10-22T00:00:00Z', sources: [] }).seasons_total, undefined)
})

test('une saison supplémentaire ajoutée manuellement reste visible et sélectionnable', () => {
  const parent = item({ seasons_count: 6, available_seasons: [1, 2, 3, 4, 5, 6] })
  assert.deepEqual(availableSeasonNumbers(parent), [1, 2, 3, 4, 5, 6])
  assert.equal(measureLabel(parent), '6 saisons')
  assert.equal(calculate(cartItems([parent], { ids: ['anime'], seasons: {} })).total, 2400)
})

test('un total externe invalide ne crée pas de saisons ni de quantité facturable', () => {
  for (const count of [-1, 0, 1.5, 1000, Infinity]) {
    const patch = completionPatch(item(), { seasons_total: count, seasons_checked_at: '2026-10-22T00:00:00Z', sources: [] })
    assert.equal(patch.seasons_total, undefined)
    assert.equal(patch.available_seasons, undefined)
    assert.equal(patch.seasons_count, undefined)
  }
})

test('une collection d’OAV compte pour une saison au tarif et au seuil, les films restent distincts', () => {
  const collection = item({ seasons_count: 12, seasons_total: 3, metadata_preferences: { content_kind: 'episode-collection' } })
  assert.equal(measureLabel(collection), 'Collection complète')
  assert.equal(hasSeasonChoices(collection), false)
  assert.equal(seasonSelectionLabel(collection), 'Collection complète')
  assert.equal(needsSeasonDetails(collection), false)
  assert.equal(needsSeasonLookup(collection), false)
  const selected = cartItems([collection], { ids: ['anime'], seasons: {} })
  assert.equal(calculate(selected).total, 500)
  assert.equal(discountProgress(selected, prices, {}, String)[0].current, 1)
  const film = item({ id: 'film', media_format: 'film', seasons_count: null })
  assert.equal(calculate([...selected, film]).total, 1300)
})

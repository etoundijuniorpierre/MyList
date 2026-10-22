const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
let database
require.extensions['.ts'] = (module, filename) => {
  const originalRequire = module.require.bind(module)
  module.require = request => {
    if (filename.endsWith('metadata.ts') && request === './supabase') return { supabase: null }
    if (filename.endsWith('applyCompletion.ts')) {
      if (request === './supabase') return { get supabase() { return database } }
      if (request === './metadata') return { cachePosterUrl: async value => value, isCachedPosterUrl: () => false }
      if (request === './media') return { safeUrl: value => value?.startsWith('https://') ? value : undefined, translateSynopsisToFrench: async value => value }
    }
    return originalRequire(request)
  }
  const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})')
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { acceptedPreferences, needsCompletion, needsSeasonLookup, reviewIsPending, requireDecisionStorage, retainedCandidate } = require('../src/metadataDecisions.ts')
const { suggestTitle } = require('../src/titleHealth.ts')
const { completionPatch } = require('../src/completionPlan.ts')
const { completeMetadata, completionFrom } = require('../src/metadata.ts')
const { applyCompletion } = require('../src/applyCompletion.ts')
const { saveCatalogItem } = require('../src/admin/saveCatalogItem.ts')
const { titleKey } = require('../src/types.ts')
const { applyCatalogRows } = require('../src/catalogMutations.ts')
const row = (extra = {}) => ({ id: 'fiche', category: 'anime', media_type: 'anime', media_format: null, title: 'NARUTO', title_key: titleKey('anime', 'anime', 'NARUTO'), synopsis: 'Description française déjà présente.', poster_url: 'https://example.com/cover.jpg', genres: ['Action'], year: 2002, source: 'anilist', source_id: '20', source_url: 'https://anilist.co/anime/20', active: true, seasons_count: 5, game_size_gb: null, metadata_preferences: {}, ...extra })
const candidate = { key: 'anilist:20', title: 'Naruto', aliases: ['Naruto'], category: 'anime', format: 'series', year: 2002, poster_url: 'https://example.com/poster.jpg', synopsis: 'Une description de l’œuvre retenue.', genres: ['Action'], source: 'anilist', source_id: '20', source_url: 'https://anilist.co/anime/20', sources: ['anilist'], identities: [{ source: 'anilist', id: '20' }], score: 0.7, notes: ['Titre personnalisé'] }

test('un titre personnalisé accepté ne revient pas au nettoyage après une complétion ou un rechargement', () => {
  const item = row()
  assert.ok(suggestTitle(item))
  item.metadata_preferences.title = item.title
  assert.equal(suggestTitle(JSON.parse(JSON.stringify(item))), null)
  const patch = completionPatch(item, { sources: ['anilist'], binding: candidate, seasons_total: 5, seasons_checked_at: new Date().toISOString() })
  assert.equal(suggestTitle({ ...item, ...patch }), null)
  assert.ok(suggestTitle({ ...item, title: 'AUTRE TITRE CRIÉ' }))
})

test('une correspondance choisie reste résolue même si une ancienne file locale la propose encore', () => {
  const item = row({ metadata_preferences: acceptedPreferences(row(), candidate) })
  const restored = JSON.parse(JSON.stringify(item))
  assert.equal(reviewIsPending(restored, false), false)
  assert.equal(restored.metadata_preferences.match.source_id, '20')
  assert.equal(restored.title, 'NARUTO')
  assert.equal(restored.metadata_preferences.title, 'NARUTO')
})

test('un identifiant d’œuvre déjà enregistré avant la migration n’est pas oublié', () => {
  assert.equal(retainedCandidate(row()).source_id, '20')
  assert.equal(retainedCandidate(row({ metadata_preferences: { ignore_source: true } })), null)
  assert.equal(retainedCandidate(row({ source: 'scan', source_id: null })), null)
})

test('un refus persistant empêche une nouvelle complétion et une nouvelle file d’arbitrage', async () => {
  const item = row({ metadata_preferences: { rejected: true } })
  assert.equal(needsCompletion(item), false)
  assert.equal(reviewIsPending(item, false), false)
  assert.deepEqual(await completeMetadata(item), { completion: null, candidates: [] })
})

test('la complétion reprend la correspondance choisie sans refaire une recherche approximative du titre', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async url => { calls.push(String(url)); return { ok: true, json: async () => ({ count: 5 }) } }
  try {
    const item = row({ title: 'Mon intitulé préféré', metadata_preferences: acceptedPreferences(row(), candidate) })
    const result = await completeMetadata(item)
    assert.deepEqual(result.candidates, [])
    assert.equal(result.completion.seasons_total, 5)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].startsWith('/api/season-count?'))
    assert.ok(calls[0].includes('title=Naruto'))
  } finally { global.fetch = originalFetch }
})

test('une panne du total des saisons ne fait pas perdre le résultat ni relancer l’arbitrage', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: false })
  try {
    const item = row({ year: null })
    const result = await completionFrom(item, candidate)
    assert.equal(result.year, 2002)
    assert.ok(result.seasons_error)
    assert.equal(result.seasons_checked_at, undefined)
    const patch = completionPatch(item, result)
    assert.equal(patch.metadata_preferences.match.key, candidate.key)
    assert.equal(patch.year, 2002)
  } finally { global.fetch = originalFetch }
})

test('un titre renommé reprend les genres depuis son identifiant TVMaze sans nouvelle ambiguïté', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async url => {
    calls.push(String(url))
    if (String(url).startsWith('https://api.tvmaze.com/shows/1')) return { ok: true, json: async () => ({ id: 1, name: 'Under the Dome', genres: ['Drame'], summary: null, image: null, premiered: '2013-06-24' }) }
    return { ok: true, json: async () => ({ count: 3 }) }
  }
  try {
    const item = row({ title: 'MON TITRE CHOISI', category: 'series', source: 'tvmaze', source_id: '1', genres: [], year: 2013 })
    const result = await completeMetadata(item)
    assert.deepEqual(result.candidates, [])
    assert.deepEqual(result.completion.genres, ['Drame'])
    assert.equal(result.completion.seasons_total, 3)
    assert.equal(item.title, 'MON TITRE CHOISI')
    assert.ok(!calls.some(url => url.includes('search')))
  } finally { global.fetch = originalFetch }
})

test('le total manquant déclenche une recherche même si affiche, description et genres sont présents', () => {
  assert.equal(needsCompletion(row()), true)
  const checked = row({ seasons_total: 5, seasons_checked_at: new Date().toISOString() })
  assert.equal(needsCompletion(checked), true, 'les saisons détaillées doivent aussi être complétées')
  checked.season_details_checked_at = new Date().toISOString()
  assert.equal(needsCompletion(checked), false)
  assert.equal(needsSeasonLookup(row({ category: 'games' })), false)
  assert.equal(needsSeasonLookup(row({ media_format: 'film' })), false)
  assert.equal(needsSeasonLookup(row({ seasons_checked_at: new Date().toISOString() })), false)
})

test('un total sourcé devient la quantité exacte des animés, y compris après un ancien scan ou réglage partiel', () => {
  const found = { seasons_total: 20, seasons_checked_at: new Date().toISOString(), sources: ['tvmaze'] }
  const empty = completionPatch(row({ seasons_count: null }), found)
  assert.equal(empty.seasons_count, 20)
  assert.equal(empty.seasons_total, 20)
  assert.equal(empty.metadata_preferences.seasons_auto, true)
  assert.equal(completionPatch(row({ seasons_count: 5, source: 'scan' }), found).seasons_count, 20)
  assert.equal(completionPatch(row({ seasons_count: 5, metadata_preferences: { seasons_manual: 5 } }), found).seasons_count, 20)
  assert.equal(completionPatch(row({ seasons_count: 5, metadata_preferences: { seasons_auto: true } }), found).seasons_count, 20)
})

test('un découpage de saisons vérifié manuellement reste prioritaire sans modifier le stock ou le tarif', () => {
  const reference = { count: 4, locked: true, scheme: 'distribution', note: '170 épisodes en 4 saisons', source_url: 'https://example.com/seasons', checked_at: '2026-10-22T00:00:00Z' }
  const item = row({ title: 'Black Clover', seasons_total: 4, seasons_count: 1, metadata_preferences: { seasons_reference: reference, seasons_note: reference.note } })
  assert.equal(needsSeasonLookup(item), false)
  const patch = completionPatch(item, { seasons_total: 1, seasons_checked_at: new Date().toISOString(), seasons_note: 'Un autre découpage', genres: ['Action'], sources: ['tvmaze'] })
  assert.equal(patch.seasons_total, undefined)
  assert.equal(patch.seasons_count, undefined)
  assert.equal(patch.seasons_checked_at, undefined)
  assert.equal(patch.metadata_preferences, undefined)
  assert.equal(needsSeasonLookup({ ...item, seasons_total: 5 }), true, 'une modification explicite du total invalide l’ancienne référence')
})

test('un total inconnu ne devient jamais une saison par défaut', () => {
  const patch = completionPatch(row({ seasons_count: null }), { seasons_total: null, seasons_checked_at: new Date().toISOString(), sources: [] })
  assert.equal(patch.seasons_count, undefined)
  assert.equal(patch.seasons_total, undefined)
})

test('une fiche sans la migration ne prétend pas mémoriser une décision', () => {
  const item = row(); delete item.metadata_preferences
  assert.throws(() => requireDecisionStorage(item), /migration/)
  assert.doesNotThrow(() => requireDecisionStorage(row()))
})

function client(live, { conflict = false } = {}) {
  const writes = []
  return { writes, from() {
    let patch, condition
    const query = {
      update(value) { patch = value; writes.push(value); return query },
      eq(field, value) { if (field === 'updated_at') condition = value; return query },
      select() { return query },
      async maybeSingle() { return { data: patch ? conflict ? null : { ...live, ...patch } : live, error: null } },
      async single() { return { data: { ...live, ...patch }, error: null } },
    }
    return query
  } }
}

test('une complétion lancée avant un arbitrage ne remplace pas la nouvelle décision', async () => {
  const stale = row()
  database = client(row({ metadata_preferences: acceptedPreferences(row(), candidate), updated_at: 'v2' }))
  const result = await applyCompletion(stale, { poster_url: 'https://example.com/old.jpg', sources: [] })
  assert.equal(result.updated, 0)
  assert.equal(database.writes.length, 0)
})

test('une écriture concurrente détectée ne perd pas les changements de la fiche', async () => {
  const item = row({ updated_at: 'v1', year: null })
  database = client(item, { conflict: true })
  await assert.rejects(applyCompletion(item, { year: 2002, sources: [] }), /changé pendant/)
})

test('une ancienne réponse réseau ne retire pas la validation plus récente déjà affichée', () => {
  const confirmed = row({ updated_at: '2026-10-17T12:00:02Z', metadata_preferences: { title: 'NARUTO' } })
  const stale = row({ updated_at: '2026-10-17T12:00:01Z' })
  const rows = applyCatalogRows([confirmed], [stale])
  assert.equal(rows[0].metadata_preferences.title, 'NARUTO')
  assert.equal(suggestTitle(rows[0]), null)
})

test('la saisie manuelle enregistre le vrai nouveau titre, sa validation et la quantité de saisons', async () => {
  const item = row()
  const db = client(item)
  await saveCatalogItem(db, { ...item, title: 'Mon titre personnalisé', seasons_count: 20 }, item.id, [item], () => {}, () => true, true)
  assert.equal(db.writes[0].title, 'Mon titre personnalisé')
  assert.equal(db.writes[0].title_key, titleKey('anime', 'anime', 'Mon titre personnalisé'))
  assert.equal(db.writes[0].metadata_preferences.title, 'Mon titre personnalisé')
  assert.equal(db.writes[0].metadata_preferences.seasons_manual, 20)
})

test('modifier la quantité ne réactive pas une correspondance précédemment refusée', async () => {
  const item = row({ metadata_preferences: { rejected: true } })
  const db = client(item)
  await saveCatalogItem(db, { ...item, seasons_count: 20 }, item.id, [item], () => {}, () => true, true)
  assert.equal(db.writes[0].metadata_preferences.rejected, true)
  assert.equal(db.writes[0].metadata_preferences.match, undefined)
})

test('le format collection est enregistré sans effacer les décisions et peut être retiré manuellement', async () => {
  const item = row({ metadata_preferences: { title: 'NARUTO', seasons_reference: { count: 2, locked: true }, seasons_quantity_mode: 'commercial-total' } })
  const db = client(item)
  await saveCatalogItem(db, { ...item, metadata_preferences: { content_kind: 'episode-collection' } }, item.id, [item], () => {}, () => true, true)
  assert.equal(db.writes[0].metadata_preferences.content_kind, 'episode-collection')
  assert.equal(db.writes[0].metadata_preferences.seasons_reference.count, 2)
  assert.equal(db.writes[0].metadata_preferences.seasons_quantity_mode, undefined)
  assert.equal(db.writes[0].seasons_count, 1)
  assert.equal(db.writes[0].available_seasons, null)
  const collection = { ...item, metadata_preferences: db.writes[0].metadata_preferences }
  const nextDb = client(collection)
  const queuedInput = JSON.parse(JSON.stringify({ ...collection, metadata_preferences: { content_kind: null } }))
  await saveCatalogItem(nextDb, queuedInput, collection.id, [collection], () => {}, () => true, true)
  assert.equal(nextDb.writes[0].metadata_preferences.content_kind, undefined)
  assert.equal(nextDb.writes[0].metadata_preferences.seasons_reference.count, 2)
})

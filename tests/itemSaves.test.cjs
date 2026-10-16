const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { ItemSaveQueue } = require('../src/admin/itemSaveQueue.ts')
const { saveCatalogItem, cleanItemInput, itemWriteLocks } = require('../src/admin/saveCatalogItem.ts')
const { applyCatalogRows, reconcileCatalogRows, confirmedCatalogItem } = require('../src/catalogMutations.ts')
const { titleKey } = require('../src/types.ts')
const input = (title, extra = {}) => ({ category: 'anime', media_type: 'anime', media_format: null, title, title_key: titleKey('anime', 'anime', title), synopsis: 'Description', poster_url: null, genres: ['Action'], year: 2010, source: 'manual', source_id: null, source_url: null, active: true, seasons_count: 2, game_size_gb: null, ...extra })
const row = (id, extra = {}) => ({ id, ...input(id), ...extra })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = () => new Promise(resolve => setImmediate(resolve))

test('deux fiches s’enregistrent en parallèle, avec une troisième en attente et des résultats indépendants', async () => {
  const operations = new Map(), notices = []
  const queue = new ItemSaveQueue({ owner: () => 'admin', notify: text => notices.push(text), save: job => { const task = deferred(); operations.set(job.input.title, task); return task.promise } })
  const a = queue.enqueue(input('A'), 'a'), b = queue.enqueue(input('B'), 'b'), c = queue.enqueue(input('C'), 'c')
  assert.equal(operations.size, 2)
  assert.equal(queue.snapshot().find(job => job.key === c).status, 'queued')
  operations.get('B').resolve()
  await settle()
  assert.equal(queue.snapshot().find(job => job.key === b).status, 'saved')
  assert.equal(queue.snapshot().find(job => job.key === a).status, 'saving')
  assert.ok(operations.has('C'))
  operations.get('A').reject(new Error('Connexion interrompue'))
  operations.get('C').resolve()
  await settle()
  assert.equal(queue.snapshot().find(job => job.key === a).error, 'Connexion interrompue')
  assert.equal(queue.snapshot().find(job => job.key === c).status, 'saved')
  assert.ok(notices.some(text => text.includes('« B »') && text.includes('enregistrée')))
  assert.ok(notices.some(text => text.includes('« A »') && text.includes('échec')))
})

test('un formulaire modifié et un changement de vue ne changent pas la copie en cours d’enregistrement', async () => {
  const task = deferred(), original = input('Naruto'), seen = []
  const queue = new ItemSaveQueue({ owner: () => 'admin', notify() {}, save: async job => { await task.promise; seen.push(job.input) } })
  const unsubscribe = queue.subscribe(() => {})
  queue.enqueue(original, 'naruto')
  original.title = 'One Piece'; original.genres.push('Comédie'); original.seasons_count = 22
  unsubscribe() // L'écran d'édition est démonté ; l'opération reste dans l'application.
  task.resolve(); await settle()
  assert.equal(seen[0].title, 'Naruto')
  assert.deepEqual(seen[0].genres, ['Action'])
  assert.equal(seen[0].seasons_count, 2)
})

test('les sauvegardes qui ciblent la même fiche ou une fusion sont sérialisées sans bloquer les autres', async () => {
  const operations = []
  const queue = new ItemSaveQueue({ owner: () => 'admin', notify() {}, save: job => { const task = deferred(); operations.push({ title: job.input.title, task }); return task.promise } })
  queue.enqueue(input('Fusion'), 'ancien', ['id:cible'])
  queue.enqueue(input('Autre édition de la cible'), 'cible')
  queue.enqueue(input('Indépendante'), 'autre')
  assert.deepEqual(operations.map(entry => entry.title), ['Fusion', 'Indépendante'])
  operations[0].task.resolve(); await settle()
  assert.equal(operations[2].title, 'Autre édition de la cible')
  operations[1].task.resolve(); operations[2].task.resolve(); await settle()
})

test('un échec conserve la saisie et peut être relancé sans réenregistrer les autres fiches', async () => {
  let attempts = 0
  const queue = new ItemSaveQueue({ owner: () => 'admin', notify() {}, save: async job => { assert.equal(job.input.seasons_count, 20); if (++attempts === 1) throw new Error('Hors ligne') } })
  const key = queue.enqueue(input('Naruto', { seasons_count: 20 }), 'naruto')
  await settle()
  assert.equal(queue.snapshot()[0].status, 'failed')
  queue.retry(key); await settle()
  assert.equal(attempts, 2)
  assert.equal(queue.snapshot()[0].status, 'saved')
})

test('les tâches d’une ancienne session ne sont pas lancées sous un autre compte', async () => {
  let owner = 'admin:1'
  const operations = []
  const queue = new ItemSaveQueue({ owner: () => owner, notify() {}, save: job => { const task = deferred(); operations.push({ job, task }); return task.promise } })
  queue.enqueue(input('A')); queue.enqueue(input('B')); queue.enqueue(input('C'))
  owner = 'admin:2'
  operations[0].task.resolve(); operations[1].task.resolve(); await settle()
  assert.equal(operations.length, 2)
  assert.equal(queue.snapshot().find(job => job.input.title === 'C').status, 'queued')
})

test('un ancien chargement ne rétablit ni une ancienne saisie, ni une fiche supprimée par fusion', () => {
  const saved = row('A', { seasons_count: 20 })
  const mutations = new Map([['A', { sequence: 2, item: saved }], ['doublon', { sequence: 3, item: null }]])
  const reconciled = reconcileCatalogRows([row('A'), row('B'), row('doublon')], mutations, 1)
  assert.equal(reconciled.find(item => item.id === 'A').seasons_count, 20)
  assert.ok(reconciled.some(item => item.id === 'B'))
  assert.ok(!reconciled.some(item => item.id === 'doublon'))
  assert.equal(reconcileCatalogRows([row('A', { seasons_count: 22 })], mutations, 3)[0].seasons_count, 22)
  assert.deepEqual(applyCatalogRows([row('A'), row('B')], [saved], ['B']).map(item => item.id), ['A'])
})

test('un enrichissement tardif ne remplace pas les autres champs ni une affiche déjà changée', () => {
  const current = row('A', { seasons_count: 20, poster_url: 'https://example.com/old.jpg' })
  const oldResponse = row('A', { seasons_count: 2, poster_url: 'https://example.com/cache.jpg' })
  const updated = confirmedCatalogItem([current], oldResponse, 'poster_url', current.poster_url)
  assert.equal(updated.seasons_count, 20)
  assert.equal(updated.poster_url, oldResponse.poster_url)
  assert.equal(confirmedCatalogItem([{ ...current, poster_url: 'https://example.com/manual.jpg' }], oldResponse, 'poster_url', current.poster_url), null)
  assert.equal(confirmedCatalogItem([], oldResponse, 'poster_url', current.poster_url), null)
})

function fakeClient(response, deletion = { data: { id: 'ancien' }, error: null }) {
  const writes = []
  return { writes, from(table) {
    assert.equal(table, 'catalog_items')
    const query = { eq(field, value) { writes.at(-1).where = [field, value]; return query }, select(fields) { writes.at(-1).select = fields; return query }, single: async () => response, maybeSingle: async () => deletion }
    return { update(payload) { writes.push({ action: 'update', payload }); return query }, insert(payload) { writes.push({ action: 'insert', payload }); return query }, delete() { writes.push({ action: 'delete' }); return query } }
  } }
}

test('la sauvegarde utilise la fiche confirmée par Supabase et ne recharge pas le catalogue', async () => {
  const confirmed = row('A', { year: 2011 }), client = fakeClient({ data: confirmed, error: null }), commits = []
  const result = await saveCatalogItem(client, input('A'), 'A', [row('A')], change => commits.push(change))
  assert.equal(result, confirmed)
  assert.equal(client.writes.length, 1)
  assert.equal(client.writes[0].select, '*')
  assert.equal(commits[0].item.year, 2011)
})

test('une réponse refusée par Supabase ne valide aucune modification locale', async () => {
  const client = fakeClient({ data: null, error: { code: '42501', message: 'Accès refusé' } }), commits = []
  await assert.rejects(saveCatalogItem(client, input('A'), 'A', [row('A')], change => commits.push(change)), /droits administrateur/)
  assert.equal(commits.length, 0)
})

test('une fusion ne retire localement l’ancienne fiche qu’après confirmation de sa suppression', async () => {
  const target = row('cible', { source: 'jikan-anime', source_id: '123' }), old = row('ancien')
  const client = fakeClient({ data: target, error: null }, { data: null, error: { message: 'Suppression refusée' } }), commits = []
  await assert.rejects(saveCatalogItem(client, input('ancien', { source: 'jikan-anime', source_id: '123' }), old.id, [old, target], change => commits.push(change)), /ancienne fiche/)
  assert.equal(client.writes[0].where[1], 'cible')
  assert.equal(client.writes[1].where[1], 'ancien')
  assert.equal(commits.length, 1)
  assert.deepEqual(commits[0].removedIds, [])
})

test('les verrous reconnaissent les variantes de titre et les saisies gardent uniquement les colonnes autorisées', () => {
  const a = itemWriteLocks([], input('SK8')), b = itemWriteLocks([], input('SK8 [ADN]'))
  assert.ok(a.some(lock => b.includes(lock)))
  const cleaned = cleanItemInput({ ...input(' A '), id: 'interdit', match: 'exact', aliases: ['A'], poster_url: 'javascript:alert(1)' })
  assert.equal(cleaned.title, 'A')
  assert.equal(cleaned.poster_url, null)
  for (const key of ['id', 'match', 'aliases']) assert.ok(!(key in cleaned))
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { BROWSE_PAGE_SIZE, CATALOG_PAGE_SIZE, fetchCatalogPages, filterDemoCatalog } = require('../src/catalogData.ts')

test('la catégorie courte est chargée en une requête avec son compte exact', async () => {
  const calls = []
  const rows = Array.from({ length: 73 }, (_, id) => ({ id: String(id) }))
  const result = await fetchCatalogPages(async (...args) => { calls.push(args); return { data: rows, count: rows.length, error: null } })
  assert.equal(result.length, 73)
  assert.deepEqual(calls, [[0, CATALOG_PAGE_SIZE - 1, true]])
})

test('le chargement prend toutes les pages au-delà de 1 000 fiches sans recompter à chaque page', async () => {
  const calls = []
  const result = await fetchCatalogPages(async (from, to, withCount) => {
    calls.push({ from, to, withCount })
    return { data: Array.from({ length: Math.min(to - from + 1, 1013 - from) }, (_, index) => ({ id: String(from + index) })), count: withCount ? 1013 : null, error: null }
  })
  assert.equal(result.length, 1013)
  assert.deepEqual(calls, [{ from: 0, to: 499, withCount: true }, { from: 500, to: 999, withCount: false }, { from: 1000, to: 1499, withCount: false }])
})

test('les doublons sont dédupliqués et une page en erreur ne renvoie jamais un catalogue partiel', async () => {
  const rows = await fetchCatalogPages(async (from) => ({ data: from === 0 ? [{ id: 'same' }] : [{ id: 'same' }, { id: 'last' }], count: from === 0 ? 2 : null, error: null }))
  assert.deepEqual(rows.map(row => row.id), ['same', 'last'])
  await assert.rejects(() => fetchCatalogPages(async from => from === 0
    ? { data: Array.from({ length: 500 }, (_, id) => ({ id: String(id) })), count: 501, error: null }
    : { data: null, count: null, error: { message: 'Lecture interrompue' } }), /Lecture interrompue/)
})

test('la pagination de démonstration filtre avant de découper la page et garde les compteurs globaux', () => {
  const items = Array.from({ length: 61 }, (_, index) => ({
    id: String(index), category: 'anime', active: true, media_type: 'anime', media_format: index % 2 ? 'film' : 'series',
    title: `Titre ${String(index).padStart(2, '0')}`, genres: [index % 2 ? 'Aventure' : 'Action'], year: 2020 + index % 3,
    seasons_count: index % 2 ? null : 2, game_size_gb: null,
  }))
  const result = filterDemoCatalog(items, { category: 'anime', page: 2, query: '', genre: '', year: '', origin: '', format: '', sort: 'az', byYear: false })
  assert.equal(result.total, 61)
  assert.equal(result.items.length, BROWSE_PAGE_SIZE)
  assert.equal(result.items[0].title, 'Titre 24')
  assert.deepEqual(result.years, [2022, 2021, 2020])
  assert.equal(result.summary.seasons, 62)
  const films = filterDemoCatalog(items, { category: 'anime', page: 1, query: '', genre: '', year: '', origin: '', format: 'film', sort: 'recent', byYear: false })
  assert.equal(films.total, 30)
})

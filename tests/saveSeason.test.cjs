const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const { saveSeason } = require('../src/admin/saveSeason.ts')
const season = { item_id: 'title-id', number: 3, title: ' Saison nommée ', synopsis: ' Description propre ', poster_url: 'https://images.test/s3.jpg', year: 2020, source: 'manual', source_id: null, source_url: null, manual: false, updated_at: '2026-10-21T12:00:00Z' }

test('l’édition de saison transmet sa version et reçoit ensemble la saison et la disponibilité du parent', async () => {
  const item = { id: 'title-id', seasons_count: 3, available_seasons: [2, 3, 4] }
  const result = await saveSeason({ rpc(name, args) {
    assert.equal(name, 'save_catalog_season')
    assert.equal(args.p_expected_updated_at, season.updated_at)
    assert.equal(args.p_values.synopsis, 'Description propre')
    assert.equal(args.p_values.title, 'Saison nommée')
    assert.equal(args.p_values.manual, undefined)
    return { abortSignal: async () => ({ data: { item, season }, error: null }) }
  } }, season)
  assert.equal(result.item, item)
  assert.equal(result.season, season)
})

test('une saison invalide ne part pas en sauvegarde et un conflit ne devient pas un faux succès', async () => {
  const forbidden = { rpc() { assert.fail('Aucun enregistrement invalide') } }
  for (const patch of [{ number: 0 }, { number: 2.5 }, { poster_url: 'javascript:alert(1)' }, { year: 1800 }]) await assert.rejects(saveSeason(forbidden, { ...season, ...patch }))
  await assert.rejects(saveSeason({ rpc() { return { abortSignal: async () => ({ data: null, error: { code: '40001' } }) } } }, season), /a changé/)
})

test('ajouter une saison sans description ni affiche garde les champs facultatifs vides et le nom par défaut', async () => {
  await saveSeason({ rpc(name, args) {
    assert.equal(args.p_values.title, 'Saison 4')
    assert.equal(args.p_values.synopsis, null)
    assert.equal(args.p_values.poster_url, null)
    return { abortSignal: async () => ({ data: { item: { id: 'title-id' }, season: { ...season, number: 4 } }, error: null }) }
  } }, { ...season, number: 4, title: ' ', synopsis: '', poster_url: '', year: null, updated_at: undefined })
})

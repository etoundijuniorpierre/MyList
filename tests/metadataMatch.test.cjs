const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { titleVariants, buildCandidates, pickCandidate } = require('../src/metadataMatch.ts')

const item = (overrides) => ({ category: 'anime', media_format: null, year: null, ...overrides })
const result = (title, overrides = {}) => ({
  category: 'anime', media_type: 'anime', media_format: 'series', title, title_key: title, synopsis: 'Une description suffisamment longue pour être retenue.',
  poster_url: 'https://s4.anilist.co/poster.jpg', genres: ['Action'], year: 2012, source: 'anilist', source_id: title, source_url: 'https://anilist.co/anime/1',
  active: true, seasons_count: null, game_size_gb: null, match: 'approximate', ...overrides,
})
const decide = (title, results, extra = {}) => {
  const fiche = item({ title, ...extra })
  const candidates = buildCandidates(fiche, results, titleVariants(title))
  return { candidates, picked: pickCandidate(candidates) }
}

test('les variantes retirent sous-titres, mots tronqués et doublons de titre', () => {
  assert.deepEqual(titleVariants('Cowboy Bebop 1998 Remast'), ['Cowboy Bebop 1998', 'Cowboy Bebop'])
  assert.ok(titleVariants('Canaan, tueuses nées').includes('Canaan'))
  assert.ok(titleVariants("The King's Avatar (Quanzhi Gaoshou)").includes("The King's Avatar"))
  assert.ok(titleVariants('Uchuu Kyoudai - Space Brother').includes('Space Brother'))
})

test('une œuvre unique et très ressemblante est appliquée automatiquement', () => {
  assert.equal(decide('Cowboy Bebop 1998 Remast', [result('Cowboy Bebop', { year: 1998 }), result('Cowboy Bebop: Tengoku no Tobira', { media_format: 'film', year: 2001 })]).picked?.title, 'Cowboy Bebop')
  assert.equal(decide('Canaan, tueuses nées', [result('Canaan', { year: 2009 }), result('Canaan: Minorikawa Report', { year: 2010 })]).picked?.title, 'Canaan')
  assert.equal(decide('Uchuu Kyoudai - Space Brother', [result('Space Brothers', { year: 2012, aliases: ['Uchuu Kyoudai', 'Space Brothers'] }), result('Uchuu Kyoudai: Number Zero', { media_format: 'film', year: 2014 })]).picked?.title, 'Space Brothers')
})

test('le titre japonais du dossier retrouve l’œuvre grâce aux titres alternatifs de la source', () => {
  const { picked } = decide('Kujira No Kora Wa Sajou Ni Utau', [result('Children of the Whales', { year: 2017, aliases: ['Kujira no Kora wa Sajou ni Utau', 'Children of the Whales'] })])
  assert.equal(picked?.title, 'Children of the Whales')
})

test('plusieurs versions homonymes ou un format différent partent en arbitrage', () => {
  const yuyu = decide('Yuyu Hakusho', [result('Yu Yu Hakusho', { year: 1992, match: 'exact' }), result('Yu Yu Hakusho', { year: 2009, match: 'exact', source: 'kitsu', source_id: 'drama' })])
  assert.equal(yuyu.picked, null)
  assert.equal(yuyu.candidates.length, 2)
  const gridman = decide('Gridman Universe', [result('Gridman Universe', { media_format: 'film', year: 2023, match: 'exact' })], { year: 2023 })
  assert.equal(gridman.picked, null)
  assert.match(gridman.candidates[0].notes[0], /Film/)
})

test('les sources qui décrivent la même œuvre sont fusionnées en un seul candidat', () => {
  const { candidates } = decide('Koi Kaze', [
    result('Koi Kaze', { year: 2004, source: 'kitsu', poster_url: null, genres: [] }),
    result('Koi Kaze', { year: 2004, source: 'anilist', synopsis: null }),
  ])
  assert.equal(candidates.length, 1)
  assert.deepEqual(candidates[0].sources.sort(), ['anilist', 'kitsu'])
  assert.ok(candidates[0].poster_url && candidates[0].synopsis && candidates[0].genres.length)
})

test('un numéro d’opus n’est jamais retiré et une variante tronquée ne décide jamais seule', () => {
  assert.equal(titleVariants('Street Fighter 2V').includes('Street Fighter'), false)
  assert.equal(decide('Street Fighter 2V', [result('Street Fighter', { year: 1995 })]).picked, null)
  // Le film Haikyu!! est bien la bonne œuvre, mais la fiche est une série : l'administrateur confirme le changement de format.
  const haikyu = decide('HAIKYU The Dumpster Battle p', [result('Haikyu!! The Dumpster Battle', { year: 2024, media_format: 'film' })])
  assert.equal(haikyu.picked, null)
  assert.equal(haikyu.candidates[0].title, 'Haikyu!! The Dumpster Battle')
  assert.match(haikyu.candidates[0].notes[0], /Film/)
})

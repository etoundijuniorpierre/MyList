const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { mergeMetadataResults } = require('../src/metadataMerge.ts')

function match(source, posterUrl, genres = [], matchedAs = 'approximate') {
  return {
    category: 'anime', media_type: 'anime', title: 'Fullmetal Alchemist: Brotherhood',
    title_key: 'anime:anime:fullmetal alchemist brotherhood', synopsis: null,
    poster_url: posterUrl, genres, year: 2009, source, source_id: source,
    source_url: `https://${source}.example/anime`, active: true,
    seasons_count: null, game_size_gb: null, match: matchedAs,
  }
}

test('une affiche exacte d’AniList complète une fiche TheTVDB sans image', () => {
  const result = mergeMetadataResults(
    [match('tvdb', null, ['Action'])],
    [match('anilist', 'https://s4.anilist.co/cover.jpg', ['Adventure'], 'exact')],
  )[0]
  assert.equal(result.poster_url, 'https://s4.anilist.co/cover.jpg')
  assert.equal(result.source, 'anilist')
  assert.equal(result.source_id, 'anilist')
  assert.deepEqual(result.genres, ['Action'])
  assert.equal(result.match, 'exact')
})

test('une affiche déjà présente n’est pas remplacée par une autre source', () => {
  const result = mergeMetadataResults(
    [match('tvdb', 'https://tvdb.example/cover.jpg')],
    [match('anilist', 'https://s4.anilist.co/cover.jpg', [], 'exact')],
  )[0]
  assert.equal(result.poster_url, 'https://tvdb.example/cover.jpg')
  assert.equal(result.source, 'tvdb')
  assert.equal(result.match, 'exact')
})

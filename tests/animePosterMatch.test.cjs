const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { selectAnimePoster } = require('../src/animePosterMatch.ts')

function match(title, year, format, source = 'anilist', poster = 'https://s4.anilist.co/cover.jpg') {
  return { category: 'anime', media_format: format, title, year, source, match: 'exact', poster_url: poster }
}

test('un film ne reçoit jamais l’affiche de sa série homonyme', () => {
  const film = { title: 'Your Name', year: 2016, media_format: 'film' }
  const series = match('Your Name', 2016, 'series')
  const movie = match('Your Name', 2016, 'film', 'jikan-anime', 'https://cdn.myanimelist.net/film.jpg')
  assert.equal(selectAnimePoster(film, [series, movie]), movie)
  assert.equal(selectAnimePoster(film, [series]), null)
})

test('une saison et un film de même titre restent séparés', () => {
  const series = { title: 'Code Geass', year: 2006, media_format: null }
  assert.equal(selectAnimePoster(series, [match('Code Geass', 2006, 'film')]), null)
  assert.ok(selectAnimePoster(series, [match('Code Geass', 2006, 'series')]))
})

test('les années incompatibles et les œuvres homonymes restent sans association automatique', () => {
  const item = { title: 'Escape', year: 2018, media_format: null }
  assert.equal(selectAnimePoster(item, [match('Escape', 2024, 'series')]), null)
  assert.equal(selectAnimePoster({ ...item, year: null }, [match('Escape', 2018, 'series'), match('Escape', 2024, 'series')]), null)
  assert.equal(selectAnimePoster({ title: 'Escape', year: 2018, media_format: 'series' }, [match('Escape', null, 'series')]), null)
  assert.equal(selectAnimePoster({ title: 'Escape', year: 2018, media_format: 'series' }, [match('Escape', 2018, null)]), null)
})

test('une affiche trouvée par alias est retenue quand elle est la seule correspondance exacte', () => {
  const item = { title: 'Le Château ambulant', year: 2004, media_format: 'film' }
  const alias = match('Howl’s Moving Castle', 2004, 'film')
  assert.equal(selectAnimePoster(item, [alias]), alias)
  assert.equal(selectAnimePoster(item, [{ ...alias, poster_url: 'http://example.com/image.jpg' }]), null)
})

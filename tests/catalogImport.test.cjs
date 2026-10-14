const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { catalogIdentity, isCatalogNoiseTitle, mergeCatalogUpdate, sameCatalogTitle, scannedItemInput, unmatchedAnime } = require('../src/catalogImport.ts')
const { normalizeSources } = require('../scripts/import-pdf-catalog.cjs')

test('une fiche anime sans résultat externe reste importable sans affiche', () => {
  const item = unmatchedAnime('  Fullmetal Alchemist  ')
  assert.equal(item.title, 'Fullmetal Alchemist')
  assert.equal(item.category, 'anime')
  assert.equal(item.media_type, 'anime')
  assert.equal(item.poster_url, null)
  assert.equal(item.seasons_count, null)
})

test('les variantes de distribution et les faux titres de compteur ne créent pas de doublons', () => {
  assert.equal(catalogIdentity('anime', 'anime', 'All Out [ADN]'), catalogIdentity('anime', 'anime', 'All Out'))
  assert.equal(sameCatalogTitle(
    { category: 'anime', media_type: 'anime', title: 'SK8 [Crunchyroll]' },
    { category: 'anime', media_type: 'anime', title: 'SK8' },
  ), true)
  assert.notEqual(catalogIdentity('anime', 'anime', 'Kingdom'), catalogIdentity('series', null, 'Kingdom'))
  assert.equal(isCatalogNoiseTitle('[2 Fichiers]'), true)
  const imported = normalizeSources([
    { title: 'All Out', category: 'anime', media_type: 'anime', seasons_count: 1, source_file: 'one.pdf' },
    { title: 'All Out [ADN]', category: 'anime', media_type: 'anime', seasons_count: 2, source_file: 'two.pdf' },
    { title: '[2 Fichiers]', category: 'anime', media_type: 'anime', seasons_count: 1, source_file: 'two.pdf' },
  ])
  assert.equal(imported.length, 1)
  assert.equal(imported[0].title, 'All Out')
  assert.equal(imported[0].seasons_count, 2)
})

test('un scan met à jour les saisons connues sans effacer les données déjà présentes', () => {
  const existing = {
    id: '1', category: 'anime', media_type: 'anime', title: 'Naruto', title_key: 'anime:anime:naruto',
    synopsis: 'Description', poster_url: 'https://example.com/poster.jpg', genres: ['Action'], year: 2002,
    source: 'jikan-anime', source_id: '20', source_url: 'https://example.com/anime/20', active: true,
    seasons_count: 5, game_size_gb: null,
  }
  const row = {
    id: 'scan-1', title: 'naruto', category: 'anime', media_type: 'anime', seasons_count: 6,
    game_size_gb: null, file_count: 30, path: 'E:\\Anime\\Naruto', selected: true, warning: null,
  }
  const updated = scannedItemInput(row, existing)
  assert.equal(updated.title_key, existing.title_key)
  assert.equal(updated.seasons_count, 6)
  assert.equal(updated.poster_url, existing.poster_url)
  assert.equal(updated.synopsis, existing.synopsis)
  assert.deepEqual(updated.genres, existing.genres)
  const noSeasonInfo = scannedItemInput({ ...row, warning: 'Saison non indiquée' }, existing)
  assert.equal(noSeasonInfo.seasons_count, 5)
})

test('une modification partielle conserve les métadonnées et applique les nouvelles valeurs fournies', () => {
  const existing = {
    id: '2', category: 'anime', media_type: 'anime', title: 'Blue Miburo', title_key: 'anime:anime:blue miburo',
    synopsis: 'Description existante', poster_url: 'https://example.com/cover.jpg', genres: ['Action'], year: 2024,
    source: 'jikan-anime', source_id: '10', source_url: 'https://example.com/anime/10', active: true,
    seasons_count: 1, game_size_gb: null,
  }
  const blankUpdate = {
    ...existing, title: 'Blue Miburo', synopsis: null, poster_url: null, genres: [], year: null,
    source: 'manual', source_id: null, source_url: null, seasons_count: null,
  }
  const preserved = mergeCatalogUpdate(blankUpdate, existing)
  assert.equal(preserved.poster_url, existing.poster_url)
  assert.equal(preserved.synopsis, existing.synopsis)
  assert.deepEqual(preserved.genres, ['Action'])
  assert.equal(preserved.seasons_count, 1)
  assert.equal(preserved.source_id, '10')

  const corrected = mergeCatalogUpdate({ ...blankUpdate, seasons_count: 2, year: 2025 }, existing)
  assert.equal(corrected.seasons_count, 2)
  assert.equal(corrected.year, 2025)
})

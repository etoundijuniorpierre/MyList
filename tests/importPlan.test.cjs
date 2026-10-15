const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { planScanImport } = require('../src/catalogImport.ts')
const { scanFolder, classifySubfolder, cleanTitle } = require('../src/folderScan.ts')
const { suggestTitle, probableDuplicates } = require('../src/titleHealth.ts')

const file = (path, size = 1e8) => ({ name: path.split('/').at(-1), size, webkitRelativePath: path })
const existing = (overrides) => ({
  id: overrides.id ?? 'x', category: 'anime', media_type: 'anime', media_format: 'series', title: 'Titre', title_key: 'k',
  synopsis: null, poster_url: null, genres: [], year: null, source: 'scan', source_id: null, source_url: null,
  active: true, seasons_count: 1, game_size_gb: null, ...overrides,
})

test('un disque qui ne contient que la saison 4 ne réduit pas une fiche de 5 saisons', () => {
  const rows = scanFolder([file('HIVER 2026/Dr.Stone.S04/Dr.Stone.S04E01.mkv'), file('HIVER 2026/Dr.Stone.S04/Dr.Stone.S04E02.mkv')])
  assert.equal(rows[0].seasons_count, 4)
  const [kept] = planScanImport(rows, [existing({ id: 'a', title: 'Dr Stone', seasons_count: 5 })])
  assert.equal(kept.status, 'unchanged')
  assert.equal(kept.input.seasons_count, 5)
  const [raised] = planScanImport(rows, [existing({ id: 'a', title: 'Dr Stone', seasons_count: 3 })])
  assert.equal(raised.status, 'update')
  assert.deepEqual(raised.changes, ['Saisons 3 → 4'])
})

test('une fiche au titre sale en base est reconnue au lieu de créer un doublon', () => {
  const rows = scanFolder([file('Series/Scrubs/Saison 1/e1.mkv'), file('Series/Scrubs/Saison 9/e1.mkv')])
  const [entry] = planScanImport(rows, [existing({ id: 's', category: 'series', media_type: null, media_format: null, title: 'SCRUBS (9)', seasons_count: 9 })])
  assert.equal(entry.existing.id, 's')
  assert.equal(entry.status, 'unchanged')
})

test('le titre lu dans les fichiers sert à retrouver une fiche existante', () => {
  const rows = scanFolder([
    file('ANIMES/Amagami-san Chi no Enmusubi/Tying.the.Knot.with.an.Amagami.Sister.S01E01.mkv'),
    file('ANIMES/Amagami-san Chi no Enmusubi/Tying.the.Knot.with.an.Amagami.Sister.S01E02.mkv'),
  ])
  assert.equal(rows[0].alt_title, 'Tying the Knot with an Amagami Sister')
  const [entry] = planScanImport(rows, [existing({ id: 't', title: 'Tying the Knot with an Amagami Sister', seasons_count: 1 })])
  assert.equal(entry.existing.id, 't')
})

test('les sous-dossiers de saisons, suites nommées et variantes de langue sont comptés correctement', () => {
  assert.equal(classifySubfolder('Noragami', '[Nora] Noragami S01 VOSTFR [BDRip]'), 1)
  assert.equal(classifySubfolder('Noragami', '[Nora] Noragami Aragoto VOSTFR [BD 1080p]'), null)
  assert.equal(classifySubfolder('Youjo Senki', 'Youjo Senki VF'), 'variant')
  assert.equal(classifySubfolder('Psycho Pass', 'PSYCHO-PASS 3'), 3)
  assert.equal(classifySubfolder('Hunter x Hunter 2011', 'Hunter X Hunter 2011 BOX 04 MULTI DVDRIP'), 'skip')
  assert.equal(classifySubfolder('JoJo', '2. Stardust Crusaders'), 2)
  const rows = scanFolder([
    file('ANIMES/Noragami/[Nora] Noragami S01 VOSTFR/Noragami - 01.mkv'),
    file('ANIMES/Noragami/[Nora] Noragami Aragoto VOSTFR/Noragami Aragoto - 01.mkv'),
    file('ANIMES/Freezing/Freezing NC/Freezing 01.mp4'),
    file('ANIMES/Freezing/Freezing Vibration/Freezing Vibration 01.mp4'),
    file('ANIMES/Freezing/OAV/Freezing SP1.mp4'),
  ])
  assert.deepEqual(rows.filter((row) => row.media_format === 'series').map((row) => [row.title, row.seasons_count]), [['Noragami', 2], ['Freezing', 2]])
})

test('un dossier de franchise devient une fiche par œuvre', () => {
  const rows = scanFolder([
    file('ANIMES/toaru SAGA/To Aru Majutsu no Index I/Index - 01.mkv'),
    file('ANIMES/toaru SAGA/To Aru Majutsu no Index II/Index II - 01.mkv'),
    file('ANIMES/toaru SAGA/Toaru Kagaku no Railgun T/Railgun T - 01.mkv'),
  ])
  assert.deepEqual(rows.map((row) => [row.title, row.seasons_count]).sort(), [['To Aru Majutsu no Index', 2], ['Toaru Kagaku no Railgun T', 1]])
})

test('une saga rangée par ordre de visionnage donne une fiche par œuvre, pas des saisons', () => {
  const rows = scanFolder([
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/1-Mobile Suit Gundam The Origin/Mobile Suit Gundam The origin Episode 1.mp4'),
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/1-Mobile Suit Gundam The Origin/Mobile Suit Gundam The origin Episode 2.mp4'),
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/10-Mobile Suit Gundam Wing/Mobile Suit Gundam Wing - 01 VOSTFR.mp4'),
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/10-Mobile Suit Gundam Wing/Mobile Suit Gundam Wing - 02 VOSTFR.mp4'),
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/19-Mobile Suit Gundam SEED/Gundam SEED - 01.mkv'),
    file('ANIME MANGA EJEP/animé/Mobile Suit Gundam/19-Mobile Suit Gundam SEED/Gundam SEED - 02.mkv'),
  ])
  assert.deepEqual(rows.map((row) => [row.title, row.seasons_count, row.franchise_of]).sort(), [
    ['Mobile Suit Gundam SEED', 1, 'Mobile Suit Gundam'], ['Mobile Suit Gundam The Origin', 1, 'Mobile Suit Gundam'], ['Mobile Suit Gundam Wing', 1, 'Mobile Suit Gundam'],
  ])
  const saint = scanFolder([
    file('ANIME MANGA EJEP/animé/Saint Seiya Saga/1-Saint Seiya (Les Chevaliers Du Zodiaque)/1--Saint Seiya Le sanctuaire/01.avi'),
    file('ANIME MANGA EJEP/animé/Saint Seiya Saga/1-Saint Seiya (Les Chevaliers Du Zodiaque)/2--Saint Seiya, Hadès Le sanctuaire/01.avi'),
    file('ANIME MANGA EJEP/animé/Saint Seiya Saga/1-Saint Seiya (Les Chevaliers Du Zodiaque)/3--Saint Seiya, Hadès Inferno/01.avi'),
    file('ANIME MANGA EJEP/animé/Saint Seiya Saga/4-Saint Seiya  OMEGA/52 Une nouvelle armure.avi'),
    file('ANIME MANGA EJEP/animé/Saint Seiya Saga/4-Saint Seiya  OMEGA/53 Le retour.avi'),
  ])
  assert.deepEqual(saint.map((row) => [row.title, row.seasons_count]).sort(), [['Saint Seiya (Les Chevaliers Du Zodiaque)', 3], ['Saint Seiya OMEGA', 1]])
})

test('une collection de films devient un film par fichier', () => {
  const rows = scanFolder([
    file('ANIMES/Collection Studio Ghibli/Le Voyage de Chihiro.mkv'),
    file('ANIMES/Collection Studio Ghibli/Mon voisin Totoro.mkv'),
    file('ANIMES/Collection Studio Ghibli/Princesse Mononoke.mkv'),
  ])
  assert.deepEqual(rows.map((row) => [row.title, row.media_format]).sort(), [['Le Voyage de Chihiro', 'film'], ['Mon voisin Totoro', 'film'], ['Princesse Mononoke', 'film']])
})

test('les épisodes rangés en vrac forment une seule fiche', () => {
  const rows = scanFolder([
    file('PAS VUS/Steins Gate 0 22 - Mavanime.mp4'),
    file('PAS VUS/Steins Gate 0 23 - Mavanime.mp4'),
  ])
  assert.deepEqual(rows.map((row) => row.title), ['Steins Gate 0'])
})

test('le nettoyage propose un titre lisible sans casser les vrais titres', () => {
  assert.equal(suggestTitle({ title: 'SCRUBS (9)', seasons_count: null, year: null, category: 'series' }).seasons_count, 9)
  assert.equal(suggestTitle({ title: 'LES PILIERS DE LA TERRE (2)', seasons_count: 2, year: null, category: 'series' }).title, 'Les Piliers de la Terre')
  assert.equal(suggestTitle({ title: 'Gridman Universe (2023)', seasons_count: 1, year: null, category: 'anime' }).year, 2023)
  assert.equal(suggestTitle({ title: 'Blood+', seasons_count: 1, year: null, category: 'anime' }), null)
  assert.equal(suggestTitle({ title: 'FIFA 19', seasons_count: null, year: 2018, category: 'games' }), null)
  assert.equal(cleanTitle('Skip Beat! [1080p x265 HEV'), 'Skip Beat!')
  assert.equal(cleanTitle("L'intégrale de Raconte-moi une histoire"), 'Raconte-moi une histoire')
  const groups = probableDuplicates([existing({ id: '1', title: 'Bleach Integrale' }), existing({ id: '2', title: 'Bleach' }), existing({ id: '3', title: 'Naruto' })])
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [['1', '2']])
})

test('les capitales criées sont adoucies sans casser les apostrophes', () => {
  const { softenCase } = require('../src/titleHealth.ts')
  assert.equal(softenCase("DARWIN'S INCIDENT"), "Darwin's Incident")
  assert.equal(softenCase("CAMERON BLACK L'ILLUSIONNISTE"), "Cameron Black L'Illusionniste")
  assert.equal(softenCase('NCIS LOS ANGELES'), 'NCIS Los Angeles')
})

test('un dossier « Saison 1 » écrit avec une espace insécable compte comme une saison', () => {
  const rows = scanFolder([
    file('ANIMES/Scissor Seven/Saison 1/Scissor Seven_S01E01_Comment devenir riche.mp4'),
    file('ANIMES/Scissor Seven/Saison 2/Scissor Seven_S02E01_Le maitre.mp4'),
    file('ANIMES/Scissor Seven/Saison 3/Scissor Seven_S03E01_Adieu.mp4'),
  ])
  assert.deepEqual(rows.map((row) => [row.title, row.seasons_count]), [['Scissor Seven', 3]])
})

test('la fiche qui regroupait une saga découpée est proposée au masquage, jamais une œuvre mise à jour', () => {
  const { sagaReplacements } = require('../src/catalogImport.ts')
  const rows = scanFolder([
    file('ANIMES/Saint Seiya Saga/2-Saint Seiya  Soul of Gold/1.mkv'),
    file('ANIMES/Saint Seiya Saga/2-Saint Seiya  Soul of Gold/2.mkv'),
    file('ANIMES/Saint Seiya Saga/4-Saint Seiya  OMEGA/52 Une nouvelle armure.avi'),
    file('ANIMES/Saint Seiya Saga/4-Saint Seiya  OMEGA/53 Le retour.avi'),
  ])
  const saga = existing({ id: 'saga', title: 'Saint Seiya Saga', seasons_count: 1 })
  const omega = existing({ id: 'omega', title: 'Saint Seiya OMEGA', seasons_count: 2 })
  const plan = planScanImport(rows, [saga, omega])
  assert.deepEqual(sagaReplacements(rows, [saga, omega], plan).map((item) => item.id), ['saga'])
})

test('les décompositions préremplies reconnaissent les fiches regroupées sans toucher aux vrais titres', () => {
  const { sagaPreset, looksLikeSaga, parseWorks } = require('../src/admin/sagaPresets.ts')
  assert.equal(sagaPreset('Mobile Suit Gundam - Pack - GundamGuy').works.length > 30, true)
  assert.equal(sagaPreset('Mobile Suit Gundam'), null)
  assert.equal(sagaPreset('[29 Fichiers]').works.some((work) => work.title === 'Paprika' && work.format === 'film'), true)
  assert.equal(looksLikeSaga('Excel Saga'), false)
  assert.equal(looksLikeSaga('Vinland Saga'), false)
  assert.equal(looksLikeSaga('toaru SAGA'), true)
  assert.equal(looksLikeSaga('[2 Fichiers]'), true)
  assert.deepEqual(parseWorks('Owarimonogatari ; 2 saisons\nKizumonogatari I ; film\nHanamonogatari'), [
    { title: 'Owarimonogatari', format: 'series', seasons: 2 }, { title: 'Kizumonogatari I', format: 'film', seasons: null }, { title: 'Hanamonogatari', format: 'series', seasons: 1 },
  ])
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { scanFolder, cleanTitle } = require('../src/folderScan.ts')
const file = (path, size) => ({ name: path.split('/').at(-1), webkitRelativePath: path, size })

test('une collection de jeux produit une fiche par sous-dossier et garde chaque taille', () => {
  const result = scanFolder([
    file('Jeux PC/BATTLEFIELD/BATTLEFIELD III/Battlefield 3.iso', 20e9),
    file('Jeux PC/BATTLEFIELD/BATTLEFIELD IV/Battlefield 4.iso', 40e9),
    file('Jeux PC/FAR CRY/FAR CRY 1/Far Cry 1.iso', 3e9),
    file('Jeux PC/FAR CRY/FAR CRY 2/Far Cry 2.iso', 5e9),
  ])
  assert.deepEqual(result.filter((item) => item.selected).map((item) => [item.title, item.game_size_gb]), [
    ['BATTLEFIELD III', 20], ['BATTLEFIELD IV', 40], ['FAR CRY 1', 3], ['FAR CRY 2', 5],
  ])
})

test('le scan de la racine du disque reconnaît aussi les collections imbriquées', () => {
  const result = scanFolder([
    file('E/Jeux PC/ORI/ORI AND THE BLIND FOREST/forest.iso', 4e9),
    file('E/Jeux PC/ORI/ORI AND THE WILL OF THE WISPS/wisps.iso', 6e9),
  ])
  assert.deepEqual(result.filter((item) => item.selected).map((item) => item.title), [
    'ORI AND THE BLIND FOREST', 'ORI AND THE WILL OF THE WISPS',
  ])
})

test('les sous-dossiers techniques restent un seul jeu', () => {
  const result = scanFolder([
    file('Jeux PC/Cyberpunk 2077/bin/game.exe', 2e9),
    file('Jeux PC/Cyberpunk 2077/data/archive.bin', 8e9),
  ])
  assert.equal(result.filter((item) => item.selected).length, 1)
  assert.equal(result[0].title, 'Cyberpunk 2077')
  assert.equal(result[0].game_size_gb, 10)
})

test('un dossier avec des fichiers de jeu directs ne se découpe pas par erreur', () => {
  const result = scanFolder([
    file('Jeux PC/One Game/main.iso', 5e9),
    file('Jeux PC/One Game/Bonus One/bonus.iso', 1e9),
    file('Jeux PC/One Game/Bonus Two/bonus.iso', 1e9),
  ])
  assert.equal(result.filter((item) => item.selected).length, 1)
  assert.equal(result[0].game_size_gb, 7)
})

test('les titres de dossiers bruités sont nettoyés avant la recherche', () => {
  const result = scanFolder([
    file('Series/[ Torrent911 eu ] Blacklist/S01/ep01.mkv', 1e9),
    file('Series/Teen Wolf INTEGRALE BRRip -CHiLL/S01/ep01.mkv', 1e9),
    file('Series/Bandidos S01/ep01.mkv', 1e9),
    file('Jeux PC/tenoke-slitterhead/game.iso', 8e9),
    file('Jeux PC/rune-virtua fighter 5 revo world stage/game.iso', 9e9),
  ])
  const titles = result.map((item) => item.title)
  assert.deepEqual(titles.sort(), [
    'Bandidos', 'Blacklist', 'Teen Wolf', 'slitterhead', 'virtua fighter 5 revo world stage',
  ].sort())
})

test('le suffixe « (2) » du dossier donne le nombre de saisons et quitte le titre', () => {
  const result = scanFolder([
    file('Series/ATLANTA (2)/ep01.mkv', 1e9),
    file('Series/BARBARIENS (1 2)/ep01.mkv', 1e9),
  ])
  assert.deepEqual(result.map((item) => [item.title, item.seasons_count]), [
    ['ATLANTA', 2], ['BARBARIENS', 2],
  ])
})

test('les saisons réellement détectées priment sur le suffixe du dossier', () => {
  const result = scanFolder([
    file('Series/ALIAS (5)/Saison 1/ep01.mkv', 1e9),
    file('Series/ALIAS (5)/Saison 2/ep01.mkv', 1e9),
    file('Series/ALIAS (5)/Saison 3/ep01.mkv', 1e9),
  ])
  assert.equal(result[0].seasons_count, 3)
})

test('les dossiers techniques comme Crack ou Bonuses ne deviennent pas des fiches', () => {
  const result = scanFolder([
    file('Jeux PC/Cyberpunk 2077/Crack/crack.exe', 1e8),
    file('Jeux PC/Cyberpunk 2077/Bonuses/art.bin', 2e8),
    file('Jeux PC/Cyberpunk 2077/bin/game.exe', 9e9),
  ])
  assert.deepEqual(result.map((item) => item.title), ['Cyberpunk 2077'])
})

test('un titre à tiret interne reste intact', () => {
  const result = scanFolder([file('Series/Spider-Man/S01/ep01.mkv', 1e9)])
  assert.equal(result[0].title, 'Spider-Man')
})

test('le nettoyage ne mange pas de mots qui appartiennent au titre', () => {
  assert.equal(cleanTitle('Gears of War Reloaded'), 'Gears of War Reloaded')
  assert.equal(cleanTitle('Spider-Man'), 'Spider-Man')
  assert.equal(cleanTitle('Law & Order - SVU'), 'Law & Order - SVU')
})

test('les mentions de version et d’édition partent en bloc', () => {
  assert.equal(cleanTitle('Horizon Forbidden West Complete Edition'), 'Horizon Forbidden West')
  assert.equal(cleanTitle('Grand Theft Auto IV Complete Edition'), 'Grand Theft Auto IV')
  assert.equal(cleanTitle('Assassins Creed Valhalla -EMPRESS'), 'Assassins Creed Valhalla')
  assert.equal(cleanTitle('Far.Cry.5-CODEX'), 'Far Cry 5')
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { scanFolder } = require('../src/folderScan.ts')
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

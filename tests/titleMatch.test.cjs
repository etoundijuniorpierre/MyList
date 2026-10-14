const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { isExactTitle, titleScore, uniqueExactMatch } = require('../src/titleMatch.ts')

test('une fiche identique au titre du dossier est retenue', () => {
  for (const [found, query] of [
    ['Atlanta', 'ATLANTA'],
    ['Teen Wolf', 'Teen Wolf'],
    ['Animal Kingdom', 'ANIMAL KINGDOM 2016'],
    ['The Blacklist', 'Blacklist'],
    ['Astrid et Raphaëlle', 'ASTRID ET RAPHAELLE'],
    ['Grand Theft Auto V', 'GTA V'],
  ]) assert.equal(isExactTitle(found, query), true, `${found} <- ${query}`)
})

test('une petite faute de frappe reste acceptée', () => {
  assert.equal(isExactTitle('Justice et vengeance', 'justice et vangence'), true)
})

test('un opus différent n’est jamais retenu comme exact', () => {
  for (const [found, query] of [
    ['Far Cry 3', 'Far Cry 2'],
    ['Battlefield IV', 'BATTLEFIELD III'],
    ['The Last of Us Part II', 'The Last of Us'],
    ['Tekken 7', 'Tekken 8'],
  ]) assert.equal(isExactTitle(found, query), false, `${found} <- ${query}`)
})

test('deux titres simplement proches ne sont pas confondus', () => {
  for (const [found, query] of [
    ['The Walking Dead', 'Fear the Walking Dead'],
    ['Gotham', 'Gotham Knights'],
    ['Alias', 'Alias Grace'],
  ]) assert.equal(isExactTitle(found, query), false, `${found} <- ${query}`)
})

test('le score reste borné entre 0 et 1', () => {
  assert.equal(titleScore('Gotham', 'Gotham'), 1)
  assert.equal(titleScore('', 'Gotham'), 0)
})

test('un sigle ponctué correspond à sa forme compacte', () => {
  assert.equal(isExactTitle('Virtua Fighter 5 R.E.V.O. World Stage', 'virtua fighter 5 revo world stage'), true)
  assert.equal(isExactTitle('S.T.A.L.K.E.R. 2', 'STALKER 2'), true)
})

test('deux séries homonymes ne reçoivent pas une affiche automatiquement', () => {
  const matches = [
    { title: 'Blacklist', year: 2019, match: 'exact' },
    { title: 'The Blacklist', year: 2013, match: 'exact' },
  ]
  assert.equal(uniqueExactMatch(matches), null)
  assert.equal(uniqueExactMatch([matches[1]]), matches[1])
})

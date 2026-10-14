const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { sameGameTitle, hasMatchingCover, betterFallback } = require('../supabase/functions/game-search/match.ts')

test('un jeu et sa jaquette commerciale doivent correspondre au même opus', () => {
  assert.equal(sameGameTitle('Nioh™ 3', 'Nioh 3'), true)
  assert.equal(sameGameTitle('S.T.A.L.K.E.R. 2', 'STALKER 2'), true)
  assert.equal(sameGameTitle('Nioh 2', 'Nioh 3'), false)
  assert.equal(sameGameTitle('Nioh 3 Demo', 'Nioh 3'), false)
  assert.equal(sameGameTitle('Nioh 3 Deluxe Edition', 'Nioh 3'), false)
})

test('une jaquette d’un titre voisin ne bloque pas la recherche du vrai titre', () => {
  const nearby = [{ name: 'Nioh 2', background_image: 'https://example.com/nioh-2.jpg' }]
  const exact = [{ name: 'Nioh 3', background_image: 'https://example.com/nioh-3.jpg' }]
  assert.equal(hasMatchingCover(nearby, 'Nioh 3'), false)
  assert.equal(hasMatchingCover(exact, 'Nioh 3'), true)
  assert.equal(betterFallback(nearby, exact, 'Nioh 3'), exact)
})

test('une fiche exacte sans affiche garde ses métadonnées comme repli', () => {
  const exact = [{ name: 'Nioh 3', background_image: null }]
  const nearby = [{ name: 'Nioh 2', background_image: 'https://example.com/nioh-2.jpg' }]
  assert.equal(hasMatchingCover(exact, 'Nioh 3'), false)
  assert.equal(betterFallback(exact, nearby, 'Nioh 3'), exact)
})

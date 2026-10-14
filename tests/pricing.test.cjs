const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { itemPrice } = require('../src/pricing.ts')
const prices = [
  { category: 'anime', standard_price: 100, threshold_seasons: 2, threshold_price: 80, currency: 'XOF' },
  { category: 'anime-film', standard_price: 50, threshold_seasons: null, threshold_price: null, currency: 'XOF' },
]

test('un film d’animation utilise le tarif fixe indépendant', () => {
  const film = { category: 'anime', media_format: 'film', seasons_count: null }
  assert.deepEqual(itemPrice(film, [film], prices, [], {}), { amount: 50, currency: 'XOF', detail: '1 film × 50' })
})

test('les films ne comptent pas dans le seuil de réduction des saisons animées', () => {
  const first = { category: 'anime', media_format: null, seasons_count: 1 }
  const film = { category: 'anime', media_format: 'film', seasons_count: null }
  const second = { category: 'anime', media_format: null, seasons_count: 1 }
  assert.equal(itemPrice(first, [first, film, second], prices, [], {}).amount, 80)
  assert.equal(itemPrice(film, [first, film, second], prices, [], {}).amount, 50)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const { itemPrice, calculateCart, validateGameTiers } = require('../src/pricing.ts')
const { buildCartMessage } = require('../src/cartMessage.ts')
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

// Grille publique vérifiée le 15/10/2026 et panier WhatsApp signalé par le client.
const gameTiers = [
  { min_gb: 1, max_gb: 49, price: 500, currency: 'XAF' },
  { min_gb: 50, max_gb: 99, price: 1000, currency: 'XAF' },
  { min_gb: 100, max_gb: 150, price: 1500, currency: 'XAF' },
  { min_gb: 151, max_gb: 200, price: 2000, currency: 'XAF' },
]
const discount = { min_games: 15, price_per_game: 500, currency: 'XAF' }
const game = (title, size) => ({ id: title, title, category: 'games', game_size_gb: size })
const reportedCart = [
  game('Assassins Creed Origins', 51.02), game('Doom Eternal', 29.79),
  game('Watch Dogs 2', 29.01), game('Far Cry 6', 43.73),
  game('Horizon Zero Dawn Remastered', 91.74), game('Mafia: The Old Country', 34.39),
  game('Sekiro Die Twice', 14.79), game('Evil West', 27.34), game('Marvels Spider-Man 2', 95.19),
]
const format = (amount) => `${amount} FCFA`

test('le panier WhatsApp signalé de neuf jeux vaut 6000 FCFA, sans remise de quantité', () => {
  const cart = calculateCart(reportedCart, [], gameTiers, discount)
  assert.deepEqual(cart.priced.map(entry => entry.pricing.amount), [1000, 500, 500, 500, 1000, 500, 500, 500, 1000])
  assert.equal(cart.total, 6000)
  assert.equal(cart.savings, 0)
  const text = buildCartMessage(cart, 'Client', format)
  assert.match(text, /\*Total : 6000 FCFA\*/)
  assert.match(text, /Assassins Creed Origins \(51,02 Go\) — 1000 FCFA/)
  assert.doesNotMatch(text, /— 0 FCFA|Total : 0 FCFA/)
})

test('le tarif de 500 par jeu se déclenche exactement au quinzième jeu', () => {
  const games = Array.from({ length: 15 }, (_, i) => game(`Jeu ${i}`, 180))
  assert.equal(calculateCart(games.slice(0, 14), [], gameTiers, discount).total, 28000)
  const cart = calculateCart(games, [], gameTiers, discount)
  assert.equal(cart.total, 7500)
  assert.equal(cart.savings, 22500)
  assert.match(buildCartMessage(cart, '', format), /Total : 7500 FCFA/)
})

test('les bornes de poids appliquent l’arrondi au Go supérieur', () => {
  for (const [size, expected] of [[0.1, 500], [49, 500], [49.01, 1000], [99, 1000], [99.01, 1500], [150.01, 2000], [200, 2000]]) {
    const item = game('Test', size)
    assert.equal(itemPrice(item, [item], [], gameTiers, discount).amount, expected)
  }
  const oversized = game('Hors palier', 201)
  assert.equal(calculateCart([oversized], [], gameTiers, discount).total, null)
})

test('un prix à zéro, absent, négatif ou non numérique ne produit jamais une commande gratuite', () => {
  for (const price of [0, null, '', ' ', undefined, NaN, Infinity, -500]) {
    const cart = calculateCart([game('Test', 12)], [], [{ ...gameTiers[0], price }], {})
    assert.equal(cart.total, null)
    assert.throws(() => buildCartMessage(cart, '', format), /incomplet/)
  }
  assert.match(validateGameTiers([{ ...gameTiers[0], price: 0 }]), /zéro/)
})

test('une remise à zéro est ignorée au profit des tarifs de poids', () => {
  const games = Array.from({ length: 15 }, (_, i) => game(`Jeu ${i}`, 80))
  assert.equal(calculateCart(games, [], gameTiers, { ...discount, price_per_game: 0 }).total, 15000)
})

test('un panier vide, partiellement tarifé ou en devises multiples ne peut pas être envoyé', () => {
  const mixedTiers = [{ ...gameTiers[0] }, { ...gameTiers[1], currency: 'EUR' }]
  for (const cart of [calculateCart([], [], gameTiers, discount), calculateCart([game('A', 12), game('B', null)], [], gameTiers, discount), calculateCart([game('A', 12), game('B', 80)], [], mixedTiers, discount)]) {
    assert.equal(cart.total, null)
    assert.throws(() => buildCartMessage(cart, '', format))
  }
})

test('le total du message suit les tarifs vérifiés même si un ancien onglet avait des prix nuls', () => {
  const old = calculateCart(reportedCart, [], gameTiers.map(tier => ({ ...tier, price: 0 })), discount)
  assert.throws(() => buildCartMessage(old, '', format))
  const refreshed = calculateCart(reportedCart, [], gameTiers, discount)
  assert.match(buildCartMessage(refreshed, '', format), /Total : 6000 FCFA/)
})

test('les sommes décimales ne dérivent pas et les novelas restent indépendantes des saisons animées', () => {
  const rules = [
    { category: 'series', standard_price: 0.1, currency: 'XAF' },
    { category: 'anime-film', standard_price: 0.2, currency: 'XAF' },
    { category: 'novelas', standard_price: 1500, threshold_seasons: 5, threshold_price: 1000, currency: 'XAF' },
  ]
  assert.equal(calculateCart([{ category: 'series', seasons_count: 1 }, { category: 'anime', media_format: 'film' }], rules, [], {}).total, 0.3)
  const novela = { category: 'novelas', seasons_count: 1 }
  assert.equal(itemPrice(novela, [novela, { category: 'anime', seasons_count: 20 }], rules, [], {}).amount, 1500)
})

test('un panier mixte additionne toutes les catégories avec leurs remises indépendantes', () => {
  const rules = [
    { category: 'series', standard_price: 200, threshold_seasons: 40, threshold_price: 100, currency: 'XAF' },
    { category: 'anime', standard_price: 200, threshold_seasons: 40, threshold_price: 100, currency: 'XAF' },
    { category: 'anime-film', standard_price: 100, currency: 'XAF' },
    { category: 'novelas', standard_price: 1500, threshold_seasons: 5, threshold_price: 1000, currency: 'XAF' },
    { category: 'dramas', standard_price: 500, currency: 'XAF' },
  ]
  const selection = [
    { title: 'Série', category: 'series', seasons_count: 20 },
    { title: 'Animé', category: 'anime', seasons_count: 20 },
    { title: 'Film', category: 'anime', media_format: 'film' },
    { title: 'Novela', category: 'novelas', seasons_count: 4 },
    { title: 'Drama', category: 'dramas', seasons_count: 2 },
    game('Grand jeu', 51), game('Petit jeu', 20),
  ]
  const cart = calculateCart(selection, rules, gameTiers, discount)
  assert.deepEqual(cart.priced.map(entry => entry.pricing.amount), [2000, 2000, 100, 6000, 1000, 1000, 500])
  assert.equal(cart.total, 12600)
  const text = buildCartMessage(cart, '', format)
  for (const label of ['SÉRIES', 'ANIMÉS', 'NOVELAS', 'DRAMAS', 'JEUX PC']) assert.ok(text.includes(`*${label}*`))
  assert.match(text, /Total : 12600 FCFA/)
})

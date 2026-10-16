const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { catalogSort, filterDemoCatalog, mergeBrowseItems } = require('../src/catalogData.ts')
const { currentReleaseYear, makeHomeShelf, demoHomeShelves } = require('../src/homeData.ts')
const { scrollCatalogStart, scrollPageForNavigation } = require('../src/catalogScroll.ts')
const { isDialogDismissal, syncModal } = require('../src/dialogState.ts')
const item = (id, extra = {}) => ({ id, title: id, active: true, category: 'games', genres: [], poster_url: `https://example.com/${id}.webp`, year: null, ...extra })

test('une fiche hors de la page courante reste ouverte après une réponse ou un retour en cache', () => {
  const chosen = item('Fiche trouvée par la recherche globale')
  let rows = mergeBrowseItems([chosen], [item('Page 1')], 'games', [], chosen.id)
  assert.ok(rows.some(row => row.id === chosen.id))
  rows = mergeBrowseItems(rows, [item('Page 2')], 'games', [], chosen.id)
  assert.deepEqual(rows.map(row => row.id), [chosen.id, 'Page 2'])
  rows = mergeBrowseItems(rows, [item('Page 1')], 'games', [chosen.id], null)
  assert.ok(rows.some(row => row.id === chosen.id))
  rows = mergeBrowseItems(rows, [item('Page 2')], 'games', [], null)
  assert.deepEqual(rows.map(row => row.id), ['Page 2'])
})

test('la pagination garde les autres univers et le catalogue administrateur complet', () => {
  const rows = [item('A'), item('Série', { category: 'series' })]
  assert.equal(mergeBrowseItems(rows, [item('B')], 'games', [], null).length, 2)
  assert.equal(mergeBrowseItems(rows, [item('B')], 'games', [], null, true).length, 3)
})

test('le tri par défaut suit les années de sortie, indépendamment des dates d’import', () => {
  const filters = { category: 'games', page: 1, query: '', genre: '', year: '', origin: '', format: '', byYear: false }
  const rows = [item('Ancien importé récemment', { year: 2007, created_at: '2099-01-01' }), item('Sortie récente', { year: 2025, created_at: '2000-01-01' }), item('Année absente')]
  for (const sort of [undefined, '', 'invalide', catalogSort(null)]) {
    assert.deepEqual(filterDemoCatalog(rows, { ...filters, sort }).items.map(row => row.id), ['Sortie récente', 'Ancien importé récemment', 'Année absente'])
  }
  assert.equal(catalogSort('az'), 'az')
  assert.equal(catalogSort('recent'), 'recent')
})

test('l’année en cours change automatiquement au Nouvel An dans le fuseau du site', () => {
  assert.equal(currentReleaseYear(new Date('2026-12-31T22:59:59Z')), 2026)
  assert.equal(currentReleaseYear(new Date('2026-12-31T23:00:00Z')), 2027)
  assert.equal(currentReleaseYear(new Date('2028-07-01T10:00:00Z')), 2028)
})

test('les nouveautés ne contiennent que les sorties de l’année demandée, même sans affiche', () => {
  const rows = [
    item('Ancien', { year: 2025, created_at: '2027-10-01' }),
    item('Z nouveau', { year: 2027, created_at: '2000-01-01' }),
    item('A sans affiche', { year: 2027, poster_url: null }),
    item('Futur', { year: 2028 }), item('Inconnu'), item('Masqué', { year: 2027, active: false }),
  ]
  const shelf = makeHomeShelf('games', 5, rows, rows, 2027)
  assert.deepEqual(shelf.latest.map(row => row.id), ['A sans affiche', 'Z nouveau'])
  assert.equal(shelf.count, 5)
  const nextYear = makeHomeShelf('games', 5, rows, rows, 2028)
  assert.deepEqual(nextYear.latest.map(row => row.id), ['Futur'])
})

test('une catégorie sans sortie cette année ne transforme pas ses anciennes affiches en nouveautés', () => {
  const rows = [item('Ancien jeu', { year: 2009 }), item('Ancienne série', { category: 'series', year: 2012 })]
  const shelves = demoHomeShelves(rows, 2030)
  assert.ok(shelves.every(shelf => !shelf.latest.length))
  assert.equal(shelves.find(shelf => shelf.category === 'games').featured[0].id, 'Ancien jeu')
  assert.equal(shelves.find(shelf => shelf.category === 'games').count, 1)
})

test('la remontée mobile vise le début de liste sous l’en-tête, avant et après chargement', () => {
  const oldWindow = global.window
  const oldDocument = global.document
  const moves = []
  global.window = { scrollY: 2800, scrollTo(options) { moves.push(options); this.scrollY = options.top } }
  global.document = { querySelector: () => ({ getBoundingClientRect: () => ({ height: 60 }) }) }
  const marker = { getBoundingClientRect: () => ({ top: 1000 - global.window.scrollY }) }
  try {
    scrollCatalogStart(marker)
    scrollCatalogStart(marker)
    assert.deepEqual(moves, [{ top: 932, behavior: 'instant' }, { top: 932, behavior: 'instant' }])
    scrollCatalogStart(null)
    assert.equal(moves.length, 2)
  } finally { global.window = oldWindow; global.document = oldDocument }
})

test('changer d’univers remonte tout en haut, sans déplacer les filtres, la pagination ou les ancres', () => {
  const oldWindow = global.window
  const moves = []
  let afterRender
  let cancelled = false
  global.window = {
    scrollTo(options) { moves.push(options) },
    requestAnimationFrame(callback) { afterRender = callback; return 1 },
    cancelAnimationFrame(id) { cancelled = id === 1 },
  }
  try {
    const cleanup = scrollPageForNavigation('/jeux-pc', { pathname: '/animes', hash: '' })
    assert.deepEqual(moves, [{ top: 0, left: 0, behavior: 'instant' }])
    afterRender()
    assert.equal(moves.length, 2)
    cleanup()
    assert.equal(cancelled, true)
    for (const search of ['?page=2', '?q=naruto', '?titre=fiche', '?year=2025']) {
      assert.equal(scrollPageForNavigation('/animes', { pathname: '/animes', hash: '', search }), undefined)
    }
    assert.equal(scrollPageForNavigation('/animes', { pathname: '/', hash: '#univers' }), undefined)
    assert.equal(moves.length, 2)
  } finally { global.window = oldWindow }
})

test('la notification est enregistrée dans la modale native après son ouverture', () => {
  const events = []
  const dialog = { open: false, showModal() { this.open = true; events.push('open') }, close() { this.open = false; events.push('close') } }
  const unregister = syncModal(dialog, true, host => {
    assert.equal(host, dialog)
    assert.equal(host.open, true)
    events.push('toast-in-dialog')
    return () => events.push('unregister')
  })
  unregister()
  syncModal(dialog, false, () => { throw new Error('Une modale fermée ne reçoit pas de notification') })
  assert.deepEqual(events, ['open', 'toast-in-dialog', 'unregister', 'close'])
})

test('un ancien événement close ne ferme pas une fiche qui vient de se rouvrir', () => {
  assert.equal(isDialogDismissal({ open: true }, true), false)
  assert.equal(isDialogDismissal({ open: false }, false), false)
  assert.equal(isDialogDismissal({ open: false }, true), true)
  assert.equal(isDialogDismissal(null, true), false)
})

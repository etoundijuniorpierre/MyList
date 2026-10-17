const assert = require('node:assert/strict')
const test = require('node:test')
const input = { source: 'anilist', id: '20', titles: ['Naruto'], year: 2002, category: 'anime' }
const json = value => ({ ok: true, json: async () => value })
const rows = count => Array.from({ length: count }, (_, index) => ({ number: index + 1, premiereDate: '2002-01-01' }))

test('les saisons sorties sont comptées une fois, sans spéciaux ni saisons futures', async () => {
  const { releasedSeasonCount } = await import('../api/season-count.js')
  assert.equal(releasedSeasonCount([...rows(2), { number: 0, premiereDate: '2001-01-01' }, { number: 2, premiereDate: '2002-01-01' }, { number: 3, premiereDate: '2099-01-01' }, { number: 4, premiereDate: null }], '2026-10-17'), 2)
  assert.equal(releasedSeasonCount([]), null)
})

test('un identifiant TVMaze confirmé lit directement les saisons de cette œuvre', async () => {
  const { resolveSeasonCount } = await import('../api/season-count.js')
  const calls = []
  const result = await resolveSeasonCount({ ...input, source: 'tvmaze', id: '123' }, async url => { calls.push(url); return json(rows(20)) })
  assert.equal(result.count, 20)
  assert.deepEqual(calls, ['https://api.tvmaze.com/shows/123/seasons'])
})

test('une série animée retrouve son total sans compter les épisodes comme des saisons', async () => {
  const { resolveSeasonCount } = await import('../api/season-count.js')
  const result = await resolveSeasonCount(input, async url => {
    if (url.includes('wikidata.org')) return json({ results: { bindings: [{ work: { value: 'https://www.wikidata.org/entity/Q123' }, count: { value: '5' } }] } })
    if (url.includes('/search/')) return json([{ show: { id: 99, name: 'Naruto', premiered: '2002-10-03', type: 'Animation' } }])
    return json(rows(5))
  })
  assert.equal(result.count, 5)
})

test('deux sources qui divergent ne produisent pas un total arbitraire', async () => {
  const { resolveSeasonCount } = await import('../api/season-count.js')
  const result = await resolveSeasonCount(input, async url => {
    if (url.includes('wikidata.org')) return json({ results: { bindings: [{ work: { value: 'https://www.wikidata.org/entity/Q123' }, count: { value: '6' } }] } })
    if (url.includes('/search/')) return json([{ show: { id: 99, name: 'Naruto', premiered: '2002-10-03', type: 'Animation' } }])
    return json(rows(5))
  })
  assert.equal(result.count, null)
  assert.match(result.reason, /même façon/)
})

test('une adaptation avec acteurs ne fournit pas le nombre de saisons d’un animé', async () => {
  const { resolveSeasonCount } = await import('../api/season-count.js')
  const result = await resolveSeasonCount({ ...input, source: 'kitsu' }, async url => { assert.ok(url.includes('/search/')); return json([{ show: { id: 99, name: 'Naruto', premiered: '2002-10-03', type: 'Scripted' } }]) })
  assert.equal(result.count, null)
})

test('les homonymes sans année ne sont pas choisis au hasard', async () => {
  const { resolveSeasonCount } = await import('../api/season-count.js')
  const result = await resolveSeasonCount({ ...input, source: 'kitsu', year: null }, async () => json([{ show: { id: 1, name: 'Naruto', type: 'Animation' } }, { show: { id: 2, name: 'Naruto', type: 'Animation' } }]))
  assert.equal(result.count, null)
})

test('les identifiants et sources invalides sont refusés avant les appels externes', async () => {
  const handler = (await import('../api/season-count.js')).default
  const original = global.fetch
  global.fetch = () => { throw new Error('Aucun appel attendu') }
  try {
    let status
    const response = { setHeader() {}, status(code) { status = code; return this }, json() {} }
    await handler({ method: 'GET', url: '/api/season-count?source=anilist&id=1%22%7D&title=Naruto&category=anime' }, response)
    assert.equal(status, 400)
    await handler({ method: 'GET', url: '/api/season-count?source=https://evil.example&id=1&title=Naruto&category=anime' }, response)
    assert.equal(status, 400)
  } finally { global.fetch = original }
})

const assert = require('node:assert/strict')
const test = require('node:test')

let handler
test.before(async () => { handler = (await import('../api/anime-search.js')).default })

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('la recherche anime valide le titre puis interroge Jikan côté serveur', async () => {
  const originalFetch = global.fetch
  let requestedUrl
  global.fetch = async url => {
    requestedUrl = new URL(url)
    return Response.json({ data: [{ title: 'Domestic Girlfriend' }] })
  }
  try {
    const res = response()
    await handler({ method: 'GET', url: '/api/anime-search?q=Domestic%20na%20Kanojo' }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(requestedUrl.origin, 'https://api.jikan.moe')
    assert.equal(requestedUrl.searchParams.get('q'), 'Domestic na Kanojo')
    assert.equal(requestedUrl.searchParams.get('sfw'), 'true')
    assert.match(res.headers['cache-control'], /s-maxage=3600/)
  } finally { global.fetch = originalFetch }
})

test('la recherche anime rejette les requêtes invalides avant tout accès réseau', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => { calls++; throw new Error('Accès externe inattendu') }
  try {
    const res = response()
    await handler({ method: 'GET', url: '/api/anime-search?q=x' }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(calls, 0)
  } finally { global.fetch = originalFetch }
})

test('une limitation de Jikan reste visible et expose son délai de reprise', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
  try {
    const res = response()
    await handler({ method: 'GET', url: '/api/anime-search?q=Naruto' }, res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['retry-after'], '3')
  } finally { global.fetch = originalFetch }
})

test('la recherche anime alternative interroge AniList et renvoie les affiches verticales', async () => {
  const originalFetch = global.fetch
  let requestedUrl
  let requestBody
  global.fetch = async (url, options) => {
    requestedUrl = new URL(url)
    requestBody = JSON.parse(options.body)
    return Response.json({ data: { Page: { media: [{ id: 5114, format: 'TV', title: { english: 'Fullmetal Alchemist: Brotherhood', romaji: 'Hagane no Renkinjutsushi' }, synonyms: ['Fullmetal Alchemist'], description: 'Two brothers search for a philosopher stone.', startDate: { year: 2009 }, coverImage: { extraLarge: 'https://s4.anilist.co/file/cover.jpg', large: null }, genres: ['Action'] }] } } })
  }
  try {
    const handler = (await import('../api/anilist-search.js')).default
    const res = response()
    await handler({ method: 'GET', url: '/api/anilist-search?q=Fullmetal%20Alchemist' }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(requestedUrl.origin, 'https://graphql.anilist.co')
    assert.equal(requestBody.variables.search, 'Fullmetal Alchemist')
    assert.equal(res.body.results[0].poster_url, 'https://s4.anilist.co/file/cover.jpg')
    assert.equal(res.body.results[0].format, 'TV')
    assert.match(requestBody.query, /\bformat\b/)
    assert.deepEqual(res.body.results[0].aliases, ['Fullmetal Alchemist: Brotherhood', 'Hagane no Renkinjutsushi', 'Fullmetal Alchemist'])
    assert.match(res.headers['cache-control'], /s-maxage=3600/)
  } finally { global.fetch = originalFetch }
})

const test = require('node:test')
const assert = require('node:assert/strict')
const modulePromise = import('../lib/nautiljon.mjs')
const card = (href, title, info, image = '/imagesmin/anime/00/02/naruto_320.webp') => `<a class="recherche_carte" href="${href}"><img src="${image}"><span class="recherche_carte__titre">${title}</span><span class="recherche_carte__infos">${info}</span></a>`
const naruto = card('/animes/naruto+shippuden.html', 'Naruto Shippuden', 'Série · 2007')

test('Nautiljon distingue les films des séries, conserve les années et refuse les liens hors catalogue', async () => {
  const { parseNautiljonSearch } = await modulePromise
  const found = parseNautiljonSearch(naruto + card('/animes/the+last.html', 'The Last', 'Film · 2014') + card('/mangas/naruto.html', 'Naruto', 'Série · 2002') + card('/animes/special.html', 'Spécial', 'OVA · 2014') + card('/animes/unsafe.html', 'Test', 'Série · 2014', 'https://other.test/track.jpg'))
  assert.deepEqual(found.map(row => [row.title, row.year, row.format]), [['Naruto Shippuden', 2007, 'series'], ['The Last', 2014, 'film'], ['Test', 2014, 'series']])
  assert.equal(found[0].poster_url, 'https://www.nautiljon.com/imagesmin/anime/00/02/naruto_320.webp')
  assert.equal(found[2].poster_url, null)
})

test('la recherche soumet les champs publics délivrés par le formulaire, sans toucher aux fiches ni aux accès privés', async () => {
  const { searchNautiljon } = await modulePromise
  const calls = []
  const found = await searchNautiljon('Naruto', async (url, options) => {
    calls.push({ url, options })
    assert.equal(new URL(url).pathname, '/search.php')
    assert.equal(options.redirect, 'error')
    return new Response(calls.length === 1 ? '<form action="/search.php"><input type="hidden" name="st" value="0123456789abcdef0123456789abcdef"></form>' : naruto, { headers: { 'content-type': 'text/html', ...(calls.length === 1 ? { 'set-cookie': 'publicSession=example; HttpOnly; Secure' } : {}) } })
  })
  assert.equal(calls.length, 2)
  assert.equal(new URL(calls[1].url).searchParams.get('st'), '0123456789abcdef0123456789abcdef')
  assert.equal(calls[1].options.headers.Cookie, 'publicSession=example')
  assert.equal(found[0].title, 'Naruto Shippuden')
  assert.ok(!JSON.stringify(found).includes('publicSession'))
})

test('un refus du moteur reste un refus, sans boucle ni contournement', async () => {
  const { searchNautiljon } = await modulePromise
  let calls = 0
  await assert.rejects(searchNautiljon('Naruto', async () => { calls++; return new Response('Forbidden', { status: 403 }) }), /limite/)
  assert.equal(calls, 1)
  await assert.rejects(searchNautiljon('x', () => assert.fail('Aucun appel pour un titre invalide')))
})

test('une correspondance exacte préfère l’image originale vérifiée et conserve la vignette si elle manque', async () => {
  const { searchNautiljon } = await modulePromise
  for (const status of [200, 404]) {
    const result = await searchNautiljon('Naruto Shippuden', async (url, options) => {
      if (options.method === 'HEAD') {
        assert.equal(new URL(url).pathname, '/images/anime/00/02/naruto_320.webp')
        return new Response(null, { status, headers: { 'content-type': 'image/webp', 'content-length': '12345' } })
      }
      return new Response(naruto, { headers: { 'content-type': 'text/html' } })
    })
    assert.equal(result[0].poster_url.includes('/imagesmin/'), status !== 200)
  }
})

test('l’import par lien Nautiljon trouve l’URL exacte dans le moteur public et ne confond pas une autre adaptation', async () => {
  const { readReference } = await import('../lib/seasonReference.mjs')
  const result = await readReference('https://www.nautiljon.com/animes/naruto+shippuden.html', async url => {
    assert.equal(new URL(url).pathname, '/search.php')
    return new Response(naruto, { headers: { 'content-type': 'text/html' } })
  })
  assert.equal(result.year, 2007)
  assert.equal(result.number, null)
  assert.equal(result.source, 'nautiljon')
  await assert.rejects(readReference('https://www.nautiljon.com/animes/naruto.html', async () => new Response(naruto, { headers: { 'content-type': 'text/html' } })), /ne figure pas/)
})

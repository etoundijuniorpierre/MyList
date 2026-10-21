const test = require('node:test')
const assert = require('node:assert/strict')
const modulePromise = import('../lib/seasonReference.mjs')
const address = 'https://www.allocine.fr/series/ficheserie-251/saison-2322/'

test('les références refusent les serveurs arbitraires et les liens qui ne sont pas des fiches', async () => {
  const { referenceUrl, readReference } = await modulePromise
  for (const value of ['http://www.allocine.fr/series/ficheserie-251/', 'https://user:pass@www.allocine.fr/series/ficheserie-251/', 'https://www.allocine.fr:8443/series/ficheserie-251/', 'https://www.allocine.fr.evil.test/series/ficheserie-251/', 'https://localhost/animes/test.html', 'https://www.nautiljon.com/search.php?q=abc', 'https://www.nautiljon.com/animes/test%252fother.html']) {
    assert.throws(() => referenceUrl(value))
    await assert.rejects(readReference(value, () => assert.fail('Aucune requête ne doit partir')))
  }
  assert.equal(referenceUrl(address + '?tracking=1#test').url.href, address)
})

test('Allociné conserve le numéro officiel de saison, exclut les fausses affiches et nettoie le texte', async () => {
  const { parseReference } = await modulePromise
  const result = parseReference(`<html><script type="application/ld+json">${JSON.stringify({ '@type': 'TVSeason', name: 'Les 4400 - Saison 3', seasonNumber: '3', datePublished: '2006-06-11', image: 'https://fr.web.img3.acsta.net/commons/v9/common/empty/empty_portrait.png', description: '<p>Une mystérieuse &#xE9;quipe &amp; ses secrets.</p>' })}</script></html>`, address)
  assert.equal(result.number, 3)
  assert.equal(result.year, 2006)
  assert.equal(result.poster_url, null)
  assert.equal(result.synopsis, 'Une mystérieuse équipe & ses secrets.')
  assert.equal(result.source, 'allocine')
})

test('Nautiljon sans numéro de saison explicite reste à confirmer, les images non HTTPS sont exclues', async () => {
  const { parseReference } = await modulePromise
  const result = parseReference('<meta property="og:title" content="Code Geass : Lelouch - Nautiljon"><meta property="og:image" content="javascript:alert(1)"><meta name="description" content="Un prince exilé mène une rébellion.">', 'https://www.nautiljon.com/animes/code+geass.html')
  assert.equal(result.number, null)
  assert.equal(result.poster_url, null)
  assert.equal(result.title, 'Code Geass : Lelouch')
  assert.equal(result.source, 'nautiljon')
  assert.throws(() => parseReference('<title>Just a moment...</title>', address))
})

test('les redirections sont revérifiées et une protection de la source reste bloquante sans contournement', async () => {
  const { readReference } = await modulePromise
  let requests = 0
  await assert.rejects(readReference(address, async () => { requests++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }) }))
  assert.equal(requests, 1)
  requests = 0
  await assert.rejects(readReference(address, async () => { requests++; return new Response('Forbidden', { status: 403 }) }), /bloque ou limite/)
  assert.equal(requests, 1)
})

test('la lecture des références est bornée même sans longueur HTTP annoncée', async () => {
  const { readReference } = await modulePromise
  await assert.rejects(readReference(address, async () => new Response('x'.repeat(1500001), { headers: { 'content-type': 'text/html' } })), /volumineuse/)
  const result = await readReference(address, async () => new Response('<title>Les 4400 Saison 3</title><meta property="og:image" content="https://images.test/affiche.jpg">', { headers: { 'content-type': 'text/html' } }))
  assert.equal(result.number, 3)
  assert.equal(result.poster_url, 'https://images.test/affiche.jpg')
})

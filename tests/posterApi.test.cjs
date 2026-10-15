const assert = require('node:assert/strict')
const test = require('node:test')
const sharp = require('sharp')
const handler = require('../api/poster.js').default

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    send(body) { this.body = body; return this },
    end() { return this },
    json(body) { this.body = body; return this },
  }
}

test('le redimensionnement garde toute l’affiche dans son ratio et son cache varie selon le format', async () => {
  const originalFetch = global.fetch
  const input = await sharp({ create: { width: 1280, height: 1600, channels: 3, background: '#54738a' } }).jpeg().toBuffer()
  global.fetch = async url => {
    assert.match(String(url), /^https:\/\/glmseokfaljqcjibrhci\.supabase\.co\/storage\/v1\/object\/public\/posters\//)
    return new Response(input, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(input.length) } })
  }
  try {
    const res = response()
    await handler({ method: 'GET', url: '/api/poster?path=3d/3d80bb6fe4a9a80af1a02c0fd0554d82a9d16bbf021d3ea332fcdeba5ea4a64e&w=384', headers: { accept: 'image/avif,image/webp' } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/avif')
    assert.match(res.headers['cache-control'], /s-maxage=604800/)
    assert.equal(res.headers.vary, 'Accept')
    const details = await sharp(res.body).metadata()
    assert.ok(details.width <= 384 && details.height <= 900)
    assert.ok(Math.abs(details.width / details.height - 1280 / 1600) < 0.01)
  } finally { global.fetch = originalFetch }
})

test('les chemins, ports, URL externes et largeurs non autorisés sont rejetés avant tout accès réseau', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => { calls++; throw new Error('Accès externe inattendu') }
  try {
    for (const path of ['../../secret', 'https://example.com/image.jpg', '3d/not-a-poster']) {
      const res = response()
      await handler({ method: 'GET', url: `/api/poster?path=${encodeURIComponent(path)}&w=384`, headers: {} }, res)
      assert.equal(res.statusCode, 400)
    }
    const res = response()
    await handler({ method: 'GET', url: '/api/poster?path=3d/3d80bb6fe4a9a80af1a02c0fd0554d82a9d16bbf021d3ea332fcdeba5ea4a64e&w=9999', headers: {} }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(calls, 0)
  } finally { global.fetch = originalFetch }
})

test('les miniatures mobiles de 240 px partagent une préparation et réutilisent le résultat', async () => {
  const originalFetch = global.fetch
  const input = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#829e4b' } }).jpeg().toBuffer()
  let calls = 0
  global.fetch = async () => {
    calls++
    return new Response(input, { status: 200, headers: { 'Content-Length': String(input.length) } })
  }
  const request = { method: 'GET', url: `/api/poster?path=aa/${'a'.repeat(64)}&w=240`, headers: { accept: 'image/webp' } }
  try {
    const first = response()
    const second = response()
    await Promise.all([handler(request, first), handler(request, second)])
    const third = response()
    await handler(request, third)
    assert.equal(calls, 1)
    assert.equal(first.statusCode, 200)
    assert.deepEqual(first.body, second.body)
    assert.deepEqual(first.body, third.body)
    const details = await sharp(first.body).metadata()
    assert.equal(details.width, 240)
    assert.equal(details.height, 320)
    assert.equal(details.format, 'webp')
    const avif = response()
    await handler({ ...request, headers: { accept: 'image/avif' } }, avif)
    assert.equal(calls, 2)
    assert.equal(avif.headers['content-type'], 'image/avif')
  } finally { global.fetch = originalFetch }
})

test('un échec de miniature est réessayé et n’empoisonne pas le cache', async () => {
  const originalFetch = global.fetch
  const input = await sharp({ create: { width: 120, height: 180, channels: 3, background: '#624baa' } }).jpeg().toBuffer()
  let calls = 0
  global.fetch = async () => ++calls === 1 ? new Response(null, { status: 503 }) : new Response(input, { status: 200 })
  const request = { method: 'GET', url: `/api/poster?path=bb/${'b'.repeat(64)}&w=240`, headers: {} }
  try {
    const failure = response()
    await handler(request, failure)
    assert.equal(failure.statusCode, 404)
    const retry = response()
    await handler(request, retry)
    assert.equal(retry.statusCode, 200)
    assert.equal(calls, 2)
  } finally { global.fetch = originalFetch }
})

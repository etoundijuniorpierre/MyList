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

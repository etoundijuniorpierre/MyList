const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  module._compile(compiled.outputText, filename)
}

const storage = new Map()
global.localStorage = {
  getItem(key) { return storage.get(key) ?? null },
  setItem(key, value) { storage.set(key, value) },
}
const { POSTER_JOB_KEY, readPosterJob, savePosterJob } = require('../src/posterJobState.ts')

test('la progression de recherche d’affiches se restaure après rechargement', () => {
  const saved = { version: 1, id: 'job', userId: 'admin', kind: 'enrich', ids: ['a', 'b', 'c'], label: 'Affiches', completed: 2, total: 3, updated: 1, stored: 1, missing: 0 }
  savePosterJob(saved)
  assert.deepEqual(readPosterJob(), saved)
})

test('le tri initial des jaquettes et ses candidates restent enregistrés après rechargement', () => {
  const saved = { version: 1, id: 'repair', userId: 'admin', kind: 'repair-games', phase: 'scan', ids: ['a', 'b', 'c'], candidateIds: ['a'], label: 'Tri des jaquettes', completed: 2, total: 3, updated: 0, stored: 0, missing: 0 }
  savePosterJob(saved)
  assert.deepEqual(readPosterJob(), saved)
})

test('une traduction longue peut reprendre sa progression après navigation', () => {
  const saved = { version: 1, id: 'translate', userId: 'admin', kind: 'translate', ids: ['a', 'b'], retryIds: ['b'], label: 'Traduction', completed: 1, total: 2, updated: 1, stored: 0, missing: 0 }
  savePosterJob(saved)
  assert.deepEqual(readPosterJob(), saved)
})

test('une progression endommagée ou un compteur hors limites n’est jamais repris', () => {
  storage.set(POSTER_JOB_KEY, '{')
  assert.equal(readPosterJob(), null)
  storage.set(POSTER_JOB_KEY, JSON.stringify({ version: 1, id: 'job', userId: 'admin', kind: 'cache', ids: ['a'], completed: 2, total: 1 }))
  assert.equal(readPosterJob(), null)
})

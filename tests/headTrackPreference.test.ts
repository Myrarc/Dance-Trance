import assert from 'node:assert/strict'
import test from 'node:test'

interface SessionStorageStub {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

test('keeps the head tracking choice for the browser session', async () => {
  const preference = await import('../src/lib/headTrackPreference.ts').catch(() => ({}))
  assert.equal(typeof preference.loadTrackHead, 'function')
  assert.equal(typeof preference.saveTrackHead, 'function')

  const values = new Map<string, string>()
  const storage: SessionStorageStub = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }

  assert.equal(preference.loadTrackHead(storage), true)

  preference.saveTrackHead(false, storage)
  assert.equal(preference.loadTrackHead(storage), false)

  preference.saveTrackHead(true, storage)
  assert.equal(preference.loadTrackHead(storage), true)
})

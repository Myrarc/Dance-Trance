import assert from 'node:assert/strict'
import test from 'node:test'

interface SessionStorageStub {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

test('keeps the skeleton visibility choice for the browser session', async () => {
  const preference = await import('../src/lib/skeletonVisibility.ts').catch(() => ({}))
  assert.equal(typeof preference.loadSkeletonsVisible, 'function')
  assert.equal(typeof preference.saveSkeletonsVisible, 'function')

  const values = new Map<string, string>()
  const storage: SessionStorageStub = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }

  assert.equal(preference.loadSkeletonsVisible(storage), true)

  preference.saveSkeletonsVisible(false, storage)
  assert.equal(preference.loadSkeletonsVisible(storage), false)

  preference.saveSkeletonsVisible(true, storage)
  assert.equal(preference.loadSkeletonsVisible(storage), true)
})

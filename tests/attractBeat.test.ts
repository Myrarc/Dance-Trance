import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleBeat } from '../src/lib/attractBeat.ts'

test('only fresh, spaced music hits pulse the attract screen', () => {
  const tracker = { baseline: 0, previous: 0, lastBeat: -Infinity }
  assert.equal(sampleBeat(tracker, 50, 0), false)
  assert.equal(sampleBeat(tracker, 50, 100), false)
  assert.equal(sampleBeat(tracker, 85, 200), true)
  assert.equal(sampleBeat(tracker, 90, 250), false)
  sampleBeat(tracker, 50, 450)
  assert.equal(sampleBeat(tracker, 85, 540), true)
})

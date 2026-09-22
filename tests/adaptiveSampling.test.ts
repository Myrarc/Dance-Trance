import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldInferFrame } from '../src/pose/adaptiveSampling.ts'

test('samples calm video at 10 FPS and moving video at 15 FPS', () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, frame) => shouldInferFrame(frame, 0, 12)),
    [true, true, false, true, true, false],
  )
  assert.equal(shouldInferFrame(2, 12, 12), true)
})

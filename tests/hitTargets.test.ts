import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoseTrack } from '../src/pose/track.ts'
import { buildHitTargets, upcomingHitTargets } from '../src/pose/hitTargets.ts'

const fps = 10
const frames = 20
const stride = 33 * 6
const data = new Float32Array(frames * stride)

for (let frame = 0; frame < frames; frame++) {
  for (let landmark = 0; landmark < 33; landmark++) {
    const offset = frame * stride + landmark * 6
    data[offset] = 0.5
    data[offset + 1] = 0.5
    data[offset + 2] = 1
  }
  const wrist = frame * stride + 15 * 6
  data[wrist] = frame < 8 ? 0.5 + frame * 0.025 : 0.7
}

const track: PoseTrack = { fps, frames, data }

test('turns a hand movement endpoint into one timed hit target', () => {
  const targets = buildHitTargets(track)
  const hand = targets.find((target) => target.joint === 'leftHand')
  assert.ok(hand)
  assert.ok(hand.time >= 0.7 && hand.time <= 1.3)
  assert.ok(Math.abs(hand.x - 0.7) < 1e-6)
})

test('starts finding hits when the dancer enters after an empty intro', () => {
  const delayed = new Float32Array(data)
  delayed.fill(NaN, 0, stride * 3)
  const targets = buildHitTargets({ fps, frames, data: delayed })
  assert.ok(targets.some((target) => target.joint === 'leftHand'))
})

test('shows one upcoming target per body part inside the preview window', () => {
  const visible = upcomingHitTargets(
    [
      { time: 1, joint: 'head', x: 0.5, y: 0.2 },
      { time: 1.2, joint: 'head', x: 0.6, y: 0.2 },
      { time: 1.1, joint: 'leftHand', x: 0.2, y: 0.4 },
    ],
    0.5,
    0.8,
  )
  assert.deepEqual(visible.map((target) => target.joint), ['head', 'leftHand'])
})

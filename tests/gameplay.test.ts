import assert from 'node:assert/strict'
import test from 'node:test'
import { accuracy, judgeDueTargets, newPlayerRound, stablePlayerOrder } from '../src/pose/gameplay.ts'

const targets = [
  { time: 1, joint: 'leftHand' as const, x: 0.2, y: 0.3 },
  { time: 2, joint: 'rightHand' as const, x: 0.8, y: 0.3 },
]

test('scores each due marker once and resets combo on a miss', () => {
  let player = judgeDueTargets(newPlayerRound(), 90, 1, targets)
  assert.equal(player.perfect, 1)
  assert.equal(player.combo, 1)
  player = judgeDueTargets(player, 40, 2, targets)
  assert.equal(player.miss, 1)
  assert.equal(player.combo, 0)
  assert.equal(accuracy(player), 50)
})

test('keeps player identity when their horizontal order crosses', () => {
  const ordered = stablePlayerOrder([{ x: 0.7 }, { x: 0.3 }], [0.25, 0.75])
  assert.deepEqual(ordered.map((player) => player.x), [0.3, 0.7])
})

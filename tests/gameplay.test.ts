import assert from 'node:assert/strict'
import test from 'node:test'
import { accuracy, gradeMatch, HIT_WINDOW_S, isGameRunReady, judgeDueTargets, movementBaseline, newPlayerRound, stablePlayerOrder } from '../src/pose/gameplay.ts'
import { compareHitAngles, compareToHistory, hasHitMovement, type PoseFeature } from '../src/pose/angles.ts'

const targets = [
  { time: 1, poseTime: 1, joint: 'leftHand' as const, x: 0.2, y: 0.3, feature: {} },
  { time: 2, poseTime: 2, joint: 'rightHand' as const, x: 0.8, y: 0.3, feature: {} },
]

test('scores each due marker once and resets combo on a miss', () => {
  let player = judgeDueTargets(newPlayerRound(), 90, 1, targets)
  player = judgeDueTargets(player, null, 1 + HIT_WINDOW_S, targets)
  assert.equal(player.perfect, 1)
  assert.equal(player.combo, 1)
  player = judgeDueTargets(player, 40, 2, targets)
  player = judgeDueTargets(player, null, 2 + HIT_WINDOW_S, targets)
  assert.equal(player.miss, 1)
  assert.equal(player.combo, 0)
  assert.equal(accuracy(player), 50)
})

test('grades match the green and yellow limb feedback players see', () => {
  assert.equal(gradeMatch(78), 'perfect')
  assert.equal(gradeMatch(53), 'good')
  assert.equal(gradeMatch(52), 'miss')
})

test('keeps player identity when their horizontal order crosses', () => {
  const ordered = stablePlayerOrder([{ x: 0.7 }, { x: 0.3 }], [0.25, 0.75])
  assert.deepEqual(ordered.map((player) => player.x), [0.3, 0.7])
})

test('a matching player decisively outscores a player whose marked limb is wrong', () => {
  const right = { x: 1, y: 0, z: 0 }
  const wrong = { x: -1, y: 0, z: 0 }
  const reference: PoseFeature = { lUpperArm: right, lForearm: right }
  const amateur: PoseFeature = { lUpperArm: wrong, lForearm: wrong }
  const matching: PoseFeature = { lUpperArm: right, lForearm: right }
  const handTargets = [{ time: 1, poseTime: 1, joint: 'leftHand' as const, x: 0.2, y: 0.3, feature: reference }]

  const p1Pending = judgeDueTargets(
    newPlayerRound(),
    (target) => compareHitAngles(amateur, target.feature, target.joint, false).score,
    1,
    handTargets,
  )
  const p2Pending = judgeDueTargets(
    newPlayerRound(),
    (target) => compareHitAngles(matching, target.feature, target.joint, false).score,
    1,
    handTargets,
  )
  const p1 = judgeDueTargets(p1Pending, null, 1 + HIT_WINDOW_S, handTargets)
  const p2 = judgeDueTargets(p2Pending, null, 1 + HIT_WINDOW_S, handTargets)

  assert.equal(p1.score, 0)
  assert.equal(p2.score, 1025)
})

test('each player keeps an independent timing estimate', () => {
  const early: PoseFeature = { lUpperArm: { x: 1, y: 0, z: 0 } }
  const current: PoseFeature = { lUpperArm: { x: 0, y: 1, z: 0 } }
  const history = [{ t: 0, feature: early }, { t: 1, feature: current }]
  const p1 = { lag: 0 }
  const p2 = { lag: 0 }

  compareToHistory(early, history, 1, false, p1)
  compareToHistory(current, history, 1, false, p2)

  assert.ok(p1.lag > 0)
  assert.equal(p2.lag, 0)
})

test('standing still cannot keep earning hit points', () => {
  const held: PoseFeature = {
    lUpperArm: { x: 1, y: 0, z: 0 },
    lForearm: { x: 1, y: 0, z: 0 },
  }
  const moved: PoseFeature = {
    lUpperArm: { x: 0, y: 1, z: 0 },
    lForearm: { x: 0, y: 1, z: 0 },
  }

  assert.equal(hasHitMovement(held, held, 'leftHand', false), false)
  assert.equal(hasHitMovement(held, moved, 'leftHand', false), true)
})

test('keeps the best reading inside a hit window', () => {
  let player = judgeDueTargets(newPlayerRound(), 55, 0.8, targets)
  player = judgeDueTargets(player, 90, 1.1, targets)
  player = judgeDueTargets(player, null, 1 + HIT_WINDOW_S, targets)

  assert.equal(player.perfect, 1)
})

test('does not reuse one late camera frame for several missed markers', () => {
  let calls = 0
  const crowded = [targets[0], { ...targets[1], time: 1.1, poseTime: 1.1 }]
  const player = judgeDueTargets(newPlayerRound(), () => {
    calls++
    return 100
  }, 1.6, crowded)

  assert.equal(calls, 0)
  assert.equal(player.miss, 2)
})

test('arms replay scoring from the reference run instead of a fragile time threshold', () => {
  assert.equal(isGameRunReady(1, 2), false)
  assert.equal(isGameRunReady(2, 2), true)
})

test('finds a movement baseline when tracking only runs at 2 FPS', () => {
  const history = [{ t: 10, value: 'before' }, { t: 10.5, value: 'now' }]
  assert.equal(movementBaseline(history, 10.5), 'before')
})

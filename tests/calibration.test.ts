import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceCalibration, assessCalibrationPose, beginCalibration, canStartWithCalibration } from '../src/pose/calibration.ts'
import { LM } from '../src/pose/skeleton.ts'

function dancer(center = 0.5, arms: 'out' | 'down' = 'out') {
  const points = Array.from({ length: 33 }, () => ({ x: center, y: 0.5, z: 0, visibility: 1 }))
  const put = (index: number, dx: number, y: number) => { points[index] = { x: center + dx, y, z: 0, visibility: 1 } }
  put(LM.nose, 0, 0.19)
  put(LM.lShoulder, -0.07, 0.32)
  put(LM.rShoulder, 0.07, 0.32)
  put(LM.lHip, -0.05, 0.57)
  put(LM.rHip, 0.05, 0.57)
  put(LM.lKnee, -0.05, 0.74)
  put(LM.rKnee, 0.05, 0.74)
  put(LM.lAnkle, -0.05, 0.9)
  put(LM.rAnkle, 0.05, 0.9)
  if (arms === 'out') {
    put(LM.lElbow, -0.16, 0.32)
    put(LM.rElbow, 0.16, 0.32)
    put(LM.lWrist, -0.21, 0.32)
    put(LM.rWrist, 0.21, 0.32)
  } else {
    put(LM.lElbow, -0.07, 0.45)
    put(LM.rElbow, 0.07, 0.45)
    put(LM.lWrist, -0.07, 0.6)
    put(LM.rWrist, 0.07, 0.6)
  }
  return points
}

test('rejects an apparently detected pose when a scoring joint is occluded or off screen', () => {
  const hidden = dancer()
  hidden[LM.lAnkle].visibility = 0.1
  assert.equal(assessCalibrationPose(hidden, 0, 1).reason, 'feet')

  const clipped = dancer()
  clipped[LM.rWrist].x = 1.02
  assert.equal(assessCalibrationPose(clipped, 0, 1).reason, 'arms')
  assert.equal(assessCalibrationPose(dancer(), 0, 1).reason, null)
})

test('passes only after reliable framing and an observed down-then-out arm movement', () => {
  let state = beginCalibration(1, 0)
  for (let time = 0; time <= 2400; time += 50) state = advanceCalibration(state, [dancer()], time)
  assert.equal(state.phase, 'movement')
  for (let time = 2450; time <= 3100; time += 50) state = advanceCalibration(state, [dancer(0.5, 'down')], time)
  assert.equal(state.phase, 'movement')
  for (let time = 3150; time <= 3900; time += 50) state = advanceCalibration(state, [dancer()], time)
  assert.equal(state.phase, 'passed')
  assert.equal(state.players[0].goodFrames > 30, true)
})

test('fails with a specific finding when detection keeps dropping out', () => {
  let state = beginCalibration(1, 0)
  for (let time = 0; time <= 5200; time += 50) {
    state = advanceCalibration(state, time % 250 === 0 ? [dancer()] : [null], time)
  }
  assert.equal(state.phase, 'failed')
  assert.equal(state.players[0].reason, 'missing')
})

test('keeps both players independent when one player is not visible', () => {
  let state = beginCalibration(2, 0)
  for (let time = 0; time <= 5200; time += 50) state = advanceCalibration(state, [dancer(0.75), null], time)
  assert.equal(state.phase, 'failed')
  assert.equal(state.players[0].reason, null)
  assert.equal(state.players[1].reason, 'missing')
})

test('calibrates two visible players without combining their movement evidence', () => {
  let state = beginCalibration(2, 0)
  for (let time = 0; time <= 2400; time += 50) state = advanceCalibration(state, [dancer(0.75), dancer(0.25)], time)
  assert.equal(state.phase, 'movement')
  for (let time = 2450; time <= 3100; time += 50) state = advanceCalibration(state, [dancer(0.75, 'down'), dancer(0.25)], time)
  for (let time = 3150; time <= 3900; time += 50) state = advanceCalibration(state, [dancer(0.75), dancer(0.25)], time)
  assert.equal(state.phase, 'movement')
  for (let time = 3950; time <= 4600; time += 50) state = advanceCalibration(state, [dancer(0.75), dancer(0.25, 'down')], time)
  for (let time = 4650; time <= 5400; time += 50) state = advanceCalibration(state, [dancer(0.75), dancer(0.25)], time)
  assert.equal(state.phase, 'passed')
})

test('head visibility follows the head tracking setting', () => {
  const pose = dancer()
  pose[LM.nose].visibility = 0.1
  assert.equal(assessCalibrationPose(pose, 0, 1, true).reason, 'head')
  assert.equal(assessCalibrationPose(pose, 0, 1, false).reason, null)
})

test('reports a missing arm movement even when framing stays good', () => {
  let state = beginCalibration(1, 0)
  for (let time = 0; time <= 10500; time += 50) state = advanceCalibration(state, [dancer()], time)
  assert.equal(state.phase, 'failed')
  assert.equal(state.players[0].reason, 'motion')
})

test('reports dropout during movement even if both arm positions appeared briefly', () => {
  let state = beginCalibration(1, 0)
  for (let time = 0; time <= 2400; time += 50) state = advanceCalibration(state, [dancer()], time)
  for (let time = 2450; time <= 10500; time += 50) {
    const reading = time === 3050 || time === 3100 ? dancer(0.5, 'down') :
      time === 3150 || time === 3200 ? dancer() : null
    state = advanceCalibration(state, [reading], time)
  }
  assert.equal(state.phase, 'failed')
  assert.equal(state.players[0].reason, 'missing')
})

test('starts only for the calibrated number of visible players, unless failure is explicitly bypassed', () => {
  const passed = { ...beginCalibration(2, 0), phase: 'passed' as const }
  const failed = { ...passed, phase: 'failed' as const }
  assert.equal(canStartWithCalibration(true, 2, passed, false), true)
  assert.equal(canStartWithCalibration(true, 1, passed, false), false)
  assert.equal(canStartWithCalibration(true, 2, failed, false), false)
  assert.equal(canStartWithCalibration(true, 2, failed, true), true)
  assert.equal(canStartWithCalibration(false, 2, passed, true), false)
})

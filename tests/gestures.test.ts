import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  advanceGestureHold,
  detectMenuGesture,
  inPlayerZone,
  isTPose,
  playerScreenX,
  type GestureHold,
} from '../src/pose/gestures.ts'

const pose = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))

const registrationPose = pose()
Object.assign(registrationPose[11], { x: 0.4, y: 0.4 })
Object.assign(registrationPose[12], { x: 0.6, y: 0.4 })
Object.assign(registrationPose[13], { x: 0.3, y: 0.4 })
Object.assign(registrationPose[14], { x: 0.7, y: 0.4 })
Object.assign(registrationPose[15], { x: 0.15, y: 0.4 })
Object.assign(registrationPose[16], { x: 0.85, y: 0.4 })

test('recognises a visible arms-horizontal T-pose', () => {
  assert.equal(isTPose(registrationPose as NormalizedLandmark[]), true)
  assert.equal(
    isTPose(registrationPose.map((point, index) => (index === 15 ? { ...point, y: 0.7 } : point)) as NormalizedLandmark[]),
    false,
  )
})

test('maps camera coordinates into mirrored player zones', () => {
  assert.equal(playerScreenX(registrationPose as NormalizedLandmark[]), 0.5)
  assert.equal(inPlayerZone(0.5, 0, 1), true)
  assert.equal(inPlayerZone(0.2, 0, 2), true)
  assert.equal(inPlayerZone(0.8, 1, 2), true)
  assert.equal(inPlayerZone(0.5, 0, 2), false)
})

test('recognises deliberate menu poses without treating a T-pose as navigation', () => {
  const p = pose()
  Object.assign(p[0], { x: 0.5, y: 0.25 })
  Object.assign(p[11], { x: 0.4, y: 0.45 })
  Object.assign(p[12], { x: 0.6, y: 0.45 })

  Object.assign(p[13], { x: 0.28, y: 0.45 })
  Object.assign(p[15], { x: 0.15, y: 0.45 })
  Object.assign(p[14], { x: 0.72, y: 0.45 })
  Object.assign(p[16], { x: 0.85, y: 0.45 })
  assert.equal(detectMenuGesture(p), null)

  Object.assign(p[14], { x: 0.61, y: 0.58 })
  Object.assign(p[16], { x: 0.61, y: 0.7 })
  assert.equal(detectMenuGesture(p), 'previous')

  Object.assign(p[13], { x: 0.42, y: 0.58 })
  Object.assign(p[15], { x: 0.43, y: 0.7 })
  Object.assign(p[14], { x: 0.58, y: 0.35 })
  Object.assign(p[16], { x: 0.57, y: 0.18 })
  assert.equal(detectMenuGesture(p), 'confirm')

  Object.assign(p[13], { x: 0.42, y: 0.35 })
  Object.assign(p[15], { x: 0.43, y: 0.18 })
  assert.equal(detectMenuGesture(p), null)
})

test('fires once after a hold and rearms only after neutral', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false }
  let reading = advanceGestureHold(state, 'next', 100, 850)
  state = reading
  reading = advanceGestureHold(state, 'next', 949, 850)
  assert.equal(reading.fired, null)
  state = reading
  reading = advanceGestureHold(state, 'next', 950, 850)
  assert.equal(reading.fired, 'next')
  state = reading
  assert.equal(advanceGestureHold(state, 'next', 2000, 850).fired, null)
  state = advanceGestureHold(state, null, 2100, 850)
  assert.equal(advanceGestureHold(state, 'next', 2200, 850).latched, false)
})

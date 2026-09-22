import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { inPlayerZone, isTPose, playerScreenX } from '../src/pose/gestures.ts'

const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
pose[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1 }
pose[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1 }
pose[13] = { x: 0.3, y: 0.4, z: 0, visibility: 1 }
pose[14] = { x: 0.7, y: 0.4, z: 0, visibility: 1 }
pose[15] = { x: 0.15, y: 0.4, z: 0, visibility: 1 }
pose[16] = { x: 0.85, y: 0.4, z: 0, visibility: 1 }

test('recognises a visible arms-horizontal T-pose', () => {
  assert.equal(isTPose(pose as NormalizedLandmark[]), true)
  assert.equal(isTPose(pose.map((point, index) => (index === 15 ? { ...point, y: 0.7 } : point)) as NormalizedLandmark[]), false)
})

test('maps camera coordinates into mirrored player zones', () => {
  assert.equal(playerScreenX(pose as NormalizedLandmark[]), 0.5)
  assert.equal(inPlayerZone(0.5, 0, 1), true)
  assert.equal(inPlayerZone(0.2, 0, 2), true)
  assert.equal(inPlayerZone(0.8, 1, 2), true)
  assert.equal(inPlayerZone(0.5, 0, 2), false)
})

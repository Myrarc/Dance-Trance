import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAngles, HEAD } from '../src/pose/angles.ts'

test('excludes head from score and problems when trackHead is false', () => {
  // A pose where head differs completely:
  // user head points (0, 1, 0), target head points (0, -1, 0)
  // arm matches
  const user = {
    [HEAD]: { x: 0, y: 1, z: 0 },
    lUpperArm: { x: 1, y: 0, z: 0 },
  }
  const target = {
    [HEAD]: { x: 0, y: -1, z: 0 },
    lUpperArm: { x: 1, y: 0, z: 0 },
  }

  const withHead = compareAngles(user, target, false, 'upper', true)
  assert.equal(withHead.levels[HEAD], 'bad')
  assert.ok(withHead.problems.includes('head'))

  const withoutHead = compareAngles(user, target, false, 'upper', false)
  assert.equal(withoutHead.levels[HEAD], 'na')
  assert.ok(!withoutHead.problems.includes('head'))
  assert.equal(withoutHead.score, 100)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { requestCameraStream } from '../src/lib/cameraStream.ts'

test('a camera request that never settles times out instead of freezing registration', async () => {
  const devices = {
    getUserMedia: () => new Promise<MediaStream>(() => {}),
  }

  await assert.rejects(
    requestCameraStream(devices, { video: true }, 5),
    /Camera request timed out/,
  )
})

test('a camera stream arriving after timeout is stopped instead of leaking the device', async () => {
  let stops = 0
  const stream = {
    getTracks: () => [{ stop: () => { stops++ } }],
  } as unknown as MediaStream
  const devices = {
    getUserMedia: () => new Promise<MediaStream>((resolve) => setTimeout(() => resolve(stream), 15)),
  }

  await assert.rejects(requestCameraStream(devices, { video: true }, 5))
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(stops, 1)
})

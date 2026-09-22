import type { PoseTrack } from './track'

export type HitJoint = 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot'

export interface HitTarget {
  time: number
  joint: HitJoint
  x: number
  y: number
}

const VALUES_PER_LANDMARK = 6
const STRIDE = 33 * VALUES_PER_LANDMARK
const POINTS: Record<HitJoint, number[]> = {
  head: [7, 8],
  leftHand: [15],
  rightHand: [16],
  leftFoot: [27],
  rightFoot: [28],
}
const MOVE_THRESHOLD: Record<HitJoint, number> = {
  head: 0.04,
  leftHand: 0.08,
  rightHand: 0.08,
  leftFoot: 0.055,
  rightFoot: 0.055,
}

function point(track: PoseTrack, frame: number, joint: HitJoint) {
  const points = POINTS[joint]
    .map((landmark) => {
      const offset = frame * STRIDE + landmark * VALUES_PER_LANDMARK
      return { x: track.data[offset], y: track.data[offset + 1], visibility: track.data[offset + 2] }
    })
    .filter((value) => value.visibility >= 0.5 && Number.isFinite(value.x) && Number.isFinite(value.y))
  if (!points.length && joint === 'head') {
    const offset = frame * STRIDE
    return track.data[offset + 2] >= 0.5
      ? { x: track.data[offset], y: track.data[offset + 1] }
      : null
  }
  if (!points.length) return null
  return {
    x: points.reduce((sum, value) => sum + value.x, 0) / points.length,
    y: points.reduce((sum, value) => sum + value.y, 0) / points.length,
  }
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** Reduce the dense pose track to movement endpoints worth showing as cues. */
export function buildHitTargets(track: PoseTrack): HitTarget[] {
  const targets: HitTarget[] = []
  const gap = Math.max(1, Math.round(track.fps * 0.45))
  const forceAfter = Math.max(gap, Math.round(track.fps * 1.2))

  for (const joint of Object.keys(POINTS) as HitJoint[]) {
    let lastFrame = 0
    let lastPoint = point(track, 0, joint)
    for (let frame = 2; frame < track.frames - 1; frame++) {
      if (!lastPoint) {
        const firstVisible = point(track, frame, joint)
        if (firstVisible) {
          lastPoint = firstVisible
          lastFrame = frame
        }
        continue
      }
      if (frame - lastFrame < gap) continue
      const before = point(track, frame - 1, joint)
      const current = point(track, frame, joint)
      const after = point(track, frame + 1, joint)
      if (!before || !current || !after || distance(lastPoint, current) < MOVE_THRESHOLD[joint]) continue

      const into = { x: current.x - before.x, y: current.y - before.y }
      const out = { x: after.x - current.x, y: after.y - current.y }
      const speedIn = Math.hypot(into.x, into.y)
      const speedOut = Math.hypot(out.x, out.y)
      const reversed = speedIn > 0.002 && speedOut > 0.002 && into.x * out.x + into.y * out.y < 0
      const slowed = speedIn > 0.003 && speedOut < speedIn * 0.55
      if (!reversed && !slowed && frame - lastFrame < forceAfter) continue

      targets.push({ time: frame / track.fps, joint, x: current.x, y: current.y })
      lastFrame = frame
      lastPoint = current
    }
  }
  return targets.sort((a, b) => a.time - b.time)
}

/** One imminent cue per body part keeps the playfield readable. */
export function upcomingHitTargets(
  targets: HitTarget[],
  time: number,
  leadSeconds: number,
  trackHead = true,
) {
  const upcoming = new Map<HitJoint, HitTarget>()
  for (const target of targets) {
    if (!trackHead && target.joint === 'head') continue
    const delta = target.time - time
    if (delta < -0.12 || delta > leadSeconds || upcoming.has(target.joint)) continue
    upcoming.set(target.joint, target)
  }
  return [...upcoming.values()]
}

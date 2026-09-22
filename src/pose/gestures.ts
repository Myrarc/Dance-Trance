import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const LM = {
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
} as const

const visible = (point: NormalizedLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.5

/** A forgiving arms-horizontal pose used only to confirm player registration. */
export function isTPose(pose: NormalizedLandmark[]) {
  const points = [LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist]
  if (!points.every((index) => visible(pose[index]))) return false

  const ls = pose[LM.lShoulder]
  const rs = pose[LM.rShoulder]
  const le = pose[LM.lElbow]
  const re = pose[LM.rElbow]
  const lw = pose[LM.lWrist]
  const rw = pose[LM.rWrist]
  const shoulderWidth = Math.abs(ls.x - rs.x)
  if (shoulderWidth < 0.08) return false

  const horizontal = [le, re, lw, rw].every(
    (point) => Math.abs(point.y - (ls.y + rs.y) / 2) < shoulderWidth * 0.45,
  )
  return horizontal && Math.abs(lw.x - rw.x) > shoulderWidth * 2.1
}

/** Screen-space centre after the selfie view is mirrored. */
export function playerScreenX(pose: NormalizedLandmark[]) {
  const visibleTorso = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip]
    .map((index) => pose[index])
    .filter(visible)
  if (!visibleTorso.length) return null
  return 1 - visibleTorso.reduce((sum, point) => sum + point.x, 0) / visibleTorso.length
}

export function inPlayerZone(screenX: number, playerIndex: number, playerCount: number) {
  if (playerCount === 1) return screenX >= 0.25 && screenX <= 0.75
  return playerIndex === 0 ? screenX >= 0.05 && screenX <= 0.45 : screenX >= 0.55 && screenX <= 0.95
}

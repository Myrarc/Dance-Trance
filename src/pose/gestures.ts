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

export type MenuGesture = 'previous' | 'next' | 'confirm' | 'back'
export type GestureContext = 'library' | 'lobby' | 'results'

export interface GestureHold {
  candidate: MenuGesture | null
  since: number
  latched: boolean
}

export interface GestureReading extends GestureHold {
  progress: number
  fired: MenuGesture | null
}

export const GESTURE_HOLD_MS = 850

const visible = (point: NormalizedLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.5

const reliableMenuPoint = (point: NormalizedLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.55

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

/** Static menu poses are intentionally scale-relative and require visible arm joints. */
export function detectMenuGesture(pose: NormalizedLandmark[] | undefined): MenuGesture | null {
  if (!pose) return null
  const nose = pose[0]
  const leftShoulder = pose[11]
  const rightShoulder = pose[12]
  const leftElbow = pose[13]
  const rightElbow = pose[14]
  const leftWrist = pose[15]
  const rightWrist = pose[16]
  if (![nose, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist].every(reliableMenuPoint)) return null

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x)
  if (shoulderWidth < 0.06) return null
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const armYAllowance = shoulderWidth * 0.42
  const leftOutward = Math.sign(leftShoulder.x - rightShoulder.x)

  const handsUp =
    leftWrist.y < nose.y &&
    rightWrist.y < nose.y &&
    leftElbow.y < shoulderY &&
    rightElbow.y < shoulderY
  if (handsUp) return 'confirm'

  const crossed =
    Math.hypot(leftWrist.x - rightShoulder.x, leftWrist.y - rightShoulder.y) < shoulderWidth * 0.62 &&
    Math.hypot(rightWrist.x - leftShoulder.x, rightWrist.y - leftShoulder.y) < shoulderWidth * 0.62
  if (crossed) return 'back'

  const leftExtended =
    Math.abs(leftWrist.y - leftShoulder.y) < armYAllowance &&
    Math.abs(leftElbow.y - leftShoulder.y) < armYAllowance &&
    (leftWrist.x - leftShoulder.x) * leftOutward > shoulderWidth * 0.9
  const rightExtended =
    Math.abs(rightWrist.y - rightShoulder.y) < armYAllowance &&
    Math.abs(rightElbow.y - rightShoulder.y) < armYAllowance &&
    (rightWrist.x - rightShoulder.x) * -leftOutward > shoulderWidth * 0.9

  // A T-pose extends both arms and belongs exclusively to player registration.
  if (leftExtended === rightExtended) return null
  return leftExtended ? 'previous' : 'next'
}

export function advanceGestureHold(
  state: GestureHold,
  gesture: MenuGesture | null,
  now: number,
  holdMs = GESTURE_HOLD_MS,
): GestureReading {
  if (!gesture) {
    return { candidate: null, since: 0, latched: false, progress: 0, fired: null }
  }
  if (state.latched) {
    return { ...state, progress: 1, fired: null }
  }
  if (state.candidate !== gesture) {
    return { candidate: gesture, since: now, latched: false, progress: 0, fired: null }
  }
  const progress = Math.min(1, Math.max(0, (now - state.since) / holdMs))
  if (progress < 1) return { ...state, progress, fired: null }
  return { candidate: gesture, since: state.since, latched: true, progress: 1, fired: gesture }
}

export function gestureLabel(gesture: MenuGesture, context: GestureContext): string {
  if (gesture === 'previous') return 'Previous song'
  if (gesture === 'next') return 'Next song'
  if (gesture === 'back') return context === 'library' ? 'Close song list' : 'Choose a song'
  if (context === 'library') return 'Load selected song'
  if (context === 'results') return 'Play again'
  return 'Start game'
}

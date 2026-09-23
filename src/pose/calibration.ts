import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { inPlayerZone, isTPose, playerScreenX } from './gestures.ts'
import { LM } from './skeleton.ts'

export type CalibrationIssue = 'missing' | 'zone' | 'body' | 'arms' | 'feet' | 'head' | 'distance' | 'sideways' | 'motion' | 'slow'
export type CalibrationPhase = 'framing' | 'movement' | 'passed' | 'failed'

export interface CalibrationPlayer {
  frames: number
  goodFrames: number
  movementFrames: number
  movementGoodFrames: number
  downStreak: number
  outStreak: number
  sawDown: boolean
  sawOut: boolean
  reason: CalibrationIssue | null
  issues: Partial<Record<CalibrationIssue, number>>
}

export interface CalibrationState {
  phase: CalibrationPhase
  playerCount: number
  startedAt: number
  phaseStartedAt: number
  players: CalibrationPlayer[]
}

const REQUIRED_VISIBILITY = 0.5
const EDGE = 0.015
const FRAMING_MS = 2200
const FRAMING_TIMEOUT_MS = 5000
const MOVEMENT_TIMEOUT_MS = 8000

function reliable(point: NormalizedLandmark | undefined): boolean {
  return !!point &&
    (point.visibility ?? 1) >= REQUIRED_VISIBILITY &&
    point.x >= EDGE && point.x <= 1 - EDGE &&
    point.y >= EDGE && point.y <= 1 - EDGE
}

/** Checks the raw detector output, before smoothing can conceal dropouts. */
export function assessCalibrationPose(
  pose: NormalizedLandmark[] | null | undefined,
  playerIndex: number,
  playerCount: number,
  trackHead = true,
): { reason: CalibrationIssue | null } {
  if (!pose) return { reason: 'missing' }
  if (![LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].every((index) => reliable(pose[index]))) {
    return { reason: 'body' }
  }
  const center = playerScreenX(pose)
  if (center === null || !inPlayerZone(center, playerIndex, playerCount)) return { reason: 'zone' }
  const torsoHeight = Math.abs((pose[LM.lHip].y + pose[LM.rHip].y - pose[LM.lShoulder].y - pose[LM.rShoulder].y) / 2)
  if (torsoHeight < 0.09 || torsoHeight > 0.55) return { reason: 'distance' }
  if (Math.abs(pose[LM.lShoulder].x - pose[LM.rShoulder].x) < 0.045) return { reason: 'sideways' }
  if (![LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist].every((index) => reliable(pose[index]))) {
    return { reason: 'arms' }
  }
  if (![LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle].every((index) => reliable(pose[index]))) {
    return { reason: 'feet' }
  }
  if (trackHead && !reliable(pose[LM.nose])) return { reason: 'head' }
  return { reason: null }
}

function armsDown(pose: NormalizedLandmark[]): boolean {
  const hipY = (pose[LM.lHip].y + pose[LM.rHip].y) / 2
  return pose[LM.lWrist].y > hipY - 0.06 && pose[LM.rWrist].y > hipY - 0.06
}

function mostCommonIssue(player: CalibrationPlayer): CalibrationIssue {
  const sorted = Object.entries(player.issues).sort((a, b) => b[1] - a[1])
  return (sorted[0]?.[0] as CalibrationIssue | undefined) ?? 'missing'
}

export function beginCalibration(playerCount: 1 | 2, nowMs: number): CalibrationState {
  return {
    phase: 'framing', playerCount, startedAt: nowMs, phaseStartedAt: nowMs,
    players: Array.from({ length: playerCount }, () => ({
      frames: 0, goodFrames: 0, movementFrames: 0, movementGoodFrames: 0,
      downStreak: 0, outStreak: 0, sawDown: false, sawOut: false,
      reason: null, issues: {},
    })),
  }
}

export function advanceCalibration(
  state: CalibrationState,
  poses: (NormalizedLandmark[] | null)[],
  nowMs: number,
  trackHead = true,
): CalibrationState {
  if (state.phase === 'passed' || state.phase === 'failed') return state
  const players = state.players.map((previous, index) => {
    const player = { ...previous, issues: { ...previous.issues } }
    const pose = poses[index]
    const { reason } = assessCalibrationPose(pose, index, state.playerCount, trackHead)
    if (state.phase === 'framing') {
      player.frames++
      if (reason === null) player.goodFrames++
    } else {
      player.movementFrames++
      if (reason === null && pose) {
        player.movementGoodFrames++
        if (!player.sawDown) {
          player.downStreak = armsDown(pose) ? player.downStreak + 1 : 0
          if (player.downStreak >= 2) player.sawDown = true
        } else if (!player.sawOut) {
          player.outStreak = isTPose(pose) ? player.outStreak + 1 : 0
          if (player.outStreak >= 2) player.sawOut = true
        }
      } else {
        player.downStreak = 0
        player.outStreak = 0
      }
    }
    if (reason) player.issues[reason] = (player.issues[reason] ?? 0) + 1
    return player
  })
  const elapsed = nowMs - state.phaseStartedAt
  if (state.phase === 'framing') {
    const good = players.every((player) => player.frames >= 20 && player.goodFrames / player.frames >= 0.75)
    if (elapsed >= FRAMING_MS && good) {
      return { ...state, phase: 'movement', phaseStartedAt: nowMs, players }
    }
    if (elapsed >= FRAMING_TIMEOUT_MS) {
      return { ...state, phase: 'failed', players: players.map((player) => ({
        ...player,
        reason: player.frames < 20 ? 'slow' : player.goodFrames / player.frames >= 0.75 ? null : mostCommonIssue(player),
      })) }
    }
  } else {
    const good = players.every((player) => player.sawOut &&
      player.movementFrames >= 12 && player.movementGoodFrames / player.movementFrames >= 0.7)
    if (elapsed >= 1000 && good) {
      return { ...state, phase: 'passed', players: players.map((player) => ({ ...player, reason: null })) }
    }
    if (elapsed >= MOVEMENT_TIMEOUT_MS) {
      return { ...state, phase: 'failed', players: players.map((player) => ({
        ...player,
        reason: player.movementGoodFrames / Math.max(1, player.movementFrames) < 0.7
          ? mostCommonIssue(player) : player.sawOut ? null : 'motion',
      })) }
    }
  }
  return { ...state, players }
}

export function canStartWithCalibration(
  lobbyReady: boolean,
  visiblePlayers: number,
  calibration: CalibrationState | null,
  bypassed: boolean,
): boolean {
  return lobbyReady && !!calibration && calibration.playerCount === visiblePlayers &&
    (calibration.phase === 'passed' || (calibration.phase === 'failed' && bypassed))
}

import type { HitTarget } from './hitTargets'

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'results'
export type HitGrade = 'perfect' | 'good' | 'miss'

export const HIT_WINDOW_S = 0.25

// These mirror the green/yellow limb tolerances: about 20° and 42° off target.
const PERFECT_MATCH = 78
const GOOD_MATCH = 53

export interface PlayerRound {
  score: number
  combo: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  judged: number
  nextTarget: number
  lastGrade: HitGrade | null
  bestMatch: number | null
}

export const newPlayerRound = (): PlayerRound => ({
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  judged: 0,
  nextTarget: 0,
  lastGrade: null,
  bestMatch: null,
})

export function gradeMatch(match: number | null): HitGrade {
  if (match !== null && match >= PERFECT_MATCH) return 'perfect'
  if (match !== null && match >= GOOD_MATCH) return 'good'
  return 'miss'
}

export function judgeDueTargets(
  player: PlayerRound,
  match: number | null | ((target: HitTarget) => number | null),
  time: number,
  targets: HitTarget[],
): PlayerRound {
  let next = player
  let sampled = false
  while (next.nextTarget < targets.length) {
    const target = targets[next.nextTarget]
    if (time < target.time - HIT_WINDOW_S) break

    if (!sampled && time <= target.time + HIT_WINDOW_S) {
      const reading = typeof match === 'function' ? match(target) : match
      sampled = true
      if (reading !== null && (next.bestMatch === null || reading > next.bestMatch)) {
        next = { ...next, bestMatch: reading }
      }
    }
    if (time < target.time + HIT_WINDOW_S) break

    const grade = gradeMatch(next.bestMatch)
    const combo = grade === 'miss' ? 0 : next.combo + 1
    const base = grade === 'perfect' ? 1000 : grade === 'good' ? 600 : 0
    next = {
      ...next,
      score: next.score + Math.round(base * (1 + Math.min(combo, 20) * 0.025)),
      combo,
      maxCombo: Math.max(next.maxCombo, combo),
      perfect: next.perfect + (grade === 'perfect' ? 1 : 0),
      good: next.good + (grade === 'good' ? 1 : 0),
      miss: next.miss + (grade === 'miss' ? 1 : 0),
      judged: next.judged + 1,
      nextTarget: next.nextTarget + 1,
      lastGrade: grade,
      bestMatch: null,
    }
  }
  return next
}

/** The reference confirms a run only after its video has rewound and started. */
export const isGameRunReady = (referenceRun: number, gameRun: number) =>
  gameRun > 0 && referenceRun === gameRun

/** Find a real earlier camera sample even when pose inference only runs at 2 FPS. */
export function movementBaseline<T>(
  history: { t: number; value: T }[],
  now: number,
  minAge = 0.2,
  maxAge = 1,
): T | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const age = now - history[index].t
    if (age >= minAge && age <= maxAge) return history[index].value
  }
  return null
}

export const accuracy = (player: PlayerRound) =>
  player.judged ? Math.round(((player.perfect + player.good * 0.6) / player.judged) * 100) : 0

/** Preserve player identity when two dancers cross left/right on camera. */
export function stablePlayerOrder<T extends { x: number }>(players: T[], previousX: number[]): T[] {
  if (players.length !== 2 || previousX.length !== 2) return [...players].sort((a, b) => a.x - b.x)
  const direct = Math.abs(players[0].x - previousX[0]) + Math.abs(players[1].x - previousX[1])
  const swapped = Math.abs(players[1].x - previousX[0]) + Math.abs(players[0].x - previousX[1])
  return direct <= swapped ? players : [players[1], players[0]]
}

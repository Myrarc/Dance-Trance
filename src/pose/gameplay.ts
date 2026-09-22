import type { HitTarget } from './hitTargets'

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'results'
export type HitGrade = 'perfect' | 'good' | 'miss'

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
})

export function gradeMatch(match: number | null): HitGrade {
  if (match !== null && match >= 85) return 'perfect'
  if (match !== null && match >= 65) return 'good'
  return 'miss'
}

export function judgeDueTargets(
  player: PlayerRound,
  match: number | null,
  time: number,
  targets: HitTarget[],
): PlayerRound {
  let next = player
  while (next.nextTarget < targets.length && targets[next.nextTarget].time <= time) {
    const grade = gradeMatch(match)
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
    }
  }
  return next
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

export interface BeatTracker {
  baseline: number
  previous: number
  lastBeat: number
}

export function sampleBeat(tracker: BeatTracker, energy: number, now: number): boolean {
  const baseline = tracker.baseline || energy
  const hit = energy > 35 && energy > baseline * 1.07 && energy > tracker.previous * 1.02 && now - tracker.lastBeat >= 330
  tracker.baseline = baseline * .96 + energy * .04
  tracker.previous = energy
  if (hit) tracker.lastBeat = now
  return hit
}

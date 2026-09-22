export function shouldInferFrame(frame: number, motionScore: number, threshold: number) {
  return frame % 3 !== 2 || motionScore >= threshold
}

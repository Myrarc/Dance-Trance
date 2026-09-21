export interface FrameMetrics {
  cameraFps: number
  trackingFps: number
  droppedFrames: number
}

/** Measures delivered camera frames separately from frames processed by pose inference. */
export class FrameMeter {
  private startedAt = -1
  private firstPresented = 0
  private lastPresented = 0
  private processed = 0
  private dropped = 0

  record(presentedFrames: number, nowMs: number): void {
    if (this.startedAt < 0) {
      this.startedAt = nowMs
      this.firstPresented = presentedFrames
    } else {
      this.dropped += Math.max(0, presentedFrames - this.lastPresented - 1)
    }
    this.lastPresented = presentedFrames
    this.processed++
  }

  snapshot(nowMs: number): FrameMetrics {
    const seconds = Math.max(0.001, (nowMs - this.startedAt) / 1000)
    return {
      cameraFps: Math.round((this.lastPresented - this.firstPresented) / seconds),
      trackingFps: Math.round(this.processed / seconds),
      droppedFrames: this.dropped,
    }
  }
}

export function frameTimestampMs(mediaTime: number, fallbackMs: number): number {
  return Number.isFinite(mediaTime) ? mediaTime * 1000 : fallbackMs
}

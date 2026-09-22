import { detect } from '@audio/beat'
import { AudioSampleSink, type Input } from 'mediabunny'

export interface RhythmTrack {
  bpm: number
  confidence: number
  beats: Float32Array
}

/** Decode the video's audio locally and return its musical beat grid. */
export async function analyseRhythm(input: Input): Promise<RhythmTrack | null> {
  const track = await input.getPrimaryAudioTrack()
  if (!track || !(await track.canDecode())) return null

  const sink = new AudioSampleSink(track)
  const chunks: Float32Array[] = []
  let length = 0
  let sampleRate = 0
  let stride = 1
  for await (const sample of sink.samples()) {
    if (!sampleRate) {
      // ponytail: cheap decimation is enough for beat energy; use a real resampler if tempo accuracy proves weak.
      stride = Math.max(1, Math.ceil(sample.sampleRate / 12_000))
      sampleRate = sample.sampleRate / stride
    }
    const mono = new Float32Array(Math.ceil(sample.numberOfFrames / stride))
    for (let channel = 0; channel < sample.numberOfChannels; channel++) {
      const plane = new Float32Array(sample.numberOfFrames)
      sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
      for (let frame = 0; frame < mono.length; frame++) {
        mono[frame] += plane[frame * stride] / sample.numberOfChannels
      }
    }
    sample.close()
    chunks.push(mono)
    length += mono.length
  }
  if (!length || !sampleRate) return null

  const mono = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    mono.set(chunk, offset)
    offset += chunk.length
  }
  const result = detect(mono, { fs: sampleRate, minBpm: 55, maxBpm: 210 })
  if (!Number.isFinite(result.bpm) || result.beats.length < 4) return null
  return {
    bpm: result.bpm,
    confidence: result.confidence,
    beats: Float32Array.from(result.beats),
  }
}

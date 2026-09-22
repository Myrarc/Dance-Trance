import { T } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { createPoseLandmarker } from '../pose/landmarker'
import { drawSkeleton, LEVEL_COLORS } from '../pose/skeleton'
import { computeAngles, compareToHistory, levelConnectionColors, dimmedSegments, HEAD, type Focus, type LagState, type PoseFeature } from '../pose/angles'
import { LandmarkSmoother } from '../pose/filter'
import { framingProblems } from '../pose/checkup'
import { FrameMeter, frameTimestampMs, type FrameMetrics } from '../pose/frameMeter'
import Checkup from './Checkup'
import { inPlayerZone, isTPose, playerScreenX } from '../pose/gestures'

/** Whether to mirror the comparison; 'auto' follows the reference's facing. */
type MirrorMode = 'auto' | 'mirror' | 'direct'
const READY_HOLD_MS = 1200

interface PlayerSetup {
  count: number
  progress: number[]
  inZone: boolean[]
  tPose: boolean[]
}
import type { TargetPose } from './VideoPanel'
import { recordSession } from '../playkitClient'

/** Practice accumulated against one phrase during a single session. */
export interface SectionPractice {
  seconds: number
  sumMatch: number
  samples: number
  bestMatch: number
}

interface Props {
  targetRef: React.MutableRefObject<TargetPose>
  /** Which dance is loaded, so practice is filed against it in the library. */
  videoId?: string
  videoName?: string
  /** Called when the camera stops, with what was practised per phrase. */
  onSectionPractice?: (deltas: Record<string, SectionPractice>) => void
  /** Which half of the body is being practised. */
  focus: Focus
  onFocusChange: (focus: Focus) => void
  showSkeletons: boolean
}

export default function WebcamPanel({
  targetRef,
  videoId,
  videoName,
  onSectionPractice,
  focus,
  onFocusChange,
  showSkeletons,
}: Props) {
  const focusRef = useRef<Focus>('full')
  focusRef.current = focus
  // Per-phrase totals for this session, plus the clock used to charge time to
  // whichever phrase was on screen.
  const sectionAccumRef = useRef<Record<string, SectionPractice>>({})
  const sectionClockRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const emaRef = useRef<number | null>(null)
  const lagRef = useRef<number | null>(null)
  // The lag estimate persists between frames so it can settle.
  const lagStateRef = useRef<LagState>({ lag: 0 })
  const smootherRef = useRef(new LandmarkSmoother())
  const playerSmoothersRef = useRef([new LandmarkSmoother(), new LandmarkSmoother()])
  const readyHoldRef = useRef([0, 0])
  const stableCountRef = useRef({ count: 0, since: 0 })
  const lobbyReadyRef = useRef(false)
  // Latest reading, so the guided check can sample without its own detector.
  const latestRef = useRef<{ feature: PoseFeature; framing: string[] } | null>(null)
  const lastUiRef = useRef(0)
  const mirrorModeRef = useRef<MirrorMode>('auto')

  // Aggregates for the practice session, so a signed-in dancer keeps a history
  // instead of a number that vanishes when the camera stops.
  const sessionRef = useRef({ startedAt: 0, sum: 0, count: 0, best: 0 })

  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMode, setMirrorMode] = useState<MirrorMode>('auto')
  const [mirroredNow, setMirroredNow] = useState(true)
  const [score, setScore] = useState<number | null>(null)
  const [lag, setLag] = useState<number | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [framing, setFraming] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [capture, setCapture] = useState({ width: 0, height: 0, fps: 0 })
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null)
  const [playerSetup, setPlayerSetup] = useState<PlayerSetup>({
    count: 0,
    progress: [],
    inZone: [],
    tPose: [],
  })
  const [lobbyReady, setLobbyReady] = useState(false)

  mirrorModeRef.current = mirrorMode

  // Asking every session is friction for something already agreed to, so if
  // the permission is on record the camera comes up by itself. Browsers that
  // do not answer the query simply keep the button.
  useEffect(() => {
    let cancelled = false
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === 'granted') void start()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      landmarkerRef.current?.close()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      landmarkerRef.current ??= await createPoseLandmarker(2, 'full')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
          facingMode: 'user',
        },
        audio: false,
      })
      streamRef.current = stream
      const settings = stream.getVideoTracks()[0]?.getSettings()
      setCapture({
        width: settings?.width ?? 0,
        height: settings?.height ?? 0,
        fps: settings?.frameRate ?? 0,
      })
      const v = videoRef.current!
      v.srcObject = stream
      await v.play()
      sessionRef.current = { startedAt: performance.now(), sum: 0, count: 0, best: 0 }
      readyHoldRef.current = [0, 0]
      stableCountRef.current = { count: 0, since: performance.now() }
      lobbyReadyRef.current = false
      setLobbyReady(false)
      setRunning(true)
    } catch (e) {
      console.error('webcam start failed', e)
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? T('Camera permission denied — allow it in your browser settings')
          : T('Could not start the camera'),
      )
    } finally {
      setStarting(false)
    }
  }

  const stop = () => {
    // Save before tearing down, while the aggregates are still intact.
    const s = sessionRef.current
    const seconds = s.startedAt ? Math.round((performance.now() - s.startedAt) / 1000) : 0
    // Ignore accidental blips — a two-second session is not practice.
    if (s.count > 0 && seconds >= 10) {
      void recordSession({
        at: new Date().toISOString(),
        seconds,
        averageMatch: Math.round(s.sum / s.count),
        bestMatch: Math.round(s.best),
        videoId,
        videoName,
      })
    }
    sessionRef.current = { startedAt: 0, sum: 0, count: 0, best: 0 }

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    const perSection = sectionAccumRef.current
    if (Object.keys(perSection).length) onSectionPractice?.(perSection)
    sectionAccumRef.current = {}
    sectionClockRef.current = 0

    emaRef.current = null
    lagRef.current = null
    lagStateRef.current = { lag: 0 }
    smootherRef.current.reset()
    playerSmoothersRef.current.forEach((smoother) => smoother.reset())
    readyHoldRef.current = [0, 0]
    lobbyReadyRef.current = false
    setRunning(false)
    setLobbyReady(false)
    setPlayerSetup({ count: 0, progress: [], inZone: [], tPose: [] })
    setScore(null)
    setLag(null)
    setProblems([])
    setMetrics(null)
    const cv = canvasRef.current
    cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
  }

  useEffect(() => {
    if (!running) return
    let handle = 0
    let fallbackFrames = 0
    let lastMetricsAt = 0
    const meter = new FrameMeter()

    const loop = (frameNow: number, metadata?: VideoFrameCallbackMetadata) => {
      const v = videoRef.current
      if (v) {
        if ('requestVideoFrameCallback' in v) handle = v.requestVideoFrameCallback(loop)
        else handle = requestAnimationFrame((time) => loop(time))
      }
      const cv = canvasRef.current
      const lmk = landmarkerRef.current
      if (!v || !cv || !lmk || v.readyState < 2 || v.videoWidth === 0) return

      const presentedFrames = metadata?.presentedFrames ?? ++fallbackFrames
      meter.record(presentedFrames, frameNow)
      const timestampMs = frameTimestampMs(metadata?.mediaTime ?? Number.NaN, frameNow)
      const res = lmk.detectForVideo(v, timestampMs)
      if (cv.width !== v.videoWidth || cv.height !== v.videoHeight) {
        cv.width = v.videoWidth
        cv.height = v.videoHeight
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, cv.width, cv.height)

      const detected = res.landmarks
        .map((pose, index) => ({ pose, world: res.worldLandmarks[index], x: playerScreenX(pose) }))
        .filter((player) => player.x !== null)
        .sort((a, b) => a.x! - b.x!)
        .slice(0, 2)
      const count = detected.length
      if (stableCountRef.current.count !== count) {
        stableCountRef.current = { count, since: frameNow }
        readyHoldRef.current = [0, 0]
      }

      const setup: PlayerSetup = { count, progress: [], inZone: [], tPose: [] }
      const poses = detected.map((player, index) => {
        const pose = playerSmoothersRef.current[index].filter(player.pose, timestampMs / 1000)
        const inZone = inPlayerZone(player.x!, index, count)
        const tPose = isTPose(pose)
        if (!lobbyReadyRef.current && inZone && tPose) readyHoldRef.current[index] ||= frameNow
        else if (!lobbyReadyRef.current) readyHoldRef.current[index] = 0
        setup.inZone.push(inZone)
        setup.tPose.push(tPose)
        setup.progress.push(
          readyHoldRef.current[index]
            ? Math.min(1, (frameNow - readyHoldRef.current[index]) / READY_HOLD_MS)
            : 0,
        )
        return pose
      })

      if (
        !lobbyReadyRef.current &&
        count > 0 &&
        frameNow - stableCountRef.current.since > 500 &&
        setup.progress.every((progress) => progress >= 1)
      ) {
        lobbyReadyRef.current = true
        setLobbyReady(true)
      }

      const raw = poses[0]
      const world = detected[0]?.world
      // Steady the landmarks before anything reads them, so a body holding
      // still produces a still skeleton and a steady score.
      const pose = raw ? smootherRef.current.filter(raw, timestampMs / 1000) : undefined
      const target = targetRef.current
      let frameScore: number | null = null
      let frameProblems: string[] = []
      let frameLag: number | null = null
      if (pose && world && lobbyReadyRef.current) {
        const user = computeAngles(world)
        const framingNow = framingProblems(pose, focusRef.current)
        latestRef.current = { feature: user, framing: framingNow }
        // You always face your own camera, so mirroring is only right when the
        // reference dancer faces theirs.
        const mirrored =
          mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
        const cmp = compareToHistory(user, target.history, target.time, mirrored, lagStateRef.current, focusRef.current)
        drawSkeleton(ctx, pose, cv.width, cv.height, {
          color: LEVEL_COLORS.na,
          lineWidth: 7,
          connectionColors: target.feature ? levelConnectionColors(cmp.levels, LEVEL_COLORS) : undefined,
          headColor: target.feature ? LEVEL_COLORS[cmp.levels[HEAD] ?? 'na'] : undefined,
          dimmed: dimmedSegments(focusRef.current),
        })
        frameScore = cmp.score
        frameProblems = cmp.problems
        frameLag = cmp.lag
      }
      if (!lobbyReadyRef.current) {
        for (const playerPose of poses) {
          drawSkeleton(ctx, playerPose, cv.width, cv.height, {
            color: LEVEL_COLORS.na,
            lineWidth: 7,
          })
        }
      } else if (poses[1]) {
        drawSkeleton(ctx, poses[1], cv.width, cv.height, {
          color: '#43e8ff',
          lineWidth: 7,
        })
      }

      // Charge elapsed time to the phrase that was playing, but only while a
      // score exists — standing off-camera between takes is not practice.
      const clockNow = performance.now()
      const elapsed = sectionClockRef.current ? (clockNow - sectionClockRef.current) / 1000 : 0
      sectionClockRef.current = clockNow
      const sid = target.sectionId
      if (sid && frameScore !== null && elapsed > 0 && elapsed < 1) {
        const acc = (sectionAccumRef.current[sid] ??= {
          seconds: 0,
          sumMatch: 0,
          samples: 0,
          bestMatch: 0,
        })
        acc.seconds += elapsed
        acc.sumMatch += frameScore
        acc.samples++
        if (frameScore > acc.bestMatch) acc.bestMatch = frameScore
      }

      if (frameScore !== null) {
        emaRef.current = emaRef.current === null ? frameScore : emaRef.current * 0.85 + frameScore * 0.15
        // Accumulate on the smoothed value: a single noisy frame shouldn't
        // become someone's "best match".
        const s = sessionRef.current
        s.sum += emaRef.current
        s.count++
        if (emaRef.current > s.best) s.best = emaRef.current
      } else {
        emaRef.current = null
      }
      // Lag is smoothed hard: it is a tendency worth naming, not a per-frame
      // number, and a twitchy readout would be unusable mid-dance.
      if (frameLag !== null) {
        lagRef.current = lagRef.current === null ? frameLag : lagRef.current * 0.9 + frameLag * 0.1
      }

      const now = performance.now()
      if (now - lastUiRef.current > 200) {
        lastUiRef.current = now
        setScore(emaRef.current === null ? null : Math.round(emaRef.current))
        setProblems(frameProblems)
        setLag(lagRef.current)
        setFraming(latestRef.current?.framing ?? [])
        setMirroredNow(
          mirrorModeRef.current === 'auto'
            ? targetRef.current.facing !== 'back'
            : mirrorModeRef.current === 'mirror',
        )
        if (!lobbyReadyRef.current) setPlayerSetup(setup)
      }
      if (frameNow - lastMetricsAt >= 1000) {
        lastMetricsAt = frameNow
        setMetrics(meter.snapshot(frameNow))
      }
    }
    const v = videoRef.current
    if (v && 'requestVideoFrameCallback' in v) handle = v.requestVideoFrameCallback(loop)
    else handle = requestAnimationFrame((time) => loop(time))
    return () => {
      if (v && 'cancelVideoFrameCallback' in v) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [running, targetRef])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{T('You')}</h2>
        <span className="hint">
          {T(!running ? 'Turn on your camera to follow along' : lobbyReady ? `${playerSetup.count || 1} player${playerSetup.count === 1 ? '' : 's'} ready` : 'Player check')}
        </span>
      </div>

      <div className="stage mirrored webcam-stage">
        <video ref={videoRef} playsInline muted />
        <canvas
          ref={canvasRef}
          className={showSkeletons ? undefined : 'skeleton-hidden'}
          aria-hidden={!showSkeletons}
        />
        {running && !lobbyReady && (
          <div className={`player-lobby ${playerSetup.count === 1 ? 'solo' : ''}`} aria-live="polite">
            {(playerSetup.count === 1 ? [0] : [0, 1]).map((index) => {
              const detected = index < playerSetup.count
              const progress = playerSetup.progress[index] ?? 0
              const instruction = !detected
                ? 'Step into this area'
                : !playerSetup.inZone[index]
                  ? 'Move inside the area'
                  : !playerSetup.tPose[index]
                    ? 'Hold a T-pose'
                    : `${Math.round(progress * 100)}%`
              return (
                <div key={index} className={`player-zone ${progress >= 1 ? 'ready' : ''}`}>
                  <strong>{playerSetup.count === 1 ? 'PLAYER' : `PLAYER ${index + 1}`}</strong>
                  <span>{instruction}</span>
                  <i style={{ transform: `scaleX(${progress})` }} />
                </div>
              )
            })}
          </div>
        )}
        {!running && (
          <div className="stage-overlay">
            <button className="btn primary" onClick={start} disabled={starting}>
              {T(starting ? 'Starting…' : 'Turn on camera')}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {running && lobbyReady && framing.length > 0 && !checking && (
          <div className="framing-warning">
            {framing.map((f) => (
              <p key={f}>{T(f)}</p>
            ))}
          </div>
        )}
        {import.meta.env.DEV && running && checking && (
          <div className="stage-overlay checkup-overlay">
            <Checkup read={() => latestRef.current} onClose={() => setChecking(false)} />
          </div>
        )}
        {running && lobbyReady && !checking && (
          <div className="score-badge">
            <span className="score-num">{score ?? '—'}</span>
            <span className="score-label">match</span>
            {lag !== null && (
              <span className="score-lag">
                {lag < 0.15 ? 'in time' : `${lag.toFixed(1)}s behind`}
              </span>
            )}
          </div>
        )}
        {running && metrics && (
          <div className="tracking-diagnostics">
            {capture.width}×{capture.height} · camera {capture.fps ? Math.round(capture.fps) : '—'} fps · tracking{' '}
            {metrics.trackingFps} fps
            {metrics.droppedFrames > 0 ? ` · skipped ${metrics.droppedFrames}` : ''}
          </div>
        )}
      </div>

      <div className="controls">
        <div className="ctrl-group">
          {running && (
            <button className="btn" onClick={stop}>
              {T('Stop camera')}
            </button>
          )}
          <span className="ctrl-label">{T('Practise')}</span>
          {(
            [
              ['full', T('Whole body'), T('Score everything')],
              ['upper', T('Arms only'), T('Only arms and head are scored — your legs need not be in frame')],
              ['lower', T('Legs only'), T('Only legs are scored — stand back so your feet are visible')],
            ] as const
          ).map(([mode, label, tip]) => (
            <button
              key={mode}
              className={`btn ${focus === mode ? 'active' : ''}`}
              onClick={() => onFocusChange(mode)}
              title={tip}
            >
              {label}
            </button>
          ))}
          {import.meta.env.DEV && running && !checking && (
            <button className="btn subtle" onClick={() => setChecking(true)} title={T('Follow a few poses so the scoring can be checked against known answers')}>
              {T('Check accuracy')}
            </button>
          )}
          {/* Auto is right almost always, so this is one button that reports
              what it decided rather than three that ask you to decide. */}
          <button
            className={`btn subtle ${mirrorMode === 'auto' ? '' : 'active'}`}
            onClick={() =>
              setMirrorMode(
                mirrorMode === 'auto' ? 'mirror' : mirrorMode === 'mirror' ? 'direct' : 'auto',
              )
            }
            title={T('Whether your left should mirror the dancer, or match their side. Auto reads which way they are facing.')}
          >
            {mirrorMode === 'auto'
              ? `${T('Sides: auto')} · ${mirroredNow ? T('mirrored') : T('same side')}`
              : mirrorMode === 'mirror'
                ? T('Sides: mirrored')
                : T('Sides: same side')}
          </button>
        </div>
        <div className="ctrl-group problems" aria-live="polite">
          <span className="hint watch-message" title={problems.join('、')}>
            {running && problems.length > 0 ? (
              <>{T('Watch')}: <b>{problems.join('、')}</b></>
            ) : '\u00a0'}
          </span>
        </div>
      </div>
    </section>
  )
}

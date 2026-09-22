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
import {
  advanceGestureHold,
  detectMenuGesture,
  gestureLabel,
  inPlayerZone,
  isTPose,
  playerScreenX,
  type GestureContext,
  type GestureHold,
  type MenuGesture,
} from '../pose/gestures'
import {
  judgeDueCues,
  isGameRunReady,
  newPlayerRound,
  gradeMatch,
  scoreCue,
  stablePlayerOrder,
  type CueFrame,
  type GamePhase,
  type HitGrade,
  type PlayerRound,
} from '../pose/gameplay'
import type { CueEvent } from '../pose/hitTargets'

/** Whether to mirror the comparison; 'auto' follows the reference's facing. */
type MirrorMode = 'auto' | 'mirror' | 'direct'
const READY_HOLD_MS = 1200
const LIVE_INFERENCE_INTERVAL_MS = 50
const LIVE_INPUT_WIDTH = 640
const GESTURE_BEEP_GAP_MS = 400

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
  trackHead?: boolean
  gamePhase?: GamePhase
  gameRun?: number
  onLobbyChange?: (ready: boolean, players: number) => void
  onGameScores?: (players: PlayerRound[]) => void
  onHit?: (grade: Exclude<HitGrade, 'miss'>, target: CueEvent) => void
  onScoreDebug?: (entries: ScoreDebug[]) => void
  gestureContext?: GestureContext | null
  onGestureAction?: (gesture: MenuGesture) => void
}

export interface ScoreDebug {
  player: number
  cue: CueEvent['kind']
  movement: number | null
  match: number | null
  lag: number
  grade: HitGrade
}

export default function WebcamPanel({
  targetRef,
  videoId,
  videoName,
  onSectionPractice,
  focus,
  onFocusChange,
  showSkeletons,
  trackHead = true,
  gamePhase = 'lobby',
  gameRun = 0,
  onLobbyChange,
  onGameScores,
  onHit,
  onScoreDebug,
  gestureContext = null,
  onGestureAction,
}: Props) {
  const focusRef = useRef<Focus>('full')
  focusRef.current = focus
  const trackHeadRef = useRef(trackHead)
  trackHeadRef.current = trackHead
  // Per-phrase totals for this session, plus the clock used to charge time to
  // whichever phrase was on screen.
  const sectionAccumRef = useRef<Record<string, SectionPractice>>({})
  const sectionClockRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const emaRef = useRef<number | null>(null)
  const lagRef = useRef<number | null>(null)
  // The lag estimate persists between frames so it can settle.
  const lagStatesRef = useRef<LagState[]>([{ lag: 0 }, { lag: 0 }])
  const movementHistoryRef = useRef<{ t: number; value: CueFrame }[][]>([[], []])
  const playerSmoothersRef = useRef([new LandmarkSmoother(), new LandmarkSmoother()])
  const playerWorldSmoothersRef = useRef([new LandmarkSmoother(), new LandmarkSmoother()])
  const readyHoldRef = useRef([0, 0])
  const stableCountRef = useRef({ count: 0, since: 0 })
  const lobbyReadyRef = useRef(false)
  const playerXRef = useRef<number[]>([])
  const registeredPlayerCountRef = useRef(1)
  const roundsRef = useRef<PlayerRound[]>([newPlayerRound(), newPlayerRound()])
  const gestureHoldRef = useRef<GestureHold>({ candidate: null, since: 0, latched: false })
  const gestureContextRef = useRef(gestureContext)
  const onGestureActionRef = useRef(onGestureAction)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gestureSequenceRef = useRef(0)
  // Latest reading, so the guided check can sample without its own detector.
  const latestRef = useRef<{ feature: PoseFeature; framing: string[] } | null>(null)
  const lastUiRef = useRef(0)
  const lastInferenceAtRef = useRef(0)
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
  const [gestureFeedback, setGestureFeedback] = useState<{ gesture: MenuGesture | null; progress: number }>({
    gesture: null,
    progress: 0,
  })
  const playerSetupCountRef = useRef(playerSetup.count)
  playerSetupCountRef.current = playerSetup.count

  mirrorModeRef.current = mirrorMode
  gestureContextRef.current = gestureContext
  onGestureActionRef.current = onGestureAction
  const gameplaySkeletonsVisible = showSkeletons || gamePhase === 'countdown' || gamePhase === 'playing'

  useEffect(() => {
    if (!gestureHoldRef.current.latched) {
      gestureHoldRef.current = { candidate: null, since: 0, latched: false }
    }
    setGestureFeedback({ gesture: null, progress: 0 })
  }, [gestureContext])

  useEffect(() => {
    if (gamePhase !== 'countdown') return
    // The reference video may still expose the previous round's final time for
    // one camera frame while it is being rewound. Do not let that stale clock
    // consume the new round's targets as misses.
    registeredPlayerCountRef.current = Math.max(1, playerSetupCountRef.current)
    roundsRef.current = [newPlayerRound(), newPlayerRound()]
    lagStatesRef.current = [{ lag: 0 }, { lag: 0 }]
    movementHistoryRef.current = [[], []]
    onGameScores?.(roundsRef.current.slice(0, registeredPlayerCountRef.current))
  }, [gamePhase, gameRun, onGameScores])

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
      landmarkerRef.current ??= await createPoseLandmarker(2)
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
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        audioContextRef.current ??= new AudioContextClass()
        await audioContextRef.current.resume()
      }
      sessionRef.current = { startedAt: performance.now(), sum: 0, count: 0, best: 0 }
      readyHoldRef.current = [0, 0]
      stableCountRef.current = { count: 0, since: performance.now() }
      lobbyReadyRef.current = false
      gestureHoldRef.current = { candidate: null, since: 0, latched: false }
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

  const runGestureConfirmation = (gesture: MenuGesture) => {
    const sequence = ++gestureSequenceRef.current
    void (async () => {
      for (let index = 0; index < 3; index++) {
        if (sequence !== gestureSequenceRef.current) return
        const audio = audioContextRef.current
        if (audio) {
          const oscillator = audio.createOscillator()
          const gain = audio.createGain()
          oscillator.type = 'square'
          oscillator.frequency.value = index === 1 ? 660 : 880
          gain.gain.setValueAtTime(0.0001, audio.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + 0.01)
          gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.1)
          oscillator.connect(gain)
          gain.connect(audio.destination)
          oscillator.start()
          oscillator.stop(audio.currentTime + 0.11)
        }
        if (index < 2) await new Promise((resolve) => window.setTimeout(resolve, GESTURE_BEEP_GAP_MS))
      }
      if (sequence === gestureSequenceRef.current) onGestureActionRef.current?.(gesture)
    })()
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
    lagStatesRef.current = [{ lag: 0 }, { lag: 0 }]
    movementHistoryRef.current = [[], []]
    playerSmoothersRef.current.forEach((smoother) => smoother.reset())
    playerWorldSmoothersRef.current.forEach((smoother) => smoother.reset())
    readyHoldRef.current = [0, 0]
    lobbyReadyRef.current = false
    gestureHoldRef.current = { candidate: null, since: 0, latched: false }
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
    lastInferenceAtRef.current = 0
    let handle = 0
    let fallbackFrames = 0
    let lastMetricsAt = performance.now()
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
      if (frameNow - lastInferenceAtRef.current < LIVE_INFERENCE_INTERVAL_MS) return
      lastInferenceAtRef.current = frameNow

      const presentedFrames = metadata?.presentedFrames ?? ++fallbackFrames
      meter.record(presentedFrames, frameNow)
      const timestampMs = frameTimestampMs(metadata?.mediaTime ?? Number.NaN, frameNow)
      const input = (inferenceCanvasRef.current ??= document.createElement('canvas'))
      const inputHeight = Math.round(LIVE_INPUT_WIDTH * v.videoHeight / v.videoWidth)
      if (input.width !== LIVE_INPUT_WIDTH || input.height !== inputHeight) {
        input.width = LIVE_INPUT_WIDTH
        input.height = inputHeight
      }
      input.getContext('2d')!.drawImage(v, 0, 0, input.width, input.height)
      const res = lmk.detectForVideo(input, timestampMs)
      if (cv.width !== v.videoWidth || cv.height !== v.videoHeight) {
        cv.width = v.videoWidth
        cv.height = v.videoHeight
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, cv.width, cv.height)

      const detectedByX = res.landmarks
        .map((pose, index) => ({ pose, world: res.worldLandmarks[index], x: playerScreenX(pose) }))
        .filter((player) => player.x !== null)
        .sort((a, b) => a.x! - b.x!)
        .slice(0, 2)
      const detected = stablePlayerOrder(
        detectedByX.map((player) => ({ ...player, x: player.x! })),
        playerXRef.current,
      )
      if (gamePhase !== 'playing' || registeredPlayerCountRef.current === detected.length) {
        playerXRef.current = detected.map((player) => player.x)
      }
      const count = detected.length
      const registeredPlayerCount = registeredPlayerCountRef.current
      const scoreSlots = detected.map((player, index) => {
        if (registeredPlayerCount !== 2 || detected.length === 2 || playerXRef.current.length !== 2) return index
        return Math.abs(player.x - playerXRef.current[0]) <= Math.abs(player.x - playerXRef.current[1]) ? 0 : 1
      })
      const players = detected.map((player, index) => {
        const slot = scoreSlots[index] ?? index
        return {
          ...player,
          pose: playerSmoothersRef.current[slot].filter(player.pose, timestampMs / 1000),
          world: player.world
            ? playerWorldSmoothersRef.current[slot].filter(player.world, timestampMs / 1000)
            : undefined,
        }
      })
      if (stableCountRef.current.count !== count) {
        stableCountRef.current = { count, since: frameNow }
        readyHoldRef.current = [0, 0]
      }

      const setup: PlayerSetup = { count, progress: [], inZone: [], tPose: [] }
      const poses = players.map((player, index) => {
        const pose = player.pose
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

      const pose = poses[0]
      const world = players[0]?.world
      let gestureReading = {
        ...gestureHoldRef.current,
        progress: gestureHoldRef.current.latched ? 1 : 0,
        fired: null as MenuGesture | null,
      }
      if (lobbyReadyRef.current && gestureContextRef.current) {
        gestureReading = advanceGestureHold(
          gestureHoldRef.current,
          detectMenuGesture(pose),
          frameNow,
        )
        gestureHoldRef.current = gestureReading
        if (gestureReading.fired) runGestureConfirmation(gestureReading.fired)
      }
      const target = targetRef.current
      let frameScore: number | null = null
      const frameScores: (number | null)[] = Array.from({ length: registeredPlayerCount }, () => null)
      const playerFrames: (CueFrame | null)[] = Array.from({ length: registeredPlayerCount }, () => null)
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
        const cmp = compareToHistory(
          user,
          target.history,
          target.time,
          mirrored,
          lagStatesRef.current[scoreSlots[0] ?? 0],
          focusRef.current,
          trackHeadRef.current,
        )
        drawSkeleton(ctx, pose, cv.width, cv.height, {
          color: LEVEL_COLORS.na,
          lineWidth: 7,
          connectionColors: target.feature ? levelConnectionColors(cmp.levels, LEVEL_COLORS) : undefined,
          headColor: target.feature ? LEVEL_COLORS[cmp.levels[HEAD] ?? 'na'] : undefined,
          dimmed: dimmedSegments(focusRef.current),
        })
        frameScore = cmp.score
        frameScores[scoreSlots[0] ?? 0] = cmp.score
        playerFrames[scoreSlots[0] ?? 0] = { feature: user, landmarks: pose }
        frameProblems = cmp.problems
        frameLag = cmp.lag
      }
      if (lobbyReadyRef.current && poses[1] && players[1]?.world) {
        const second = computeAngles(players[1].world)
        const mirrored =
          mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
        const slot = scoreSlots[1] ?? 1
        const cmp = compareToHistory(
          second,
          target.history,
          target.time,
          mirrored,
          lagStatesRef.current[slot],
          focusRef.current,
          trackHeadRef.current,
        )
        frameScores[slot] = cmp.score
        playerFrames[slot] = { feature: second, landmarks: poses[1] }
        drawSkeleton(ctx, poses[1], cv.width, cv.height, {
          color: LEVEL_COLORS.na,
          lineWidth: 7,
          connectionColors: target.feature ? levelConnectionColors(cmp.levels, LEVEL_COLORS) : undefined,
          headColor: target.feature ? LEVEL_COLORS[cmp.levels[HEAD] ?? 'na'] : undefined,
          dimmed: dimmedSegments(focusRef.current),
        })
      }

      if (gamePhase === 'playing' && isGameRunReady(target.gameRun, gameRun) && target.cueChart?.length) {
        const cameraTime = frameNow / 1000
        for (let index = 0; index < registeredPlayerCount; index++) {
          const frame = playerFrames[index]
          if (!frame) continue
          const history = movementHistoryRef.current[index]
          history.push({ t: cameraTime, value: frame })
          while (history.length > 1 && history[0].t < cameraTime - 2.2) history.shift()
        }
        let changed = false
        let hitGrade: Exclude<HitGrade, 'miss'> | null = null
        let hitTarget: CueEvent | null = null
        const scoreDebug: ScoreDebug[] = []
        for (let index = 0; index < registeredPlayerCount; index++) {
          const before = roundsRef.current[index]
          const frame = playerFrames[index]
          const mirrored = mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
          const after = judgeDueCues(
            before,
            (cue) => {
              const reading = scoreCue(
                cue,
                frame,
                movementHistoryRef.current[index],
                cameraTime,
                mirrored,
                trackHeadRef.current,
              )
              scoreDebug.push({
                player: index + 1,
                cue: cue.kind,
                movement: reading.movement,
                match: reading.match,
                lag: lagStatesRef.current[index].lag,
                grade: gradeMatch(reading.match),
              })
              return reading.match
            },
            target.time,
            target.cueChart,
          )
          roundsRef.current[index] = after
          if (after !== before) {
            changed = true
            if (after.perfect > before.perfect) {
              hitGrade = 'perfect'
              hitTarget = target.cueChart[before.nextTarget]
            } else if (after.good > before.good && hitGrade !== 'perfect') {
              hitGrade = 'good'
              hitTarget = target.cueChart[before.nextTarget]
            }
          }
        }
        if (hitGrade && hitTarget) onHit?.(hitGrade, hitTarget)
        if (scoreDebug.length) onScoreDebug?.(scoreDebug)
        if (changed) onGameScores?.(roundsRef.current.slice(0, registeredPlayerCount))
      }
      if (!lobbyReadyRef.current) {
        for (const playerPose of poses) {
          drawSkeleton(ctx, playerPose, cv.width, cv.height, {
            color: LEVEL_COLORS.na,
            lineWidth: 7,
          })
        }
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
        onLobbyChange?.(lobbyReadyRef.current, count)
        setGestureFeedback({ gesture: gestureReading.candidate, progress: gestureReading.progress })
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
  }, [running, targetRef, gamePhase, gameRun, onGameScores, onHit, onLobbyChange, onScoreDebug])

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
          className={gameplaySkeletonsVisible ? undefined : 'skeleton-hidden'}
          aria-hidden={!gameplaySkeletonsVisible}
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
        {running && lobbyReady && gestureContext && !checking && (
          <div className={`gesture-command${gestureFeedback.gesture ? '' : ' is-idle'}`} aria-live="polite">
            <strong>{gestureFeedback.gesture ? gestureLabel(gestureFeedback.gesture, gestureContext) : 'Gesture controls ready'}</strong>
            <span>
              {gestureFeedback.gesture
                ? gestureFeedback.progress >= 1 ? 'Return to neutral' : 'Hold steady'
                : gestureContext === 'results' ? 'Right hand: replay · cross arms: songs' : 'Make a navigation gesture'}
            </span>
            <i style={{ transform: `scaleX(${gestureFeedback.progress})` }} />
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

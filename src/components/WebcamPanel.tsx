import { L, T } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import { createPoseLandmarker } from '../pose/landmarker'
import { drawSkeleton, LEVEL_COLORS, LM } from '../pose/skeleton'
import { computeAngles, compareToHistory, levelConnectionColors, dimmedSegments, HEAD, type Focus, type LagState, type PoseFeature } from '../pose/angles'
import { LandmarkSmoother } from '../pose/filter'
import { framingProblems } from '../pose/checkup'
import { FrameMeter, frameTimestampMs, type FrameMetrics } from '../pose/frameMeter'
import { advanceCalibration, beginCalibration, type CalibrationIssue, type CalibrationState } from '../pose/calibration'
import { createPlayerLock, matchPlayerLock, registrationCandidates, type ColorSignature, type PlayerLock } from '../pose/playerLock'
import { CameraRequestTimeoutError, requestCameraStream } from '../lib/cameraStream'
import Checkup from './Checkup'
import {
  advanceGestureFromPose,
  gestureLabel,
  inPlayerZone,
  isRightHandRaised,
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
const APPEARANCE_SAMPLE_SIZE = 8
const EMPTY_GESTURE_HOLD: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }

/** A tiny chest crop helps distinguish dancers without storing or sending camera images. */
function sampleTorsoColor(input: HTMLCanvasElement, sample: HTMLCanvasElement, pose: NormalizedLandmark[]): ColorSignature | null {
  const [left, right, leftHip, rightHip] = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((index) => pose[index])
  if ([left, right, leftHip, rightHip].some((point) => !point || (point.visibility ?? 1) < 0.5)) return null
  const shoulderY = (left.y + right.y) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const shoulderWidth = Math.abs(left.x - right.x)
  if (hipY <= shoulderY || shoulderWidth < 0.04) return null
  const centerX = (left.x + right.x) / 2
  const x0 = Math.max(0, centerX - shoulderWidth * 0.2)
  const x1 = Math.min(1, centerX + shoulderWidth * 0.2)
  const y0 = Math.max(0, shoulderY + (hipY - shoulderY) * 0.25)
  const y1 = Math.min(1, shoulderY + (hipY - shoulderY) * 0.65)
  if ((x1 - x0) * input.width < 4 || (y1 - y0) * input.height < 4) return null
  if (sample.width !== APPEARANCE_SAMPLE_SIZE || sample.height !== APPEARANCE_SAMPLE_SIZE) {
    sample.width = APPEARANCE_SAMPLE_SIZE
    sample.height = APPEARANCE_SAMPLE_SIZE
  }
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(input, x0 * input.width, y0 * input.height, (x1 - x0) * input.width, (y1 - y0) * input.height,
    0, 0, APPEARANCE_SAMPLE_SIZE, APPEARANCE_SAMPLE_SIZE)
  const pixels = ctx.getImageData(0, 0, APPEARANCE_SAMPLE_SIZE, APPEARANCE_SAMPLE_SIZE).data
  let r = 0, g = 0, b = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    r += pixels[offset]
    g += pixels[offset + 1]
    b += pixels[offset + 2]
  }
  const count = APPEARANCE_SAMPLE_SIZE ** 2
  return { r: r / count, g: g / count, b: b / count }
}
const CALIBRATION_ADVICE: Record<CalibrationIssue, string> = {
  missing: 'Step into view and keep the camera clear.',
  zone: 'Move into your marked player area.',
  body: 'Keep your shoulders and hips visible.',
  arms: 'Keep both elbows and wrists inside the picture.',
  feet: 'Step back until both knees and ankles are visible.',
  head: 'Keep your head visible and face the camera.',
  distance: 'Adjust your distance so your whole body fits clearly.',
  sideways: 'Face the camera more directly.',
  motion: 'Lower your right arm, then raise your right hand above your head.',
  slow: 'Tracking is too slow for a reliable check. Close other camera apps.',
}

interface PlayerSetup {
  count: number
  detected: boolean[]
  progress: number[]
  inZone: boolean[]
  rightHandRaised: boolean[]
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
  requireCalibration?: boolean
  registrationPlayers?: 1 | 2
  onRegistrationPlayersChange?: (count: 1 | 2) => void
  onCalibrationChange?: (state: CalibrationState | null) => void
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
  requireCalibration = false,
  registrationPlayers = 1,
  onRegistrationPlayersChange,
  onCalibrationChange,
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
  const appearanceCanvasRef = useRef<HTMLCanvasElement | null>(null)
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
  const playerLockRef = useRef<PlayerLock | null>(null)
  const registrationPlayersRef = useRef(registrationPlayers)
  registrationPlayersRef.current = registrationPlayers
  const registeredPlayerCountRef = useRef(1)
  const roundsRef = useRef<PlayerRound[]>([newPlayerRound(), newPlayerRound()])
  const gestureHoldRef = useRef<GestureHold>({ ...EMPTY_GESTURE_HOLD })
  const gestureContextRef = useRef(gestureContext)
  const onGestureActionRef = useRef(onGestureAction)
  const audioContextRef = useRef<AudioContext | null>(null)
  // Latest reading, so the guided check can sample without its own detector.
  const latestRef = useRef<{ feature: PoseFeature; framing: string[] } | null>(null)
  const lastUiRef = useRef(0)
  const lastInferenceAtRef = useRef(0)
  const calibrationRef = useRef<CalibrationState | null>(null)
  const requireCalibrationRef = useRef(requireCalibration)
  requireCalibrationRef.current = requireCalibration
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
  const [capture, setCapture] = useState({ width: 0, height: 0 })
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null)
  const [calibration, setCalibration] = useState<CalibrationState | null>(null)
  const [trackingLost, setTrackingLost] = useState(false)
  const [playerSetup, setPlayerSetup] = useState<PlayerSetup>({
    count: registrationPlayers,
    detected: [],
    progress: [],
    inZone: [],
    rightHandRaised: [],
  })
  const [lobbyReady, setLobbyReady] = useState(false)
  const [gestureFeedback, setGestureFeedback] = useState<{ gesture: MenuGesture | null; progress: number }>({
    gesture: null,
    progress: 0,
  })
  const livePlayerCountRef = useRef(0)

  mirrorModeRef.current = mirrorMode
  gestureContextRef.current = gestureContext
  onGestureActionRef.current = onGestureAction
  const gameplaySkeletonsVisible = showSkeletons || calibration?.phase === 'framing' || calibration?.phase === 'movement'

  const beginCheck = () => {
    const count = playerLockRef.current?.slots.length ?? livePlayerCountRef.current
    if (!running || (count !== 1 && count !== 2)) return
    const next = beginCalibration(count, performance.now())
    calibrationRef.current = next
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', latched: true }
    setCalibration(next)
    onCalibrationChange?.(next)
  }

  const resetPlayers = useCallback(() => {
    playerLockRef.current = null
    registeredPlayerCountRef.current = registrationPlayersRef.current
    readyHoldRef.current = [0, 0]
    stableCountRef.current = { count: 0, since: performance.now() }
    lobbyReadyRef.current = false
    livePlayerCountRef.current = 0
    playerSmoothersRef.current.forEach((smoother) => smoother.reset())
    playerWorldSmoothersRef.current.forEach((smoother) => smoother.reset())
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    latestRef.current = null
    emaRef.current = null
    lagRef.current = null
    setScore(null)
    setLag(null)
    calibrationRef.current = null
    setCalibration(null)
    setLobbyReady(false)
    setTrackingLost(false)
    setPlayerSetup({ count: registrationPlayersRef.current, detected: [], progress: [], inZone: [], rightHandRaised: [] })
    onCalibrationChange?.(null)
    onLobbyChange?.(false, 0)
  }, [onCalibrationChange, onLobbyChange])

  useEffect(() => {
    if (running && gamePhase === 'lobby') resetPlayers()
  }, [registrationPlayers, running, gamePhase, resetPlayers])

  useEffect(() => {
    if (!gestureHoldRef.current.latched) {
      gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    }
    setGestureFeedback({ gesture: null, progress: 0 })
  }, [gestureContext])

  useEffect(() => {
    if (gamePhase !== 'countdown') return
    // The reference video may still expose the previous round's final time for
    // one camera frame while it is being rewound. Do not let that stale clock
    // consume the new round's targets as misses.
    registeredPlayerCountRef.current = playerLockRef.current?.slots.length ?? registrationPlayersRef.current
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
      const stream = await requestCameraStream(navigator.mediaDevices, {
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
      playerLockRef.current = null
      lobbyReadyRef.current = false
      gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
      setLobbyReady(false)
      setRunning(true)
    } catch (e) {
      console.error('webcam start failed', e)
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? T('Camera permission denied — allow it in your browser settings')
          : e instanceof CameraRequestTimeoutError
            ? T('Camera did not respond — check browser permission and try again')
          : T('Could not start the camera'),
      )
    } finally {
      setStarting(false)
    }
  }

  const playGestureBeep = (step: 1 | 2 | 3) => {
    const audio = audioContextRef.current
    if (!audio) return
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = step === 2 ? 660 : 880
    gain.gain.setValueAtTime(0.0001, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.1)
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + 0.11)
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
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    setRunning(false)
    setLobbyReady(false)
    setPlayerSetup({ count: registrationPlayersRef.current, detected: [], progress: [], inZone: [], rightHandRaised: [] })
    playerLockRef.current = null
    livePlayerCountRef.current = 0
    setTrackingLost(false)
    onLobbyChange?.(false, 0)
    setScore(null)
    setLag(null)
    setProblems([])
    setMetrics(null)
    calibrationRef.current = null
    setCalibration(null)
    onCalibrationChange?.(null)
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

      const detected = res.landmarks
        .map((pose, index) => ({ pose, world: res.worldLandmarks[index], x: playerScreenX(pose) }))
        .filter((player) => player.x !== null)
        .map((player) => ({ ...player, x: player.x!, appearance: sampleTorsoColor(
          input, appearanceCanvasRef.current ??= document.createElement('canvas'), player.pose,
        ) }))
      const lock = playerLockRef.current
      const registrationIndices = lock ? [] : registrationCandidates(detected.map((player) => player.pose), registrationPlayersRef.current)
      const match = lock ? matchPlayerLock(lock, detected.map((player) => player.pose), frameNow, detected.map((player) => player.appearance)) : null
      if (lock && match && match.indices[0] !== null && frameNow - lock.slots[0].lastSeenAt > 750) {
        gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', since: frameNow, latched: true }
      }
      if (match) playerLockRef.current = match.state
      const matched = (match?.indices ?? registrationIndices).map((index) => index === null ? null : detected[index])
      const count = matched.filter(Boolean).length
      livePlayerCountRef.current = count
      const registeredPlayerCount = registeredPlayerCountRef.current
      const players = matched.map((player, slot) => player ? {
          ...player,
          pose: playerSmoothersRef.current[slot].filter(player.pose, timestampMs / 1000),
          world: player.world
            ? playerWorldSmoothersRef.current[slot].filter(player.world, timestampMs / 1000)
            : undefined,
        } : null)
      if (!lobbyReadyRef.current && stableCountRef.current.count !== count) {
        stableCountRef.current = { count, since: frameNow }
        readyHoldRef.current = [0, 0]
      }

      const setup: PlayerSetup = { count: registrationPlayersRef.current, detected: [], progress: [], inZone: [], rightHandRaised: [] }
      const poses = players.map((player, index) => {
        const pose = player?.pose
        const inZone = !!player && inPlayerZone(player.x, index, registrationPlayersRef.current)
        const rightHandRaised = !!pose && isRightHandRaised(pose)
        if (!lobbyReadyRef.current && inZone && rightHandRaised) readyHoldRef.current[index] ||= frameNow
        else if (!lobbyReadyRef.current) readyHoldRef.current[index] = 0
        setup.detected.push(!!pose)
        setup.inZone.push(inZone)
        setup.rightHandRaised.push(rightHandRaised)
        setup.progress.push(
          readyHoldRef.current[index]
            ? Math.min(1, (frameNow - readyHoldRef.current[index]) / READY_HOLD_MS)
            : 0,
        )
        return pose ?? null
      })

      if (
        !lobbyReadyRef.current &&
        count === registrationPlayersRef.current &&
        frameNow - stableCountRef.current.since > 500 &&
        setup.progress.every((progress) => progress >= 1)
      ) {
        playerLockRef.current = createPlayerLock(matched.map((player) => player!.pose), frameNow,
          matched.map((player) => player!.appearance))
        gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', since: frameNow, latched: true }
        registeredPlayerCountRef.current = registrationPlayersRef.current
        lobbyReadyRef.current = true
        setLobbyReady(true)
      }

      if (lobbyReadyRef.current && requireCalibrationRef.current && !calibrationRef.current) {
        const next = beginCalibration(registrationPlayersRef.current, frameNow)
        calibrationRef.current = next
        setCalibration(next)
        onCalibrationChange?.(next)
      }
      const activeCheck = calibrationRef.current
      if (activeCheck && (activeCheck.phase === 'framing' || activeCheck.phase === 'movement')) {
        const checkPoses = matched.map((player) => player?.pose ?? null)
        const next = advanceCalibration(activeCheck, checkPoses, frameNow, trackHeadRef.current)
        calibrationRef.current = next
        if (next.phase !== activeCheck.phase) {
          setCalibration(next)
          onCalibrationChange?.(next)
        }
      }

      const pose = poses[0]
      const world = players[0]?.world
      let gestureReading = {
        ...gestureHoldRef.current,
        progress: gestureHoldRef.current.latched ? 1 : 0,
        beep: null as 1 | 2 | 3 | null,
        fired: null as MenuGesture | null,
      }
      if (lobbyReadyRef.current && gestureContextRef.current && calibrationRef.current?.phase !== 'framing' && calibrationRef.current?.phase !== 'movement') {
        gestureReading = advanceGestureFromPose(gestureHoldRef.current, pose ?? undefined, frameNow)
        gestureHoldRef.current = gestureReading
        if (gestureReading.beep) playGestureBeep(gestureReading.beep)
        if (gestureReading.fired) onGestureActionRef.current?.(gestureReading.fired)
      }
      const target = targetRef.current
      let frameScore: number | null = null
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
          lagStatesRef.current[0],
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
        playerFrames[0] = { feature: user, landmarks: pose }
        frameProblems = cmp.problems
        frameLag = cmp.lag
      }
      if (lobbyReadyRef.current && poses[1] && players[1]?.world) {
        const second = computeAngles(players[1].world)
        const mirrored =
          mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
        const cmp = compareToHistory(
          second,
          target.history,
          target.time,
          mirrored,
          lagStatesRef.current[1],
          focusRef.current,
          trackHeadRef.current,
        )
        playerFrames[1] = { feature: second, landmarks: poses[1] }
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
          if (!playerPose) continue
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
        if (gamePhase === 'lobby') setPlayerSetup(setup)
        setTrackingLost(!!playerLockRef.current?.slots.some((slot) => frameNow - slot.lastSeenAt > 750))
        if (calibrationRef.current?.phase === 'framing' || calibrationRef.current?.phase === 'movement') {
          setCalibration(calibrationRef.current)
        }
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
  }, [running, targetRef, gamePhase, gameRun, onGameScores, onHit, onLobbyChange, onScoreDebug, onCalibrationChange])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{T('You')}</h2>
        <span className="hint">
          {!running
            ? T('Turn on your camera to follow along')
            : lobbyReady
              ? L(`${playerSetup.count || 1} player${playerSetup.count === 1 ? '' : 's'} ready`, `${playerSetup.count || 1} 位玩家已准备`)
              : T('Player check')}
        </span>
      </div>

      <div className="stage mirrored webcam-stage">
        <video ref={videoRef} playsInline muted aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className={gameplaySkeletonsVisible ? undefined : 'skeleton-hidden'}
          aria-hidden={!gameplaySkeletonsVisible}
        />
        {running && !lobbyReady && (
          <div className={`player-lobby ${playerSetup.count === 1 ? 'solo' : ''}`} aria-live="polite">
            {(playerSetup.count === 1 ? [0] : [0, 1]).map((index) => {
              const detected = playerSetup.detected[index] ?? false
              const progress = playerSetup.progress[index] ?? 0
              const instruction = !detected
                ? T('Step into this area')
                : !playerSetup.inZone[index]
                  ? T('Move inside the area')
                  : !playerSetup.rightHandRaised[index]
                    ? T('Right hand up · left hand down')
                    : `${Math.round(progress * 100)}%`
              return (
                <div key={index} className={`player-zone ${progress >= 1 ? 'ready' : ''}`}>
                  <strong>{playerSetup.count === 1 ? T('PLAYER') : `${T('PLAYER')} ${index + 1}`}</strong>
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
        {running && gamePhase === 'lobby' && lobbyReady && calibration && !checking && (
          <div className="calibration-card" role="status" aria-live="polite">
            <strong>{T(calibration.phase === 'framing' ? 'Checking full-body tracking' : calibration.phase === 'movement' ? 'Checking movement tracking' : calibration.phase === 'passed' ? 'Tracking check passed' : 'Tracking needs attention')}</strong>
            <p>{T(calibration.phase === 'framing' ? 'Stand in your area with your whole body visible.' : calibration.phase === 'movement' ? 'Lower your right arm, then raise your right hand above your head.' : calibration.phase === 'passed' ? 'Your pose stayed visible and your right arm movement was detected.' : 'Adjust your camera setup and try again. You can still play with reduced tracking quality.')}</p>
            {(calibration.phase === 'passed' || calibration.phase === 'failed') && (
              <ul>
                {calibration.players.map((player, index) => (
                  <li key={index}>
                    <b>{L(`Player ${index + 1}`, `玩家 ${index + 1}`)}</b>
                    <span>{player.reason ? T(CALIBRATION_ADVICE[player.reason]) : L(`${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}% full-body visibility`, `全身可见率 ${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}%`)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(calibration.phase === 'passed' || calibration.phase === 'failed') && <button className="btn subtle" onClick={beginCheck}>{T('Check again')}</button>}
          </div>
        )}
        {running && lobbyReady && trackingLost && (
          <div className="tracking-lock-warning" role="status">
            {T('Tracking lost — return to your area and hold your right hand up to relock.')}
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
            <span className="score-label">{T('match')}</span>
            {lag !== null && (
              <span className="score-lag">
                {lag < 0.15 ? T('in time') : L(`${lag.toFixed(1)}s behind`, `慢 ${lag.toFixed(1)} 秒`)}
              </span>
            )}
          </div>
        )}
        {running && lobbyReady && gestureContext && !checking && calibration?.phase !== 'framing' && calibration?.phase !== 'movement' && (
          <div className={`gesture-command${gestureFeedback.gesture ? '' : ' is-idle'}`} aria-live="polite">
            <strong>{gestureFeedback.gesture ? T(gestureLabel(gestureFeedback.gesture, gestureContext)) : T('Gesture controls ready')}</strong>
            <span>
              {gestureFeedback.gesture
                ? gestureFeedback.progress >= 1 ? T('Return to neutral') : T('Hold steady')
                : gestureContext === 'results' ? T('Right hand: replay · cross arms: songs') : T('Make a navigation gesture')}
            </span>
            <i style={{ transform: `scaleX(${gestureFeedback.progress})` }} />
          </div>
        )}
        {running && metrics && (
          <div className="tracking-diagnostics">
            {capture.width}×{capture.height} · camera {metrics.cameraFps} fps · tracking{' '}
            {metrics.trackingFps} fps
            {metrics.droppedFrames > 0 ? ` · skipped ${metrics.droppedFrames}` : ''}
          </div>
        )}
      </div>

      <div className="controls">
        <div className="ctrl-group">
          {gamePhase === 'lobby' && !requireCalibration && onRegistrationPlayersChange && ([1, 2] as const).map((count) => (
            <button key={count} className={`btn ${registrationPlayers === count ? 'active' : ''}`} aria-pressed={registrationPlayers === count} onClick={() => onRegistrationPlayersChange(count)}>
              {L(`${count} player${count === 1 ? '' : 's'}`, `${count} 位玩家`)}
            </button>
          ))}
          {running && (
            <button className="btn" onClick={stop}>
              {T('Stop camera')}
            </button>
          )}
          {running && gamePhase === 'lobby' && lobbyReady && (
            <button className="btn" onClick={resetPlayers}>{T('Register players again')}</button>
          )}
          {running && gamePhase === 'lobby' && lobbyReady && !requireCalibration && (calibration?.phase !== 'framing' && calibration?.phase !== 'movement') && (
            <button className="btn" onClick={beginCheck}>{T('Check tracking')}</button>
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

import { useCallback, useEffect, useRef, useState } from 'react'
import VideoPanel, { type TargetPose } from './components/VideoPanel'
import WebcamPanel, { type ScoreDebug } from './components/WebcamPanel'
import AccountBar from './components/AccountBar'
import Library from './components/Library'
import { T, L, useLangTick, LangGlobe } from './i18n'
import { LEVEL_COLORS, SIDE_COLORS } from './pose/skeleton'
import type { Focus } from './pose/angles'
import {
  analyseVideo,
  packTrack,
  unpackTrack,
  type AnalysisMetrics,
  type PoseTrack,
} from './pose/track'
import {
  addSectionPractice,
  forget,
  getTrack,
  getVideo,
  listLibrary,
  mergeRemote,
  remember,
  saveSections,
  saveTrack,
  touch,
  type LibraryEntry,
  type Section,
} from './lib/library'
import {
  loadLibraryIndex,
  loadSessions,
  onAuthChange,
  statsByVideo,
  syncLibrary,
  type VideoStats,
} from './playkitClient'
import { loadSkeletonsVisible, saveSkeletonsVisible } from './lib/skeletonVisibility'
import { loadTrackHead, saveTrackHead } from './lib/headTrackPreference'
import { accuracy, type GamePhase, type HitGrade, type PlayerRound } from './pose/gameplay'
import type { HitTarget } from './pose/hitTargets'
import type { GestureContext, MenuGesture } from './pose/gestures'

type OnboardingStep = 'welcome' | 'camera' | 'gesture' | null
const ONBOARDING_KEY = 'dance-trance:onboarding-complete'

function initialOnboarding(): OnboardingStep {
  try {
    return localStorage.getItem(ONBOARDING_KEY) ? null : 'welcome'
  } catch {
    return 'welcome'
  }
}

function GestureIcon({ pose }: { pose: 'previous' | 'select' | 'next' }) {
  return (
    <svg viewBox="0 0 48 52" aria-hidden="true">
      <circle cx="24" cy="8" r="5" />
      <path d="M24 15V34M24 34L16 48M24 34L32 48" />
      {pose === 'previous' && <path d="M24 20L14 23L4 23M24 20L34 27L36 38" />}
      {pose === 'select' && <path d="M24 20L14 27L12 38M24 20L34 13L36 3" />}
      {pose === 'next' && <path d="M24 20L14 27L12 38M24 20L34 23L44 23" />}
    </svg>
  )
}

function GestureGuide({ showBack = false }: { showBack?: boolean }) {
  const steps = [
    { pose: 'previous', label: 'Previous' },
    { pose: 'select', label: 'Select' },
    { pose: 'next', label: 'Next' },
  ] as const

  return (
    <div className="gesture-guide" aria-label="Gesture controls">
      <strong className="gesture-guide-title">Gesture controls</strong>
      <div className="gesture-steps">
        {steps.map(({ pose, label }) => (
          <span className="gesture-step" key={pose}>
            <GestureIcon pose={pose} />
            <b>{label}</b>
          </span>
        ))}
      </div>
      {showBack && <small>Cross arms for songs / close</small>}
    </div>
  )
}

export default function App() {
  const [src, setSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [stats, setStats] = useState<Map<string, VideoStats>>(new Map())
  const [current, setCurrent] = useState<LibraryEntry | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [focus, setFocus] = useState<Focus>('full')
  const [track, setTrack] = useState<PoseTrack | null>(null)
  const [analysing, setAnalysing] = useState<number | null>(null)
  const [analysisMetrics, setAnalysisMetrics] = useState<AnalysisMetrics | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null)
  const [showSkeletons, setShowSkeletons] = useState(loadSkeletonsVisible)
  const [trackHead, setTrackHead] = useState(loadTrackHead)
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby')
  const [countdown, setCountdown] = useState(3)
  const [gameRun, setGameRun] = useState(0)
  const [lobby, setLobby] = useState({ ready: false, players: 0 })
  const [gamePlayers, setGamePlayers] = useState<PlayerRound[]>([])
  const [scoreDebug, setScoreDebug] = useState<ScoreDebug[]>([])
  const [hitFeedback, setHitFeedback] = useState<{
    id: number
    grade: Exclude<HitGrade, 'miss'>
    target: HitTarget
  } | null>(null)
  const [gestureSelectedId, setGestureSelectedId] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingStep>(initialOnboarding)
  const targetRef = useRef<TargetPose>({
    feature: null,
    history: [],
    time: 0,
    gameRun: 0,
    facing: null,
    sectionId: null,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hitFeedbackIdRef = useRef(0)

  const completeOnboarding = () => {
    try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* Continue without persistence. */ }
    setOnboarding(null)
  }

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])

  const refresh = useCallback(async () => {
    setLibrary(await listLibrary())
  }, [])

  /** Reconciles this device with the account, in both directions. */
  const syncFromAccount = useCallback(async () => {
    // Push first. Most people play for a while and only sign up once they like
    // it, so by the time an account exists the library already has entries in
    // it — and pulling alone would silently strand every one of them on this
    // device. syncLibrary is a no-op while signed out.
    const local = await listLibrary()
    if (local.length) {
      await syncLibrary(
        local.map((e) => ({
          id: e.id,
          name: e.name,
          duration: e.duration,
          lastOpenedAt: e.lastOpenedAt,
        })),
      )
    }

    const [sessions, remote] = await Promise.all([loadSessions(), loadLibraryIndex()])
    setStats(statsByVideo(sessions))
    if (remote.length) {
      await mergeRemote(remote)
      await refresh()
    }
  }, [refresh])

  useEffect(() => {
    void refresh()
    void syncFromAccount()
    return onAuthChange(() => void syncFromAccount())
  }, [refresh, syncFromAccount])

  // A dance that has been analysed loads its track; anything else falls back to
  // detecting live, so nothing here is required for the app to work.
  const currentId = current?.id ?? null
  useEffect(() => {
    let cancelled = false
    setTrack(null)
    setAnalysisMetrics(null)
    setAnalysisMessage(null)
    if (!currentId) return
    void getTrack(currentId).then((stored) => {
      const decoded = stored ? unpackTrack(stored) : null
      if (!cancelled && decoded?.rhythmAnalysed) setTrack(decoded)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  useEffect(() => {
    setGamePhase('lobby')
    setLobby({ ready: false, players: 0 })
    setGamePlayers([])
  }, [currentId])

  useEffect(() => {
    if (gamePhase !== 'playing') {
      setHitFeedback(null)
      setScoreDebug([])
    }
  }, [gamePhase])

  useEffect(() => {
    if (onboarding === 'camera' && lobby.ready) setOnboarding('gesture')
  }, [lobby.ready, onboarding])

  useEffect(() => {
    if (!library.length) {
      setGestureSelectedId(null)
      return
    }
    setGestureSelectedId((selected) =>
      selected && library.some((entry) => entry.id === selected)
        ? selected
        : currentId ?? library[0].id,
    )
  }, [currentId, library])

  useEffect(() => {
    if (gamePhase !== 'countdown') return
    setCountdown(3)
    const started = performance.now()
    const timer = window.setInterval(() => {
      const remaining = 3 - Math.floor((performance.now() - started) / 1000)
      if (remaining <= 0) {
        clearInterval(timer)
        setGamePhase('playing')
      } else setCountdown(remaining)
    }, 100)
    return () => clearInterval(timer)
  }, [gamePhase, gameRun])

  const startRound = () => {
    if (!track || !lobby.ready) return
    setGamePlayers([])
    setGameRun((run) => run + 1)
    setGamePhase('countdown')
  }

  const finishRound = () => {
    setGamePhase((phase) => (phase === 'playing' ? 'results' : phase))
  }

  const updateLobby = useCallback((ready: boolean, players: number) => {
    setLobby((current) => current.ready === ready && current.players === players ? current : { ready, players })
  }, [])

  const updateGameScores = useCallback((players: PlayerRound[]) => setGamePlayers(players), [])
  const updateScoreDebug = useCallback((entries: ScoreDebug[]) => {
    setScoreDebug((current) => {
      const next = [...current]
      for (const entry of entries) next[entry.player - 1] = entry
      return next
    })
  }, [])
  const showHit = useCallback((grade: Exclude<HitGrade, 'miss'>, target: HitTarget) => {
    setHitFeedback({ id: ++hitFeedbackIdRef.current, grade, target })
  }, [])

  const analyseBlob = async (entry: LibraryEntry, blob: Blob) => {
    if (analysing != null) return
    setAnalysing(0)
    setAnalysisMetrics(null)
    setAnalysisMessage(null)
    try {
      const result = await analyseVideo(
        blob,
        (f) => setAnalysing(f),
        () => false,
        setAnalysisMetrics,
        (reason) => setAnalysisMessage(`Fast analysis unavailable (${reason}); using compatibility mode`),
      )
      if (result) {
        await saveTrack(entry.id, packTrack(result))
        setTrack(result)
        setAnalysisMessage(null)
        await refresh()
      }
    } catch (error) {
      setAnalysisMessage(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalysing(null)
    }
  }

  const analyse = async () => {
    if (!current || analysing != null) return
    const blob = await getVideo(current.id)
    if (blob) await analyseBlob(current, blob)
  }

  const play = (blob: Blob) => {
    setSrc((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(blob)
    })
  }

  const loadFile = async (file: File | undefined | null) => {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('Please choose a video file')
      return
    }
    play(file)
    setLibraryOpen(false)
    const entry = await remember(file)
    setCurrent(entry)
    await refresh()
    if (entry) {
      void syncLibrary([
        { id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt },
      ])
      const stored = await getTrack(entry.id)
      const decoded = stored ? unpackTrack(stored) : null
      if (decoded?.rhythmAnalysed) setTrack(decoded)
      else await analyseBlob(entry, file)
    }
  }

  const openEntry = async (entry: LibraryEntry) => {
    const blob = await getVideo(entry.id)
    if (!blob) {
      // The record survived but the file did not — the only way back is for the
      // browser to hand us the file again.
      fileInputRef.current?.click()
      return
    }
    play(blob)
    setCurrent(entry)
    setLibraryOpen(false)
    await touch(entry.id)
    await refresh()
    const stored = await getTrack(entry.id)
    const decoded = stored ? unpackTrack(stored) : null
    if (decoded?.rhythmAnalysed) setTrack(decoded)
    else await analyseBlob(entry, blob)
  }

  /** Sections belong to the dance, so they live with it in the library. */
  const updateSections = async (sections: Section[]) => {
    if (!current) return
    const ordered = [...sections].sort((a, b) => a.start - b.start)
    // Update in place so the panel does not wait on a round trip to IndexedDB.
    setCurrent({ ...current, sections: ordered })
    setLibrary((all) => all.map((e) => (e.id === current.id ? { ...e, sections: ordered } : e)))
    await saveSections(current.id, ordered)
  }

  const recordSectionPractice = async (deltas: Parameters<typeof addSectionPractice>[1]) => {
    if (!current) return
    await addSectionPractice(current.id, deltas)
    const fresh = await listLibrary()
    setLibrary(fresh)
    setCurrent(fresh.find((e) => e.id === current.id) ?? current)
  }

  const forgetEntry = async (entry: LibraryEntry) => {
    await forget(entry.id)
    if (current?.id === entry.id) setCurrent(null)
    await refresh()
  }

  const libraryVisible = libraryOpen || !src
  const gestureContext: GestureContext | null =
    onboarding === 'gesture'
      ? 'lobby'
      : libraryVisible && library.length
      ? 'library'
      : src && gamePhase === 'results'
        ? 'results'
        : src && gamePhase === 'lobby' && lobby.ready
          ? 'lobby'
          : null

  const handleGestureAction = (gesture: MenuGesture) => {
    if (onboarding === 'gesture') {
      if (gesture === 'confirm') {
        completeOnboarding()
        if (library.length) setLibraryOpen(true)
      }
      return
    }
    if (gestureContext === 'library') {
      if (gesture === 'back' && src) {
        setLibraryOpen(false)
        return
      }
      if (gesture === 'confirm') {
        const selected = library.find((entry) => entry.id === gestureSelectedId)
        if (selected) void openEntry(selected)
        return
      }
      if (gesture === 'previous' || gesture === 'next') {
        const currentIndex = Math.max(0, library.findIndex((entry) => entry.id === gestureSelectedId))
        const step = gesture === 'previous' ? -1 : 1
        const nextIndex = (currentIndex + step + library.length) % library.length
        setGestureSelectedId(library[nextIndex].id)
      }
      return
    }
    if (gestureContext === 'lobby') {
      if (gesture === 'confirm') startRound()
      if (gesture === 'back') setLibraryOpen(true)
      return
    }
    if (gestureContext === 'results') {
      if (gesture === 'confirm') startRound()
      if (gesture === 'back') {
        setGamePhase('lobby')
        setLibraryOpen(true)
      }
    }
  }

  useLangTick()
  return (
    <div className={`app ${gamePhase === 'countdown' || gamePhase === 'playing' ? 'game-screen-active' : ''}`}>
      <LangGlobe />
      {onboarding === 'welcome' && (
        <section className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
          <div className="welcome-card">
            <span className="welcome-step">Ready when you are</span>
            <h2 id="welcome-title">Your video.<br />Your moves.<br />Your arcade.</h2>
            <p>Turn any dance video into a local one or two-player rhythm game. Camera and video processing stay on this device.</p>
            <div className="welcome-actions">
              <button className="btn primary" onClick={() => setOnboarding('camera')}>Let’s dance</button>
              <button className="btn subtle" onClick={completeOnboarding}>Skip setup</button>
            </div>
          </div>
        </section>
      )}
      <header>
        <h1 className="brand-lockup">
          <span className="brand-dance">Dance</span>
          <span className="brand-trance">Trance</span>
          <span className="sub">{T('Your moves light up the room')}</span>
        </h1>
        {library.length > 0 && (
          <button
            className={`btn ${libraryOpen ? 'active' : ''}`}
            onClick={() => setLibraryOpen(!libraryOpen)}
            title={T('Dances you have opened before')}
          >
            {L(`Library (${library.length})`, `舞蹈库（${library.length}）`)}
          </button>
        )}
        <button
          className="btn subtle"
          aria-pressed={!showSkeletons}
          onClick={() =>
            setShowSkeletons((visible) => {
              const next = !visible
              saveSkeletonsVisible(next)
              return next
            })
          }
          title={T('Show or hide both pose overlays')}
        >
          {T(showSkeletons ? 'Hide skeletons' : 'Show skeletons')}
        </button>
        <button
          className={`btn subtle ${!trackHead ? 'active' : ''}`}
          aria-pressed={!trackHead}
          onClick={() =>
            setTrackHead((active) => {
              const next = !active
              saveTrackHead(next)
              return next
            })
          }
          title={T("Don't use head track — hides head hit markers and excludes head from score")}
        >
          {T(trackHead ? "Don't use head track" : 'Use head track')}
        </button>
        <label className="btn primary upload">
          {T(src ? 'Change video' : 'Load video')}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              void loadFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <AccountBar />
        <button className="btn subtle" onClick={() => setOnboarding('welcome')}>Setup</button>
      </header>

      {onboarding === 'camera' && (
        <aside className="onboarding-coach" aria-live="polite">
          <b>1 / 2 · Meet the camera</b>
          <strong>Turn on the camera, step into a zone, then hold a T-pose.</strong>
          <span>We’ll continue as soon as you’re registered.</span>
          <button className="btn subtle" onClick={completeOnboarding}>Skip</button>
        </aside>
      )}
      {onboarding === 'gesture' && (
        <aside className="onboarding-coach gesture-coach" aria-live="polite">
          <b>2 / 2 · Your first control</b>
          <span className="onboarding-gesture"><GestureIcon pose="select" /></span>
          <strong>Raise your right hand and hold to continue.</strong>
          <span>The live gesture meter will confirm it.</span>
          <button className="btn subtle" onClick={completeOnboarding}>Skip</button>
        </aside>
      )}
      {libraryOpen && library.length > 0 && (
        <section className="library-panel">
          <div className="library-title-row">
            <h2>Pick a track</h2>
            <span>Good songs · brighter moves</span>
          </div>
          <GestureGuide showBack />
          <Library
            entries={library}
            stats={stats}
            currentId={current?.id ?? null}
            selectedId={gestureSelectedId}
            onOpen={(e) => void openEntry(e)}
            onForget={(e) => void forgetEntry(e)}
          />
          <p className="hint library-note">
            Videos are kept on this device only. Signed in, the list and your practice totals follow
            you; the footage does not.
          </p>
        </section>
      )}

      {src && gamePhase !== 'countdown' && (
        <section className={`game-flow game-${gamePhase}`} aria-live="polite">
          {gamePhase === 'lobby' && (
            <>
              <div>
                <strong>{track ? (lobby.ready ? `${lobby.players} player${lobby.players === 1 ? '' : 's'} ready` : 'Player lobby') : 'Analysing song'}</strong>
                <span>{!track ? 'Hit markers are required before playing' : lobby.ready ? 'Raise your right hand to start · cross arms for songs' : 'Enter the camera zones and hold a T-pose'}</span>
              </div>
              <button className="btn primary" onClick={startRound} disabled={!track || !lobby.ready}>
                Start game
              </button>
            </>
          )}
          {gamePhase === 'playing' && (
            <div className="game-score-strip">
              {(gamePlayers.length ? gamePlayers : Array.from({ length: Math.max(1, lobby.players) }, () => null)).map((player, index) => (
                <span key={index}>
                  <b>P{index + 1}</b> {player?.score.toLocaleString() ?? '0'}
                  <small>{player?.combo ? `${player.combo}× combo` : 'build your combo'}</small>
                  {import.meta.env.DEV && scoreDebug[index] && (
                    <small className="score-debug">
                      {scoreDebug[index].joint} · move {scoreDebug[index].movement?.toFixed(0) ?? '—'}° · match {scoreDebug[index].match ?? '—'} · {scoreDebug[index].grade} · lag {Math.round(scoreDebug[index].lag * 1000)}ms
                    </small>
                  )}
                </span>
              ))}
            </div>
          )}
          {gamePhase === 'results' && (
            <div className="results-card">
              <h2>Final score</h2>
              <div className={`result-players${gamePlayers.length > 1 ? ' is-multiplayer' : ''}`}>
                {gamePlayers.map((player, index) => (
                  <article key={index}>
                    <h3>Player {index + 1}</h3>
                    <strong className="result-score">{player.score.toLocaleString()}</strong>
                    <div className="result-breakdown">
                      <span>{accuracy(player)}% accuracy · {player.maxCombo}× max combo</span>
                      <small>{player.perfect} perfect · {player.good} good · {player.miss} miss</small>
                    </div>
                  </article>
                ))}
              </div>
              <div className="result-actions">
                <button className="btn primary" onClick={startRound}>Play again</button>
                <button className="btn" onClick={() => { setGamePhase('lobby'); setLibraryOpen(true) }}>Choose another song</button>
              </div>
              <p className="gesture-hint">Right hand up to replay · cross arms to choose a song</p>
            </div>
          )}
        </section>
      )}

      <main className={`panels ${gamePhase === 'countdown' || gamePhase === 'playing' ? 'game-active' : gamePhase === 'results' ? 'game-results-stage' : ''}`}>
        {src ? (
          <VideoPanel
            src={src}
            targetRef={targetRef}
            sections={current?.sections ?? []}
            sectionStats={current?.sectionStats}
            onSectionsChange={(sections) => void updateSections(sections)}
            focus={focus}
            track={track}
            onAnalyse={() => void analyse()}
            analysing={analysing}
            analysisMetrics={analysisMetrics}
            analysisMessage={analysisMessage}
            showSkeletons={showSkeletons}
            trackHead={trackHead}
            gamePhase={gamePhase}
            countdown={countdown}
            gameRun={gameRun}
            onGameEnd={finishRound}
            hitFeedback={hitFeedback}
          />
        ) : (
          <section
            className={`panel dropzone ${dragOver ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void loadFile(e.dataTransfer.files?.[0])
            }}
          >
            <div className="drop-inner">
              <p className="drop-title">Pick a track</p>
              <p>{T('Drop a dance video here, or load one from the top right')}</p>
              <p className="hint">
                {T('Solo or group video · click a dancer to follow them · pose detection runs locally, your video is never uploaded')}
              </p>
              {library.length > 0 && (
                <GestureGuide />
              )}
              <Library
                entries={library}
                stats={stats}
                currentId={current?.id ?? null}
                selectedId={gestureSelectedId}
                onOpen={(e) => void openEntry(e)}
                onForget={(e) => void forgetEntry(e)}
              />
            </div>
          </section>
        )}
        <WebcamPanel
          targetRef={targetRef}
          videoId={current?.id}
          videoName={current?.name}
          onSectionPractice={(deltas) => void recordSectionPractice(deltas)}
          focus={focus}
          onFocusChange={setFocus}
          showSkeletons={showSkeletons}
          trackHead={trackHead}
          gamePhase={gamePhase}
          gameRun={gameRun}
          onLobbyChange={updateLobby}
          onGameScores={updateGameScores}
          onHit={showHit}
          onScoreDebug={import.meta.env.DEV ? updateScoreDebug : undefined}
          gestureContext={gestureContext}
          onGestureAction={handleGestureAction}
        />
      </main>

      <footer>
        <span className="legend-group">
          <span className="legend-title">{T('Reference')}</span>
          <span className="legend-item">
            <i style={{ background: SIDE_COLORS.left }} /> {T("dancer's left")}
          </span>
          <span className="legend-item">
            <i style={{ background: SIDE_COLORS.right }} /> {T("dancer's right")}
          </span>
          <span className="legend-item">
            <i style={{ background: SIDE_COLORS.center }} /> {T('torso')}
          </span>
        </span>
        <span className="legend-group">
          <span className="legend-title">{T('You')}</span>
          <span className="legend-item">
            <i style={{ background: LEVEL_COLORS.ok }} /> {T('matching')}
          </span>
          <span className="legend-item">
            <i style={{ background: LEVEL_COLORS.warn }} /> {T('a bit off')}
          </span>
          <span className="legend-item">
            <i style={{ background: LEVEL_COLORS.bad }} /> {T('way off')}
          </span>
          <span className="legend-item">
            <i style={{ background: LEVEL_COLORS.na }} /> {T('not compared')}
          </span>
        </span>
      </footer>
    </div>
  )
}

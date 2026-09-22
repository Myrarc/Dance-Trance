import { useCallback, useEffect, useRef, useState } from 'react'
import VideoPanel, { type TargetPose } from './components/VideoPanel'
import WebcamPanel from './components/WebcamPanel'
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
import { accuracy, type GamePhase, type PlayerRound } from './pose/gameplay'
import type { GestureContext, MenuGesture } from './pose/gestures'

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
  const [gestureSelectedId, setGestureSelectedId] = useState<string | null>(null)
  const targetRef = useRef<TargetPose>({
    feature: null,
    history: [],
    time: 0,
    facing: null,
    sectionId: null,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      if (!cancelled && decoded) setTrack(decoded)
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
      if (decoded) setTrack(decoded)
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
    if (decoded) setTrack(decoded)
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
    libraryVisible && library.length
      ? 'library'
      : src && gamePhase === 'results'
        ? 'results'
        : src && gamePhase === 'lobby' && lobby.ready
          ? 'lobby'
          : null

  const handleGestureAction = (gesture: MenuGesture) => {
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
    <div className="app">
      <LangGlobe />
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
      </header>

      {libraryOpen && library.length > 0 && (
        <section className="library-panel">
          <div className="library-title-row">
            <h2>Pick a track</h2>
            <span>Good songs · brighter moves</span>
          </div>
          <div className="gesture-guide">
            <strong>Gesture controls</strong>
            <span>One arm to browse · both hands up to select · cross arms to close</span>
          </div>
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
                <span>{!track ? 'Hit markers are required before playing' : lobby.ready ? 'Raise both hands to start · cross arms for songs' : 'Enter the camera zones and hold a T-pose'}</span>
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
                </span>
              ))}
            </div>
          )}
          {gamePhase === 'results' && (
            <div className="game-results">
              <h2>Dance complete</h2>
              <div className="result-players">
                {gamePlayers.map((player, index) => (
                  <article key={index}>
                    <h3>Player {index + 1}</h3>
                    <strong>{player.score.toLocaleString()}</strong>
                    <span>{accuracy(player)}% accuracy · {player.maxCombo}× max combo</span>
                    <small>{player.perfect} perfect · {player.good} good · {player.miss} miss</small>
                  </article>
                ))}
              </div>
              <div className="result-actions">
                <button className="btn primary" onClick={startRound}>Play again</button>
                <button className="btn" onClick={() => { setGamePhase('lobby'); setLibraryOpen(true) }}>Choose another song</button>
              </div>
              <p className="gesture-hint">Both hands up to replay · cross arms to choose a song</p>
            </div>
          )}
        </section>
      )}

      <main className="panels">
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
                <div className="gesture-guide">
                  <strong>Gesture controls</strong>
                  <span>One arm to browse · both hands up to select</span>
                </div>
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

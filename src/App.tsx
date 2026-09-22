import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { TargetPose } from './components/VideoPanel'
import type { ScoreDebug } from './components/WebcamPanel'
import AccountBar from './components/AccountBar'
import Library from './components/Library'
import UpdateToast from './components/UpdateToast'
import { Brand, HomeScreen, PauseOverlay, ResultsScreen, SettingsScreen, type ResultRecord } from './components/GameShell'
import { T, L, useLangTick, LangGlobe, getLang, setLang } from './i18n'
import { LEVEL_COLORS, SIDE_COLORS } from './pose/skeleton'
import type { Focus } from './pose/angles'
import type { AnalysisMetrics, PoseTrack } from './pose/track'
import {
  addSectionPractice, forget, getArcadeRecord, getTrack, getVideo, listArcadeRecords,
  listLibrary, mergeRemote, putArcadeRecord, putArcadeRecords, remember, saveSections,
  saveTrack, touch, type LibraryEntry, type Section,
} from './lib/library'
import {
  loadArcadeRecords, loadLibraryIndex, loadSessions, onAuthChange, statsByVideo,
  syncArcadeRecords, syncLibrary, type VideoStats,
} from './playkitClient'
import { loadGameSettings, saveGameSettings, type GameSettings } from './lib/gameSettings'
import { playSfx } from './lib/sfx'
import { accuracy, type GamePhase, type HitGrade, type PlayerRound } from './pose/gameplay'
import type { CueEvent, Difficulty } from './pose/hitTargets'
import type { GestureContext, MenuGesture } from './pose/gestures'
import { gameReducer, initialGameState, type AppScreen } from './game/state'
import { mergeCloudRecords, recordCompletedRound, recordsForCloud, type ArcadeRecord } from './game/records'

const VideoPanel = lazy(() => import('./components/VideoPanel'))
const WebcamPanel = lazy(() => import('./components/WebcamPanel'))

const ONBOARDING_KEY = 'dance-trance:onboarding-complete'
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']

function initialOnboarding() {
  try { return !localStorage.getItem(ONBOARDING_KEY) } catch { return true }
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
    <div className="gesture-guide" aria-label={T('Gesture controls')}>
      <strong className="gesture-guide-title">{T('Gesture controls')}</strong>
      <div className="gesture-steps">
        {steps.map(({ pose, label }) => <span className="gesture-step" key={pose}><GestureIcon pose={pose} /><b>{T(label)}</b></span>)}
      </div>
      {showBack && <small>{T('Cross arms for songs / close')}</small>}
    </div>
  )
}

function LoadingStage() {
  return <div className="loading-stage" role="status">{T('Loading the dance floor…')}</div>
}

export default function App() {
  const [navigation, dispatch] = useReducer(gameReducer, initialGameState)
  const activeScreen = navigation.screen === 'settings' ? navigation.returnScreen ?? 'home' : navigation.screen
  const [src, setSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [records, setRecords] = useState<ArcadeRecord[]>([])
  const [resultRecords, setResultRecords] = useState<ResultRecord[]>([])
  const [stats, setStats] = useState<Map<string, VideoStats>>(new Map())
  const [current, setCurrent] = useState<LibraryEntry | null>(null)
  const [focus, setFocus] = useState<Focus>('full')
  const [track, setTrack] = useState<PoseTrack | null>(null)
  const [analysing, setAnalysing] = useState<number | null>(null)
  const [analysisMetrics, setAnalysisMetrics] = useState<AnalysisMetrics | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<GameSettings>(() => ({ ...loadGameSettings(), language: getLang() }))
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [countdown, setCountdown] = useState(3)
  const [gameRun, setGameRun] = useState(0)
  const [lobby, setLobby] = useState({ ready: false, players: 0 })
  const [gamePlayers, setGamePlayers] = useState<PlayerRound[]>([])
  const [scoreDebug, setScoreDebug] = useState<ScoreDebug[]>([])
  const [hitFeedback, setHitFeedback] = useState<{ id: number; grade: Exclude<HitGrade, 'miss'>; target: CueEvent } | null>(null)
  const [gestureSelectedId, setGestureSelectedId] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(initialOnboarding)
  const targetRef = useRef<TargetPose>({ feature: null, history: [], time: 0, gameRun: 0, facing: null, sectionId: null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileDestinationRef = useRef<AppScreen>('arcade')
  const hitFeedbackIdRef = useRef(0)
  const comboMilestonesRef = useRef<number[]>([])

  const arcadePhase = navigation.arcadePhase
  const gamePhase: GamePhase = arcadePhase === 'setup' || arcadePhase === 'registration' ? 'lobby' : arcadePhase

  const completeOnboarding = (openArcade = false) => {
    try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* Continue without persistence. */ }
    setShowWelcome(false)
    if (openArcade) dispatch({ type: 'openArcade' })
  }

  const go = (type: 'openHome' | 'openArcade' | 'openPractice' | 'openLibrary' | 'openSettings') => {
    playSfx('menu', settings.soundMuted)
    dispatch({ type })
  }

  const updateSettings = (next: GameSettings) => {
    setSettings(next)
    saveGameSettings(next)
    setLang(next.language)
  }

  useEffect(() => {
    document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.classList.toggle('reduce-effects', settings.reducedEffects)
  }, [settings.language, settings.reducedEffects])

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const refresh = useCallback(async () => {
    const [entries, localRecords] = await Promise.all([listLibrary(), listArcadeRecords()])
    setLibrary(entries)
    setRecords(localRecords)
  }, [])

  const syncFromAccount = useCallback(async () => {
    const [localLibrary, localRecords] = await Promise.all([listLibrary(), listArcadeRecords()])
    if (localLibrary.length) {
      await syncLibrary(localLibrary.map((entry) => ({ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt })))
    }
    if (localRecords.length) await syncArcadeRecords(recordsForCloud(localRecords))
    const [sessions, remoteLibrary, remoteRecords] = await Promise.all([loadSessions(), loadLibraryIndex(), loadArcadeRecords()])
    setStats(statsByVideo(sessions))
    if (remoteLibrary.length) await mergeRemote(remoteLibrary)
    if (remoteRecords.length) await putArcadeRecords(mergeCloudRecords(localRecords, remoteRecords))
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    void syncFromAccount()
    return onAuthChange(() => void syncFromAccount())
  }, [refresh, syncFromAccount])

  const currentId = current?.id ?? null
  useEffect(() => {
    let cancelled = false
    setTrack(null)
    setAnalysisMetrics(null)
    setAnalysisMessage(null)
    if (!currentId) return
    void getTrack(currentId).then(async (stored) => {
      const { unpackTrack } = await import('./pose/track')
      const decoded = stored ? unpackTrack(stored) : null
      if (!cancelled && decoded?.rhythmAnalysed) setTrack(decoded)
    })
    return () => { cancelled = true }
  }, [currentId])

  useEffect(() => {
    setLobby({ ready: false, players: 0 })
    setGamePlayers([])
    setResultRecords([])
    comboMilestonesRef.current = []
  }, [currentId])

  useEffect(() => {
    if (gamePhase !== 'playing') {
      setHitFeedback(null)
      setScoreDebug([])
    }
  }, [gamePhase])

  useEffect(() => {
    if (!library.length) return setGestureSelectedId(null)
    setGestureSelectedId((selected) => selected && library.some((entry) => entry.id === selected) ? selected : currentId ?? library[0].id)
  }, [currentId, library])

  useEffect(() => {
    if (arcadePhase !== 'countdown') return
    setCountdown(3)
    playSfx('countdown', settings.soundMuted)
    const started = performance.now()
    let lastRemaining = 3
    const timer = window.setInterval(() => {
      const remaining = 3 - Math.floor((performance.now() - started) / 1000)
      if (remaining <= 0) {
        clearInterval(timer)
        playSfx('go', settings.soundMuted)
        dispatch({ type: 'countdownFinished' })
      } else {
        if (remaining !== lastRemaining) playSfx('countdown', settings.soundMuted)
        lastRemaining = remaining
        setCountdown(remaining)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [arcadePhase, gameRun, settings.soundMuted])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeScreen !== 'arcade' || navigation.screen === 'settings') return
      if (arcadePhase === 'playing') dispatch({ type: 'pause' })
      else if (arcadePhase === 'paused') dispatch({ type: 'resume' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeScreen, arcadePhase, navigation.screen])

  const startRound = () => {
    if (!track || !lobby.ready) return
    setGamePlayers([])
    setResultRecords([])
    comboMilestonesRef.current = []
    setGameRun((run) => run + 1)
    dispatch({ type: 'startCountdown' })
  }

  const finishRound = async () => {
    if (arcadePhase !== 'playing') return
    dispatch({ type: 'finishRound' })
    if (!current || !gamePlayers.length) return
    const completedAt = Date.now()
    const outcomes: ResultRecord[] = []
    for (let index = 0; index < gamePlayers.length; index++) {
      const player = gamePlayers[index]
      const playerSlot = (index + 1) as 1 | 2
      const existing = await getArcadeRecord(`${current.id}:${difficulty}:${playerSlot}`)
      const outcome = recordCompletedRound(existing, {
        videoId: current.id, difficulty, playerSlot, score: player.score,
        accuracy: accuracy(player), maxCombo: player.maxCombo, completedAt,
      })
      await putArcadeRecord(outcome.record)
      outcomes.push(outcome)
    }
    setResultRecords(outcomes)
    const fresh = await listArcadeRecords()
    setRecords(fresh)
    playSfx(outcomes.some((outcome) => outcome.isNewBest) ? 'record' : 'result', settings.soundMuted)
    void syncArcadeRecords(recordsForCloud(fresh))
  }

  const updateLobby = useCallback((ready: boolean, players: number) => {
    setLobby((value) => value.ready === ready && value.players === players ? value : { ready, players })
  }, [])
  const updateGameScores = useCallback((players: PlayerRound[]) => {
    players.forEach((player, index) => {
      const previous = comboMilestonesRef.current[index] ?? 0
      if (player.combo >= 5 && player.combo % 5 === 0 && player.combo !== previous) {
        playSfx('combo', settings.soundMuted)
      }
      comboMilestonesRef.current[index] = player.combo
    })
    setGamePlayers(players)
  }, [settings.soundMuted])
  const updateScoreDebug = useCallback((entries: ScoreDebug[]) => {
    setScoreDebug((currentScores) => {
      const next = [...currentScores]
      for (const entry of entries) next[entry.player - 1] = entry
      return next
    })
  }, [])
  const showHit = useCallback((grade: Exclude<HitGrade, 'miss'>, target: CueEvent) => {
    setHitFeedback({ id: ++hitFeedbackIdRef.current, grade, target })
    playSfx(grade, settings.soundMuted)
  }, [settings.soundMuted])

  const analyseBlob = async (entry: LibraryEntry, blob: Blob) => {
    if (analysing != null) return
    setAnalysing(0)
    setAnalysisMetrics(null)
    setAnalysisMessage(null)
    try {
      const { analyseVideo, packTrack } = await import('./pose/track')
      const result = await analyseVideo(blob, setAnalysing, () => false, setAnalysisMetrics,
        (reason) => setAnalysisMessage(`${T('Fast analysis unavailable')} (${reason}); ${T('using compatibility mode')}`))
      if (result) {
        await saveTrack(entry.id, packTrack(result))
        setTrack(result)
        setAnalysisMessage(null)
        await refresh()
      }
    } catch (error) {
      setAnalysisMessage(`${T('Analysis failed')}: ${error instanceof Error ? error.message : String(error)}`)
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

  const loadFile = async (file: File | undefined | null, destination: AppScreen = 'arcade') => {
    if (!file) return
    if (!file.type.startsWith('video/')) return alert(T('Please choose a video file'))
    play(file)
    const entry = await remember(file)
    setCurrent(entry)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    if (entry) {
      void syncLibrary([{ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt }])
      const stored = await getTrack(entry.id)
      const { unpackTrack } = await import('./pose/track')
      const decoded = stored ? unpackTrack(stored) : null
      if (decoded?.rhythmAnalysed) setTrack(decoded)
      else await analyseBlob(entry, file)
    }
  }

  const openEntry = async (entry: LibraryEntry, destination: 'arcade' | 'practice' = 'arcade') => {
    const blob = await getVideo(entry.id)
    if (!blob) {
      fileDestinationRef.current = destination
      fileInputRef.current?.click()
      return
    }
    play(blob)
    setCurrent(entry)
    await touch(entry.id)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    const stored = await getTrack(entry.id)
    const { unpackTrack } = await import('./pose/track')
    const decoded = stored ? unpackTrack(stored) : null
    if (decoded?.rhythmAnalysed) setTrack(decoded)
    else await analyseBlob(entry, blob)
  }

  const updateSections = async (sections: Section[]) => {
    if (!current) return
    const ordered = [...sections].sort((a, b) => a.start - b.start)
    setCurrent({ ...current, sections: ordered })
    setLibrary((all) => all.map((entry) => entry.id === current.id ? { ...entry, sections: ordered } : entry))
    await saveSections(current.id, ordered)
  }

  const recordSectionPractice = async (deltas: Parameters<typeof addSectionPractice>[1]) => {
    if (!current) return
    await addSectionPractice(current.id, deltas)
    const fresh = await listLibrary()
    setLibrary(fresh)
    setCurrent(fresh.find((entry) => entry.id === current.id) ?? current)
  }

  const forgetEntry = async (entry: LibraryEntry) => {
    await forget(entry.id)
    if (current?.id === entry.id) {
      setCurrent(null)
      setSrc(null)
    }
    await refresh()
  }

  const openFilePicker = (destination: AppScreen) => {
    fileDestinationRef.current = destination
    fileInputRef.current?.click()
  }

  const gestureContext: GestureContext | null = activeScreen === 'library' && library.length
    ? 'library'
    : activeScreen === 'arcade' && arcadePhase === 'results'
      ? 'results'
      : activeScreen === 'arcade' && arcadePhase === 'registration' && lobby.ready ? 'lobby' : null

  const handleGestureAction = (gesture: MenuGesture) => {
    if (gestureContext === 'library') {
      if (gesture === 'back') dispatch({ type: 'openHome' })
      if (gesture === 'confirm') {
        const selected = library.find((entry) => entry.id === gestureSelectedId)
        if (selected) void openEntry(selected)
      }
      if (gesture === 'previous' || gesture === 'next') {
        const index = Math.max(0, library.findIndex((entry) => entry.id === gestureSelectedId))
        const step = gesture === 'previous' ? -1 : 1
        setGestureSelectedId(library[(index + step + library.length) % library.length].id)
      }
      return
    }
    if (gestureContext === 'lobby') {
      if (gesture === 'previous' || gesture === 'next') {
        const index = DIFFICULTIES.indexOf(difficulty)
        const step = gesture === 'previous' ? -1 : 1
        setDifficulty(DIFFICULTIES[(index + step + DIFFICULTIES.length) % DIFFICULTIES.length])
      }
      if (gesture === 'confirm') startRound()
      if (gesture === 'back') dispatch({ type: 'openLibrary' })
      return
    }
    if (gestureContext === 'results') {
      if (gesture === 'confirm') startRound()
      if (gesture === 'back') dispatch({ type: 'openLibrary' })
    }
  }

  const renderHeader = (title: string) => (
    <header className="app-header">
      <button className="brand-button" onClick={() => go('openHome')} aria-label={T('Home')}><Brand compact /></button>
      <span className="screen-label">{T(title)}</span>
      <nav><button className="btn subtle" onClick={() => go('openLibrary')}>{L(`Library (${library.length})`, `舞蹈库（${library.length}）`)}</button><button className="btn subtle" onClick={() => go('openSettings')}>{T('Settings')}</button><AccountBar /></nav>
    </header>
  )

  const renderTrackPicker = (destination: 'arcade' | 'practice') => (
    <section className={`track-picker ${dragOver ? 'over' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); void loadFile(event.dataTransfer.files?.[0], destination) }}>
      <div className="track-picker-copy">
        <span className="kicker">{T(destination === 'arcade' ? 'Step 1 · Pick your song' : 'Practice your way')}</span>
        <h1>{T(destination === 'arcade' ? 'Choose the routine.' : 'Build the routine.')}</h1>
        <p>{T('Drop a dance video here or choose one from your device. Analysis stays local.')}</p>
        <button className="btn primary" onClick={() => openFilePicker(destination)}>{T('Choose video')}</button>
      </div>
      <div className="picker-library"><h2>{T('Ready to play')}</h2><Library entries={library} stats={stats} records={records} currentId={currentId} selectedId={gestureSelectedId} onOpen={(entry) => void openEntry(entry, destination)} onForget={(entry) => void forgetEntry(entry)} emptyHint={T('Your prepared songs will appear here.')} /></div>
    </section>
  )

  const renderPanels = (mode: 'arcade' | 'practice') => {
    if (!src) return renderTrackPicker(mode)
    const panelPhase: GamePhase = mode === 'practice' ? 'lobby' : gamePhase
    return (
      <Suspense fallback={<LoadingStage />}>
        <main className={`panels ${mode === 'arcade' && ['countdown', 'playing', 'paused'].includes(gamePhase) ? 'game-active' : mode === 'arcade' && gamePhase === 'results' ? 'game-results-stage' : ''}`}>
          <VideoPanel src={src} targetRef={targetRef} sections={current?.sections ?? []} sectionStats={current?.sectionStats} onSectionsChange={(sections) => void updateSections(sections)} focus={focus} track={track} onAnalyse={() => void analyse()} analysing={analysing} analysisMetrics={analysisMetrics} analysisMessage={analysisMessage} showSkeletons={settings.showSkeletons} trackHead={settings.trackHead} difficulty={difficulty} gamePhase={panelPhase} countdown={countdown} gameRun={gameRun} onGameEnd={() => void finishRound()} hitFeedback={hitFeedback} />
          <WebcamPanel targetRef={targetRef} videoId={current?.id} videoName={current?.name} onSectionPractice={(deltas) => void recordSectionPractice(deltas)} focus={focus} onFocusChange={setFocus} showSkeletons={settings.showSkeletons} trackHead={settings.trackHead} gamePhase={panelPhase} gameRun={gameRun} onLobbyChange={updateLobby} onGameScores={updateGameScores} onHit={showHit} onScoreDebug={import.meta.env.DEV ? updateScoreDebug : undefined} gestureContext={mode === 'arcade' ? gestureContext : null} onGestureAction={handleGestureAction} />
        </main>
      </Suspense>
    )
  }

  const renderArcade = () => {
    if (arcadePhase === 'setup') {
      return <div className="destination-wrap">{renderHeader('Arcade')}{!src ? renderTrackPicker('arcade') : (
        <main className="arcade-setup-screen"><section className="setup-poster"><span className="kicker">{T('Step 1 · Song ready')}</span><h1>{current?.name ?? T('Your dance')}</h1><p>{analysing == null ? track ? T('Movement chart ready. Next, register the players.') : T('Preparing movement cues…') : `${T('Analysing')} ${Math.round(analysing * 100)}%`}</p>{analysisMessage && <p className="error">{analysisMessage}</p>}<div className="setup-actions"><button className="btn primary" disabled={!track} onClick={() => dispatch({ type: 'beginRegistration' })}>{T('Set up players')}</button><button className="btn" onClick={() => openFilePicker('arcade')}>{T('Change song')}</button></div></section><section className="setup-privacy"><strong>{T('Private by design')}</strong><span>{T('Video, camera frames, and pose landmarks stay on this device.')}</span></section></main>
      )}</div>
    }
    return (
      <div className={`destination-wrap ${['countdown', 'playing', 'paused'].includes(arcadePhase) ? 'game-screen-active' : ''}`}>
        {renderHeader('Arcade')}
        {arcadePhase === 'registration' && <section className="game-flow game-lobby" aria-live="polite"><div><strong>{lobby.ready ? L(`${lobby.players} player${lobby.players === 1 ? '' : 's'} ready`, `${lobby.players} 位玩家已准备`) : T('Player check')}</strong><span>{lobby.ready ? T('Choose a difficulty, then start.') : T('Enter the camera zones and hold a T-pose.')}</span></div><div className="difficulty-picker" role="group" aria-label={T('Difficulty')}>{DIFFICULTIES.map((level) => <button key={level} className={`difficulty-option${difficulty === level ? ' active' : ''}`} aria-pressed={difficulty === level} onClick={() => setDifficulty(level)}>{T(level)}</button>)}</div><button className="btn primary" onClick={startRound} disabled={!track || !lobby.ready}>{T('Start game')}</button></section>}
        {arcadePhase === 'playing' && <section className="game-flow game-playing" aria-live="polite"><div className="game-score-strip">{(gamePlayers.length ? gamePlayers : Array.from({ length: Math.max(1, lobby.players) }, () => null)).map((player, index) => <span key={index}><b>P{index + 1}</b> {player?.score.toLocaleString() ?? '0'}<small>{player?.combo ? `${player.combo}× ${T('combo')}` : T('build your combo')}</small>{import.meta.env.DEV && scoreDebug[index] && <small className="score-debug">{scoreDebug[index].cue} · {scoreDebug[index].grade} · {Math.round(scoreDebug[index].lag * 1000)}ms</small>}</span>)}</div><button className="pause-button" onClick={() => dispatch({ type: 'pause' })} aria-label={T('Pause')}>Ⅱ</button></section>}
        {arcadePhase === 'results' && <section className="game-flow game-results" aria-live="polite"><ResultsScreen players={gamePlayers} difficulty={difficulty} records={resultRecords} reducedEffects={settings.reducedEffects} onReplay={startRound} onChooseSong={() => dispatch({ type: 'openLibrary' })} onHome={() => dispatch({ type: 'quitHome' })} /></section>}
        {renderPanels('arcade')}
        {arcadePhase === 'paused' && navigation.screen !== 'settings' && <PauseOverlay onResume={() => dispatch({ type: 'resume' })} onRestart={() => { setGameRun((run) => run + 1); dispatch({ type: 'restart' }) }} onSettings={() => dispatch({ type: 'openSettings' })} onQuit={() => dispatch({ type: 'quitHome' })} />}
      </div>
    )
  }

  const renderPractice = () => <div className="destination-wrap">{renderHeader('Practice Studio')}{renderPanels('practice')}{src && <footer className="practice-legend"><span className="legend-group"><span className="legend-title">{T('Reference')}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.left }} /> {T("dancer's left")}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.right }} /> {T("dancer's right")}</span></span><span className="legend-group"><span className="legend-title">{T('You')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.ok }} /> {T('matching')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.warn }} /> {T('a bit off')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.bad }} /> {T('way off')}</span></span></footer>}</div>

  const renderLibrary = () => <div className="destination-wrap">{renderHeader('Library')}<main className="destination-screen library-screen"><div className="screen-title-row"><div><span className="kicker">{T('Your local collection')}</span><h1>{T('Library')}</h1></div><button className="btn primary" onClick={() => openFilePicker('arcade')}>{T('Add a dance')}</button></div>{library.length > 0 && <GestureGuide showBack />}<Library entries={library} stats={stats} records={records} currentId={currentId} selectedId={gestureSelectedId} onOpen={(entry) => void openEntry(entry)} onForget={(entry) => void forgetEntry(entry)} emptyHint={T('No songs yet. Add a dance video to build your library.')} /><p className="privacy-note">{T('Videos stay on this device. Signed-in accounts sync names, practice totals, and Player 1 records—not footage or landmarks.')}</p></main></div>

  useLangTick()
  return (
    <div className="app-shell">
      <LangGlobe />
      <UpdateToast />
      <input ref={fileInputRef} hidden type="file" accept="video/*" onChange={(event) => { void loadFile(event.target.files?.[0], fileDestinationRef.current); event.target.value = '' }} />
      {activeScreen === 'home' && <HomeScreen libraryCount={library.length} onArcade={() => go('openArcade')} onPractice={() => go('openPractice')} onLibrary={() => go('openLibrary')} onSettings={() => go('openSettings')} account={<AccountBar />} />}
      {activeScreen === 'arcade' && renderArcade()}
      {activeScreen === 'practice' && renderPractice()}
      {activeScreen === 'library' && renderLibrary()}
      {navigation.screen === 'settings' && <SettingsScreen settings={settings} onChange={updateSettings} onClose={() => dispatch({ type: 'closeSettings' })} />}
      {showWelcome && <section className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title"><div className="welcome-card"><span className="welcome-step">{T('Ready when you are')}</span><h2 id="welcome-title">{T('Your video.')}<br />{T('Your moves.')}<br />{T('Your arcade.')}</h2><p>{T('Turn any dance video into a local one or two-player rhythm game. Camera and video processing stay on this device.')}</p><div className="welcome-actions"><button className="btn primary" autoFocus onClick={() => completeOnboarding(true)}>{T('Let’s dance')}</button><button className="btn subtle" onClick={() => completeOnboarding()}>{T('Explore first')}</button></div></div></section>}
    </div>
  )
}

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { T, L } from '../i18n'
import { accuracy, type PlayerRound } from '../pose/gameplay'
import type { Difficulty } from '../pose/hitTargets'
import { gradeFromAccuracy, type ArcadeRecord, type Grade } from '../game/records'
import type { GameSettings } from '../lib/gameSettings'

function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = ref.current
    const focusableElements = () => modal
      ? [...modal.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('disabled'))
      : []
    const focusFrame = requestAnimationFrame(() => focusableElements()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modal) return
      const focusable = focusableElements()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!modal.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref])
}

function ModeCard({ eyebrow, title, body, action, tone = '' }: {
  eyebrow: string
  title: string
  body: string
  action: () => void
  tone?: string
}) {
  return (
    <button className={`mode-card ${tone}`} data-gesture-label={T(title)} onClick={action}>
      <span>{T(eyebrow)}</span>
      <strong>{T(title)}</strong>
      <small>{T(body)}</small>
      <i aria-hidden="true">↗</i>
    </button>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? ' compact' : ''}`} aria-label="Dance Trance">
      <span className="brand-dance">Dance</span>
      <span className="brand-trance">Trance</span>
    </div>
  )
}

export function HomeScreen({ libraryCount, trackingReady, onArcade, onPractice, onLibrary, onSettings, onTracking, account }: {
  libraryCount: number
  trackingReady: boolean
  onArcade: () => void
  onPractice: () => void
  onLibrary: () => void
  onSettings: () => void
  onTracking: () => void
  account: ReactNode
}) {
  const playRef = useRef<HTMLButtonElement>(null)
  useEffect(() => playRef.current?.focus(), [])

  return (
    <main className="home-screen" data-gesture-surface>
      <div className="home-topline">
        <Brand />
        <div className="home-account" data-gesture-skip>{account}</div>
      </div>
      <section className="home-hero">
        <div className="home-copy">
          <span className="kicker">{T(trackingReady ? 'Gesture controls ready' : 'Camera setup needed for gestures')}</span>
          <h1>{T('Choose your game.')}</h1>
          <p>{T(trackingReady ? 'Move through the menu with your arms, then raise your right hand to choose.' : 'Use the buttons or open Camera setup to enable gesture controls.')}</p>
          <button ref={playRef} className="btn primary home-play" data-gesture-default onClick={onArcade}>
            <span>{T('Play Arcade')}</span><b aria-hidden="true">▶</b>
          </button>
        </div>
      </section>
      <nav className="mode-grid" aria-label={T('Game modes')}>
        <ModeCard eyebrow="Learn the routine" title="Practice Studio" body="Loop, slow down, and focus on the parts that need work." action={onPractice} tone="cyan" />
        <ModeCard eyebrow={`${libraryCount} saved tracks`} title="Library" body="Pick up a prepared song or bring in a new dance video." action={onLibrary} tone="yellow" />
        <ModeCard eyebrow="Make it yours" title="Settings" body="Adjust tracking overlays, sound, language, and motion." action={onSettings} tone="cream" />
        <ModeCard eyebrow="Get back in frame" title="Camera setup" body="Reconnect tracking and register players again." action={onTracking} tone="cyan" />
      </nav>
    </main>
  )
}

export function WelcomeOverlay({ onStart, onExplore }: {
  onStart: () => void
  onExplore: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)

  return (
    <section ref={modalRef} className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <span className="welcome-step">{T('Ready when you are')}</span>
        <h2 id="welcome-title">{T('Your video.')}<br />{T('Your moves.')}<br />{T('Your arcade.')}</h2>
        <p>{L('Turn a dance video into a one or two-player rhythm game.', '把舞蹈视频变成单人或双人节奏游戏。')}</p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={onStart}>{T('Let’s dance')}</button>
          <button className="btn subtle" onClick={onExplore}>{T('Explore first')}</button>
        </div>
      </div>
    </section>
  )
}

function Toggle({ label, detail, checked, onChange }: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="setting-row">
      <span><strong>{T(label)}</strong><small>{T(detail)}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export function SettingsScreen({ settings, onChange, onClose }: {
  settings: GameSettings
  onChange: (next: GameSettings) => void
  onClose: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <main ref={modalRef} className="destination-screen settings-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-gesture-surface onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div className="screen-title-row">
        <div><span className="kicker">{T('Player preferences')}</span><h1 id="settings-title">{T('Settings')}</h1></div>
        <button className="btn" onClick={onClose}>{T('Back')}</button>
      </div>
      <section className="settings-grid">
        <div className="settings-card">
          <h2>{T('Gameplay')}</h2>
          <Toggle label="Show skeleton overlays" detail="Display pose guides on both the reference and camera." checked={settings.showSkeletons} onChange={(value) => update('showSkeletons', value)} />
          <Toggle label="Track head movements" detail="Include head cues and head position in scoring." checked={settings.trackHead} onChange={(value) => update('trackHead', value)} />
        </div>
        <div className="settings-card">
          <h2>{T('Comfort')}</h2>
          <Toggle label="Sound effects" detail="Countdown, judgments, combos, and results feedback." checked={!settings.soundMuted} onChange={(value) => update('soundMuted', !value)} />
          <Toggle label="Full motion effects" detail="Turn off for calmer transitions and celebrations." checked={!settings.reducedEffects} onChange={(value) => update('reducedEffects', !value)} />
        </div>
        <fieldset className="settings-card language-card">
          <legend>{T('Language')}</legend>
          <label><input type="radio" name="language" checked={settings.language === 'en'} onChange={() => update('language', 'en')} /> English</label>
          <label><input type="radio" name="language" checked={settings.language === 'zh'} onChange={() => update('language', 'zh')} /> 中文</label>
        </fieldset>
      </section>
    </main>
  )
}

export function PauseOverlay({ onResume, onRestart, onSettings, onQuit }: {
  onResume: () => void
  onRestart: () => void
  onSettings: () => void
  onQuit: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)
  return (
    <section ref={modalRef} className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-gesture-surface>
      <div className="pause-card">
        <span className="kicker">{T('Take a breath')}</span>
        <h2 id="pause-title">{T('Paused')}</h2>
        <button className="btn primary" onClick={onResume}>{T('Resume')}</button>
        <button className="btn" onClick={onRestart}>{T('Restart song')}</button>
        <button className="btn" onClick={onSettings}>{T('Settings')}</button>
        <button className="btn subtle" onClick={onQuit}>{T('Quit to Home')}</button>
        <small>{T('Press Escape to resume')}</small>
      </div>
    </section>
  )
}

function AnimatedScore({ value, reduced }: { value: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 850)
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced, value])
  return <>{shown.toLocaleString()}</>
}

export interface ResultRecord {
  record: ArcadeRecord
  isNewBest: boolean
}

export function ResultsScreen({ players, difficulty, records, reducedEffects, onReplay, onChooseSong, onHome }: {
  players: PlayerRound[]
  difficulty: Difficulty
  records: ResultRecord[]
  reducedEffects: boolean
  onReplay: () => void
  onChooseSong: () => void
  onHome: () => void
}) {
  return (
    <section className="results-card" aria-labelledby="results-title">
      <span className="results-eyebrow">{T('Routine complete')} · {T(difficulty)}</span>
      <h2 id="results-title">{T('Final score')}</h2>
      <div className={`result-players${players.length > 1 ? ' is-multiplayer' : ''}`}>
        {players.map((player, index) => {
          const resultAccuracy = accuracy(player)
          const grade: Grade = gradeFromAccuracy(resultAccuracy)
          return (
            <article key={index}>
              {records[index]?.isNewBest && <span className="new-record">{T('New record')}</span>}
              <div className={`grade-stamp grade-${grade.toLowerCase()}`} aria-label={`${T('Grade')} ${grade}`}>{grade}</div>
              <h3>{T('Player')} {index + 1}</h3>
              <strong className="result-score"><AnimatedScore value={player.score} reduced={reducedEffects} /></strong>
              <div className="result-breakdown">
                <span><b>{resultAccuracy}%</b> {T('accuracy')} · <b>{player.maxCombo}×</b> {T('max combo')}</span>
                <small><b>P</b> {player.perfect} {T('Perfect')} · <b>G</b> {player.good} {T('Good')} · <b>M</b> {player.miss} {T('Miss')}</small>
                {records[index] && <small>{T('Personal best')}: {records[index].record.bestScore.toLocaleString()}</small>}
              </div>
            </article>
          )
        })}
      </div>
      <div className="result-actions">
        <button className="btn primary" onClick={onReplay} autoFocus>{T('Play again')}</button>
        <button className="btn" onClick={onChooseSong}>{T('Choose another song')}</button>
        <button className="btn subtle" onClick={onHome}>{T('Home')}</button>
      </div>
      <p className="gesture-hint">{T('Right hand up to replay · left hand up to choose a song')}</p>
    </section>
  )
}

export interface GameSettings {
  soundMuted: boolean
  reducedEffects: boolean
  language: 'en' | 'zh'
  showSkeletons: boolean
  trackHead: boolean
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const SETTINGS_KEY = 'dance-trance:game-settings'

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  soundMuted: false,
  reducedEffects: false,
  language: 'en',
  showSkeletons: true,
  trackHead: true,
}

function browserStorage(): SettingsStorage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
export function loadGameSettings(storage: SettingsStorage | null = browserStorage()): GameSettings {
  if (!storage) return DEFAULT_GAME_SETTINGS
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>
    return {
      soundMuted: typeof saved.soundMuted === 'boolean' ? saved.soundMuted : false,
      reducedEffects: typeof saved.reducedEffects === 'boolean' ? saved.reducedEffects : false,
      language: saved.language === 'zh' ? 'zh' : 'en',
      showSkeletons: typeof saved.showSkeletons === 'boolean' ? saved.showSkeletons : true,
      trackHead: typeof saved.trackHead === 'boolean' ? saved.trackHead : true,
    }
  } catch {
    return DEFAULT_GAME_SETTINGS
  }
}

export function saveGameSettings(
  settings: GameSettings,
  storage: SettingsStorage | null = browserStorage(),
) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Settings are optional; keep the active session working in private mode.
  }
}

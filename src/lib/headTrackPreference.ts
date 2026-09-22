type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

const KEY = 'dt_track_head'

function browserSessionStorage(): SessionStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function loadTrackHead(storage: SessionStorage | null = browserSessionStorage()): boolean {
  try {
    return storage?.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

export function saveTrackHead(
  trackHead: boolean,
  storage: SessionStorage | null = browserSessionStorage(),
) {
  try {
    storage?.setItem(KEY, String(trackHead))
  } catch {
    // Storage can be unavailable in private mode; the in-memory state still works.
  }
}

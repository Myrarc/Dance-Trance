type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

const KEY = 'dt_skeletons_visible'

function browserSessionStorage(): SessionStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function loadSkeletonsVisible(storage: SessionStorage | null = browserSessionStorage()) {
  try {
    return storage?.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

export function saveSkeletonsVisible(
  visible: boolean,
  storage: SessionStorage | null = browserSessionStorage(),
) {
  try {
    storage?.setItem(KEY, String(visible))
  } catch {
    // Storage can be unavailable in private mode; the in-memory toggle still works.
  }
}

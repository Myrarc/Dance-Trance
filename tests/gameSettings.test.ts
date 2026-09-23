import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_GAME_SETTINGS, loadGameSettings, saveGameSettings } from '../src/lib/gameSettings.ts'

function storage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

test('settings fall back safely when storage is empty or malformed', () => {
  assert.deepEqual(loadGameSettings(storage()), DEFAULT_GAME_SETTINGS)
  assert.deepEqual(loadGameSettings(storage('{bad json')), DEFAULT_GAME_SETTINGS)
})

test('settings preserve valid choices and repair invalid fields', () => {
  const store = storage(JSON.stringify({
    soundMuted: true,
    menuTheme: 'coin',
    reducedEffects: true,
    language: 'zh',
    showSkeletons: false,
    trackHead: 'not-a-boolean',
  }))
  assert.deepEqual(loadGameSettings(store), {
    soundMuted: true,
    menuTheme: 'coin',
    reducedEffects: true,
    language: 'zh',
    showSkeletons: false,
    showCameraSkeletons: false,
    trackHead: true,
  })
})

test('camera and reference skeleton preferences stay independent', () => {
  const saved = loadGameSettings(storage(JSON.stringify({
    showSkeletons: false,
    showCameraSkeletons: true,
  })))
  assert.equal(saved.showSkeletons, false)
  assert.equal(saved.showCameraSkeletons, true)
})

test('settings save as one durable value', () => {
  const store = storage()
  saveGameSettings({ ...DEFAULT_GAME_SETTINGS, soundMuted: true }, store)
  assert.equal(JSON.parse(store.value()!).soundMuted, true)
})

test('an unknown menu theme falls back to the default', () => {
  assert.equal(loadGameSettings(storage(JSON.stringify({ menuTheme: 'missing' }))).menuTheme, 'theme1')
})

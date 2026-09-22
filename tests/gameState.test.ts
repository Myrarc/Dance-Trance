import assert from 'node:assert/strict'
import test from 'node:test'
import { gameReducer, initialGameState } from '../src/game/state.ts'

test('the app always starts at the home hub', () => {
  assert.deepEqual(initialGameState, { screen: 'home', arcadePhase: 'setup', returnScreen: null })
})

test('arcade navigation follows setup through results and replay', () => {
  let state = gameReducer(initialGameState, { type: 'openArcade' })
  state = gameReducer(state, { type: 'beginRegistration' })
  state = gameReducer(state, { type: 'startCountdown' })
  state = gameReducer(state, { type: 'countdownFinished' })
  state = gameReducer(state, { type: 'finishRound' })

  assert.equal(state.screen, 'arcade')
  assert.equal(state.arcadePhase, 'results')

  state = gameReducer(state, { type: 'replay' })
  assert.equal(state.arcadePhase, 'countdown')
})

test('settings opened from pause returns to the paused round', () => {
  let state = { ...initialGameState, screen: 'arcade' as const, arcadePhase: 'playing' as const }
  state = gameReducer(state, { type: 'pause' })
  state = gameReducer(state, { type: 'openSettings' })
  assert.equal(state.screen, 'settings')

  state = gameReducer(state, { type: 'closeSettings' })
  assert.equal(state.screen, 'arcade')
  assert.equal(state.arcadePhase, 'paused')

  state = gameReducer(state, { type: 'resume' })
  assert.equal(state.arcadePhase, 'playing')
})

test('restart does not visit results and quitting resets the arcade flow', () => {
  const playing = { ...initialGameState, screen: 'arcade' as const, arcadePhase: 'playing' as const }
  assert.equal(gameReducer(playing, { type: 'restart' }).arcadePhase, 'countdown')
  assert.deepEqual(gameReducer(playing, { type: 'quitHome' }), initialGameState)
})

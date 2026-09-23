# Repository Guidelines

## What This Project Is

Dance Trance is a Danzbase-style dance game forked from [Chuyuyan/dance-trainer](https://github.com/Chuyuyan/dance-trainer). The original side-by-side dance practice tool remains as Practice Studio, but the main product is now an Arcade game: a player loads a song video, the app analyses its audio and reference dancer to generate timed moves, and one or two players follow along on camera for scores, combos, and results. Players can register and navigate menus with body gestures; pointer, touch, and keyboard controls remain available.

Treat Arcade, Practice Studio, the local video library, and optional account sync as existing features. Keep the game playable at dance-floor distance and preserve the privacy boundary: camera frames, imported videos, and pose landmarks stay on the player's device. Optional sync may send aggregate records, never media.

## Project Structure & Module Organization

The app uses React 19, TypeScript, and Vite. `src/App.tsx` coordinates screens and rounds; `src/game/` holds game state and records; `src/pose/` holds reference-video and rhythm analysis, cue generation, camera tracking, gestures, and scoring; `src/components/` holds UI; and `src/lib/` holds storage and service integrations. Keep detailed game logic in the focused modules. Static files belong in `public/`, documentation images in `docs/`, and provisioning utilities in `scripts/`.

The Arcade opens on an Insert Coin attract screen. A button/key/tap wakes a camera-first tracking screen; after Player 1 registers, the menu is navigable with held arm poses. Song selection and local analysis lead to the camera check, countdown, timed cue scoring, and results or replay. The camera stays mounted across these screens so returning to a menu does not discard the player lock. Practice Studio retains detailed coaching controls. Changes to shared pose code must account for both modes.

The four menu poses are previous, next, select, and back. The selected control must read clearly from across the room. Previous and next repeat at a controlled rate while the pose stays held; select and back require a release before firing again. During a round, ordinary menu gestures are disabled; a sustained crossed-arm pose pauses. The song picker is a circular carousel: its selected song stays centered and plays a short loop inside the card. In the picker, a held left-arm pose advances to the next song and a right-arm pose moves to the previous one. New video files still require the device's file picker. Keep pointer and keyboard access alongside gestures.

## Build, Test, and Development Commands

- `npm install` installs dependencies and downloads roughly 38 MB of MediaPipe assets.
- `npm run dev` starts the Vite development server.
- `npm run build` runs TypeScript project checks and creates the production bundle in `dist/`.
- `npm run lint` checks React and TypeScript code with Oxlint.
- `npm test` runs the existing Node test suite in `tests/`.
- `npm run preview` serves the production bundle locally.
- `npm run setup` refreshes generated assets under `public/models/` and `public/wasm/`; do not commit those directories.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for shared constants. Component files use `PascalCase.tsx`; utility modules use descriptive lowercase names such as `angles.ts`.

## Testing Guidelines

Every code change must pass `npm test`, `npm run lint`, and `npm run build`. Add focused tests under `tests/` for deterministic pose, rhythm, cue generation, gestures, scoring, persistence, and game-state changes. Manually verify affected browser flows, especially camera permission, local video loading and analysis, one and two-player registration, gesture navigation, and offline behavior when relevant. Report browser checks separately from automated tests.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, optionally scoped, for example `UI: put the dance first` or `fix(library): push the local library on sign-in`. Keep each commit focused. Pull requests should explain the player-facing result, list verification performed, link related issues, and include screenshots or recordings for UI or animation changes. Call out new downloads, permissions, storage, account synchronization, or privacy implications explicitly.

## Configuration & Generated Files

Store local account configuration in `.env.local` using `VITE_PLAYKIT_URL`; never commit local environment files. Treat `dist/`, `public/models/`, and `public/wasm/` as generated output.

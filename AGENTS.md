# Repository Guidelines

## Project Structure & Module Organization

Dance Trance is a React 19 and TypeScript dance trainer built with Vite. Application code lives in `src/`: UI belongs in `src/components/`, pose estimation and scoring in `src/pose/`, and persistence or service integrations in `src/lib/`. `src/App.tsx` coordinates the practice flow; keep detailed game logic out of it. Static files belong in `public/`, documentation images in `docs/`, and provisioning utilities in `scripts/`.

As the trainer grows into a downloadable game, add gameplay systems behind focused modules rather than expanding existing panels into catch-all components. Preserve the core privacy boundary: camera frames, videos, and pose landmarks stay on the player's device.

## Build, Test, and Development Commands

- `npm install` installs dependencies and downloads roughly 38 MB of MediaPipe assets.
- `npm run dev` starts the Vite development server.
- `npm run build` runs TypeScript project checks and creates the production bundle in `dist/`.
- `npm run lint` checks React and TypeScript code with Oxlint.
- `npm run preview` serves the production bundle locally.
- `npm run setup` refreshes generated assets under `public/models/` and `public/wasm/`; do not commit those directories.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for shared constants. Component files use `PascalCase.tsx`; utility modules use descriptive lowercase names such as `angles.ts`.

## Testing Guidelines

There is no automated test runner yet. Every change must pass `npm run lint` and `npm run build`. Manually verify affected browser flows, including camera permission, video loading, and offline behavior when relevant. Name future colocated tests `*.test.ts` or `*.test.tsx`; prioritize deterministic pose, scoring, persistence, and gameplay logic.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, optionally scoped, for example `UI: put the dance first` or `fix(library): push the local library on sign-in`. Keep each commit focused. Pull requests should explain the player-facing result, list verification performed, link related issues, and include screenshots or recordings for UI or animation changes. Call out new downloads, permissions, storage, account synchronization, or privacy implications explicitly.

## Configuration & Generated Files

Store local account configuration in `.env.local` using `VITE_PLAYKIT_URL`; never commit local environment files. Treat `dist/`, `public/models/`, and `public/wasm/` as generated output.

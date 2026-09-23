# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People playing a camera-based dance game alone or side by side, at enough distance from the screen that major actions and feedback must remain legible without touch input.

## Product Purpose

Dance Trance turns a local dance video into playable choreography: it analyses reference movement, registers one or two players through the camera, previews timed hit markers, scores poses and timing, and supports gesture-controlled song and round navigation.

## Positioning

Any locally loaded dance video can become a private, on-device multiplayer rhythm game without uploading the footage.

## Operating Context

Players dismiss an Insert Coin attract screen, register in the camera view, navigate menus with deliberate held poses, choose a song, follow the reference video, and read scores and timing feedback while moving several feet away from the display.

## Capabilities and Constraints

- Reference-video pose analysis and hit-marker generation run locally.
- Camera pose detection supports one or two players.
- Gameplay includes readiness gating, countdown, timed scoring, combos, results, replay, and song selection.
- Previous and next repeat while the arm pose stays held; select and back fire once and require a release. Menu gestures are disabled during active play.
- The camera stays active across tracking, menus, and gameplay; a separate long crossed-arm hold pauses a round.
- Importing a new video requires the device file picker.
- Existing mouse, touch, and keyboard controls remain functional fallbacks.
- UI must work on desktop and narrow mobile web layouts.

## Brand Commitments

- Product name: Dance Trance.
- The visual identity is an original arcade world, including a custom usable display alphabet for titles, menus, scores, and major actions.
- Body copy and dense instructions prioritize legibility over display styling.
- Image generation is part of the identity and asset-production workflow.

## Evidence on Hand

- The working application and gameplay implementation are in this repository.
- Existing pose, gameplay, gesture, and hit-marker behavior must be preserved through the redesign.
- There are no supplied commercial claims, testimonials, licensed characters, or external brand assets.

## Product Principles

- Movement is the primary controller.
- Feedback must read at dance-floor distance.
- Local-first privacy is a product feature, not implementation trivia.
- Multiplayer state must remain clear without requiring setup knowledge.
- Visual spectacle may amplify gameplay but must not obscure timing or body-position feedback.

## Accessibility & Inclusion

Every gesture action keeps an equivalent conventional control. Critical states use text and shape in addition to color, and reduced-motion preferences must remain respected.

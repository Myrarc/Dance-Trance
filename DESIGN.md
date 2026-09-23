---
name: Dance Trance — Poster Pop Arcade
description: A local-first dance game styled as a warm screen-printed arcade poster.
colors:
  background: "#f5e7c8"
  panel: "#fff4d8"
  panel-soft: "#ead8b6"
  ink: "#30233f"
  muted: "#705d72"
  coral: "#ee665f"
  coral-soft: "rgba(238, 102, 95, 0.18)"
  turquoise: "#2cb8ba"
  marigold: "#e7aa33"
  lilac: "#a88bb8"
  error: "#d94c58"
typography:
  display:
    fontFamily: "'Trance Display', Impact, sans-serif"
    fontSize: "clamp(25px, 4vw, 58px)"
    fontWeight: 800
  countdown:
    fontFamily: "'Trance Display', Impact, sans-serif"
    fontSize: "clamp(72px, 16vw, 180px)"
    fontWeight: 800
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 800
rounded:
  control: "7px"
  media: "7px"
  card: "6px"
  panel: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    border: "3px solid {colors.ink}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    border: "4px solid {colors.ink}"
---

# Design System: Poster Pop Arcade

## Direction

Dance Trance feels like a friendly local arcade printed onto a late-1970s concert poster. Warm paper, flat inks, thick registration outlines, and deliberately offset shadows create the identity. The aubergine Insert Coin screen opens the experience; tracking then puts the camera first.

## Color

Use cream (`#f5e7c8`, `#fff4d8`) as paper, aubergine (`#30233f`) as universal ink, and coral, turquoise, marigold, and lilac as flat spot colors. Use `#fff9e9` only as a button-hover paper highlight. Do not introduce glossy gradients, glass, neon glows, or dark cyberpunk surfaces. Semantic success uses turquoise; warning uses marigold; error uses `#d94c58`.

## Typography

`Trance Display` is the custom local face and is reserved for the wordmark, stage headings, gesture commands, scores, countdowns, and result moments. Its responsive display range is 25–58px; countdowns retain the 72–180px range. Native sans remains the compact workhorse for controls and supporting copy at 11–16px. Gameplay numbers use tabular numerals.

During camera registration, instructions must read from a standing distance: use native sans at 16–23px for controls, status, and tracking advice. This is an intentional exception to the compact UI scale.

## Shape and depth

Use square-ish radii: 6px cards, 7px media and controls, 10px panels. Main surfaces use 3–4px aubergine borders. Physical hierarchy comes from hard offset shadows: 4px for controls/cards, 7px for desktop panels. Soft drop shadows are limited to existing overlays where legibility over live video demands them.

## Layout

The desktop viewport is a vertical poster: wordmark and controls, then the dance stage. The attract screen is full-bleed. Initial player setup makes the live camera dominant. Menus keep a camera preview and a large coral selected marker that reads from across the room. The song picker uses a circular carousel with the selected song and its looping video at the center. Song selection leads to a thumbnail loading card and then automatically to the round. During play the reference video is dominant and the camera is picture-in-picture at the top left. At 900px and below, panels stack and decorative background shapes disappear. Gesture and pointer/keyboard navigation must remain equally usable.

## Interaction

Buttons move against their hard shadow when pressed. The selected menu item pulses between coral and marigold while held navigation repeats; reduced motion keeps the static coral marker. The song carousel slides its active card into the center while the wrapping card passes behind it. Existing gameplay and hit-marker motion remain unchanged. Respect `prefers-reduced-motion`. All focusable controls receive a 3px turquoise focus ring with 3px offset.

## Signature elements

- Split coral/marigold wordmark in the custom display face.
- Aubergine outlines and intentionally offset print shadows.
- Turquoise gesture guide that reads like a stamped instruction strip.
- Flat spot-color track cards and a large marigold readiness/game strip.

Do not replace semantic controls with decorative images. The generated visual is a direction reference; the shipped UI stays responsive, selectable, and accessible.

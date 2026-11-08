# Changelog

## 0.1.0 - 2026-11-08

The visual effects of a StarCi front end, confetti first.

- Added: the shared overlay (`playOverlay`, `EffectSystem`, `EffectHost`, `pageHost`). Every effect plays on a canvas fixed over the page, with no pointer, hidden from assistive technology, sized to the viewport at a pixel ratio capped at 2, and removed when the effect finishes or is stopped. A frame step is capped at 1/20 s, so a tab that slept does not jump every particle to its end. Nothing is drawn on the server, without a 2D context, or for a reader who asked for reduced motion (unless `ignoreReducedMotion`).
- Added: the theme palette (`themeColors`): an effect draws in the app's Grammar tokens (`--accent`, `--accent-soft`, `--success`, `--warning`, `--accent-soft-foreground`), skipping any the app leaves unset, with a fixed fallback outside any Grammar root.
- Added: confetti (`fireConfetti`, `./confetti`). Presets `celebrate` (two corner cannons crossing over the middle, then a centre burst) and `burst`, or the caller's own bursts (origin, aim, spread, count, speed). Paper strips tumble and dots fall under gravity, air drag and a paper fall speed, then fade over the last quarter of their life. The physics are pure functions over a seeded random source.
- Added: `EffectOnMount` (`./react`), a client trigger that plays an effect once on mount, after a short delay, and stops it on unmount; it renders nothing, so a server page can place it.
- The specs run the physics on a seeded source, the overlay on a recording 2D context with a manual frame clock, and the trigger on React in jsdom, at 100% lines.

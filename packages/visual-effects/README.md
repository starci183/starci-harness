# @starci/visual-effects

The visual effects of a StarCi front end. Each effect is one system played on a shared overlay: a canvas fixed over the page that takes no pointer, is hidden from assistive technology and is removed when the effect ends. Effects take their colours from the app's Grammar theme tokens (`--accent`, `--accent-soft`, `--success`, `--warning`, `--accent-soft-foreground`), so every app plays its own brand, and they draw nothing for a reader who asked the system for reduced motion. They own no layout and no component: the screen around them is the Grammar's.

| export | what it is for |
|---|---|
| `fireConfetti(options?)` | throws confetti over the page: `preset` `celebrate` (two corner cannons crossing over the middle, then a centre burst; the default) or `burst` (one burst below the centre), or the caller's own `bursts`; `colors` overrides the theme. Returns `{ done, stop }`. |
| `EffectOnMount` (`./react`) | a client trigger that plays an effect (`effect="confetti"`, an optional `preset`, `delayMs` default 250) once when it mounts and stops it when it unmounts; it renders nothing, so a server page places it beside a success screen |
| `playOverlay(name, options, host, create)`, `EffectSystem` | the overlay every effect runs on: `create` builds a system that `advance`s by a time step, `draw`s on the 2D context and says when it `isFinished` |
| `pageHost()`, `EffectHost` | the browser surface an effect reads (frame clock, viewport, pixel ratio capped at 2, motion preference, random source); null on the server, and a spec hands in its own |
| `themeColors`, `THEME_TOKENS`, `FALLBACK_COLORS` | the theme palette an effect draws in |
| `launch`, `advance`, `opacityOf`, `isVisible`, `PRESETS` | the confetti physics as pure functions (gravity, air drag, a paper fall speed, tumble, fade), for a custom shot |

Subpaths: `.` (everything), `./confetti` (that effect alone), `./react` (the mount trigger; `react` is an optional peer).

## In an app

```tsx
// a success screen (a server component): the Grammar draws the screen, the effect plays over it once
import { EffectOnMount } from "@starci/visual-effects/react"

<Stack gap="section">
    <EffectOnMount effect="confetti" />
    <SurfaceCard ...>...</SurfaceCard>
</Stack>
```

```ts
// after an action resolves in a client handler
import { fireConfetti } from "@starci/visual-effects"

await pay()
fireConfetti({ preset: "burst" })
```

## Adding an effect

An effect is a folder of its own under `src/` with an `index.ts` (declared as a subpath export): its physics as pure, seeded, tested functions, a `<name>System(options, host)` that returns an `EffectSystem`, and a `play<Name>` or `fire<Name>` that calls `playOverlay`. Its presets join `EffectPresets` in `src/react.ts` so `EffectOnMount` can play it. It reads colours with `themeColors` unless the caller passes its own.

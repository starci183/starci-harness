# Changelog

## 0.1.0 - 2026-11-18

The screenshot gallery of a StarCi app as one Vite config, built with the StarCi Grammar.

- Added: `@starci/gallery/vite` (`defineGallery({ app, locale, allowedHosts, devUrl, pages, canvas })`, and the plugin `gallery(options)` alone). The plugin reads `gallery/pages/**` (explain.md, links.json, the shots), `gallery/flows.json`, and the design canvas (`.starcistacks/canvas`: design.json and the fragments of `pages/`) at build and dev time, serves the shots and the canvas frames, and mounts the gallery app. The canvas folder defaults to `../.starcistacks/canvas`.
- Added: the gallery app. A top bar with the app name and "screens, matches, not built", a width switch (1440, 1920, 390) and a view switch (side by side, slider, shot only); a tree of areas and screens with the status dot of design.json (matches green, built but differs amber, stale red, not built grey); the states of a page as chips (`-detail`, `-empty`, `-first-visit`, `-loading`, `-error`, `-no-match`, `-editing`); the explain.md of the screen on the right with its gallery id, status, route and a link to the dev app when the route is static; the flow map. Words in `vi` and `en` (any other locale reads `en`).
- Added: `@starci/gallery` (the pure side): `parseExplain`, `buildModel`, `statusOf`, `splitState`, `noteToMarkdown`, `LABELS`, kept answering like the reader of `starci app check`.

# Changelog

## 0.1.3 - 2026-11-19

- Changed: requires @starci/grammar 0.47.3, the Grammar it ships with.

## 0.1.2 - 2026-11-19

- Changed: requires @starci/grammar 0.47.2, the Grammar it ships with.

## 0.1.1 - 2026-11-18

- Changed (`explain`): the explain reader skips the section `## Phương án đã cân nhắc` (the record of the options weighed, PROJECT-GALLERY-7) instead of reading it as a region, as `starci app check` does.

## 0.1.0 - 2026-11-18

The screenshot gallery of a StarCi app as one Vite config, built with the StarCi Grammar.

- Added: `@starci/gallery/vite` (`defineGallery({ app, locale, allowedHosts, devUrl, pages, canvas })`, and the plugin `gallery(options)` alone). The plugin reads `gallery/pages/**` (explain.md, links.json, the shots), `gallery/flows.json`, and the design canvas (`.starcistacks/canvas`: design.json and the fragments of `pages/`) at build and dev time, serves the shots and the canvas frames, and mounts the gallery app. The canvas folder defaults to `../.starcistacks/canvas`.
- Added: the gallery app. A top bar with the app name and "screens, matches, not built", a width switch (1440, 390: the two widths of the gallery) and a view switch (side by side, slider, shot only); a tree of areas and screens with the status dot of design.json (matches green, built but differs amber, stale red, not built grey); the states of a page as chips (`-detail`, `-empty`, `-first-visit`, `-loading`, `-error`, `-no-match`, `-editing`); the explain.md of the screen on the right with its gallery id, status, route and a link to the dev app when the route is static; the flow map. Words in `vi` and `en` (any other locale reads `en`).
- Added: `@starci/gallery` (the pure side): `parseExplain`, `buildModel`, `statusOf`, `splitState`, `noteToMarkdown`, `LABELS`, kept answering like the reader of `starci app check`.
- Added: side by side holds while each column keeps 320px, so at a 1440 window the design and the shot stand next to each other; the explanation panel narrows with the window (18rem to 26rem) before the columns stack, and a button in the top bar hides or shows it, remembered per viewer in localStorage (the panel stays open when storage is blocked).
- Added: labels derived from a folder, a state or a title are capitalized for display by the app's locale (`capitalize`), never the ids; a press on a frame or a shot opens it full size in a Dialog with zoom (buttons and `+`, `-`, `0`), drag to pan and Escape to close; the explanation shows the overview and the business regions (Nghiệp vụ, Tổng quan, Phản biện) first, and every other region as one closed disclosure; the board is as tall as its frames; below 1100px one pane shows at a time (Bản vẽ, Ảnh thật, Trượt so, Giải thích).
- Changed: the status of a screen is read truthfully. A design.json entry is the record; with none, a frame and a shot are "coded, not recorded" (with a hint to record it), a shot alone is "coded, no drawing", a frame alone "drawn, not coded", neither "no drawing yet". The top bar counts add up (screens = khớp + lệch + cũ + đã code chưa ghi duyệt + chưa code), the column title says "approved" only from an approved status on, and a legend button explains the dots.
- Added: the views Bản vẽ, Đối chiếu (side by side, slider, onion skin, difference) and Ảnh thật, each disabled with its reason when the screen has only one side; every canvas page shows in the tree and renders read-only with its note, drafted or not coded yet. On a phone the panes are Bản vẽ, Ảnh thật, Đối chiếu and Giải thích.

# `@starci/gallery`

The screenshot gallery of a StarCi app ([contexts/project/gallery.md](../../contexts/project/gallery.md)) as one Vite config. The app's `gallery/`
folder holds the pages (`pages/<area>/<screen>/` with the shots, `explain.md`, `links.json`), `flows.json` and `routes.json`; this package reads them with the
design canvas (`.starcistacks/canvas`: `design.json` and the fragments of `pages/`) and shows each screen.

```js
// gallery/vite.config.js (managed by `starci app sync`)
import { defineGallery } from "@starci/gallery/vite"

export default defineGallery({ app: "starci-next", locale: "vi", allowedHosts: [] })
```

| option | meaning |
|---|---|
| `app` | the app's name (title and top bar) |
| `locale` | the app's default locale; `vi` and `en` have a table, any other reads `en` |
| `allowedHosts` | the hosts the dev server answers besides localhost (the dev tunnel's gallery host) |
| `devUrl` | the base URL of the dev app: a screen with a static route gets "Mở trên dev" |
| `pages` | the pages folder, default `pages` |
| `canvas` | the canvas folder, default `../.starcistacks/canvas` |

`defineGallery` also sets the dev server the stack expects (the IPv4 loopback, the PNGs not watched) and Tailwind for the Grammar's stylesheet. The page
`index.html` of the app loads the entry `/@starci-gallery/main.js`.

## What it shows

- The top bar: counts ("127 màn · 0 khớp · 6 đã code chưa ghi duyệt · 121 chưa code", which add up), the width switch (1440, 390), the three views (Bản vẽ, Đối chiếu, Ảnh thật) and a legend of the dots. Đối chiếu compares the approved design frame and the real shot side by side, with a slider, as an onion skin or as a difference (a shape that differs lights up); a view that needs the missing side is disabled with its reason. A canvas page with no shot yet (drafted, or approved and not coded) shows read-only with its note. The flow map is a second view.
- The tree: areas and screens, each with the dot of its status in `design.json`: matches green, built but differs amber, stale red (the shots are not the recorded
  sha256, or an approved screen still records shots), not built grey.
- The states of a page: sibling screens named with the state suffixes of PROJECT-GALLERY-6 (`-detail`, `-empty`, `-first-visit`, `-loading`, `-error`,
  `-no-match`, `-editing`) are chips over the viewer.
- The explanation: the screen's `explain.md` (or the note of its canvas fragment when it has no folder yet), the overview as rows, each region with
  its `Vì sao`, `Luật` and `Grammar` lines, the flags `CHƯA RÕ` and `SAI`.

## API

`@starci/gallery` exports the pure side: `parseExplain`, `linkList`, `flowList`, `noteToMarkdown`, `buildModel`, `statusOf`, `splitState`, `devPath`,
`LABELS`. `npm test` typechecks, lints and runs the specs of the loader (tree, statuses, counts and states of a fixture gallery with its `design.json`).

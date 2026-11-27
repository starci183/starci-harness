# The screenshot gallery of an app

Every app source repository carries a screenshot gallery at `gallery/`: the one place where the shots of every screen and the
explanation of why each region is drawn that way are kept and looked at. This file owns the rule; every other page links to it.

```
gallery/
  board/board.yaml                 optional: the design board of the app, one module per section beside it (PROJECT-GALLERY-9)
  pages/<area>/<screen>/     one folder = one screen (one agent, one state)
    1440.png  390.png    the shots; only these two width names
    explain.md                     required when any png exists
    links.json                     optional navigation hotspots
  flows.json                       optional named flows (ordered screen ids)
  routes.json                      optional route exclusions, each with its reason (PROJECT-GALLERY-4)
```

## PROJECT-GALLERY-1 Every app carries a gallery, and every UI fix round saves shots to it

1. **What it is.** `gallery/` is a standalone Vite app at the app root, beside `be/` and `fe/`, outside the npm workspaces, and a thin
   config over the harness package `@starci/gallery` (`packages/gallery`, built with the Grammar): `gallery/vite.config.js` calls
   `defineGallery({ app, locale, allowedHosts })` and that is the whole app, with no page code of its own. The package reads
   `gallery/pages/**`, `gallery/flows.json` and the design canvas (`.starcistacks/canvas`, PROJECT-GALLERY-6; the folder is an option,
   `../.starcistacks/canvas` by default) at build and dev time. It shows a tree of the screens, each with a status dot (a `design.json` entry is the record: matches green, built but differs amber, stale red,
   drawn and not coded grey; a screen with no entry is read from what exists: a frame and a shot are coded and not recorded, a shot alone coded with
   no drawing, a frame alone drawn and not coded), and the top bar counts them so that screens = khớp + lệch + cũ + đã code chưa ghi duyệt + chưa code (a
   screen with no shot is not coded). A screen opens in three views at width 1440 or 390: the design frame (Bản vẽ), the comparison of the design
   and the shot (Đối chiếu: side by side, a slider, an onion skin, a difference) and the shot (Ảnh thật); a view that needs the missing side is
   disabled with its reason. A phone shows one pane at a time, the states of its page as chips, its explanation (PROJECT-GALLERY-2)
   and a flow map of the screens (PROJECT-GALLERY-3). The files of `gallery/` are managed (`package.json`, `index.html`,
   `README.md`, `vite.config.js`): `starci app sync --execute`
   renders them (slot `app.gallery`, templates in `packages/hfs/templates/app/gallery`), `package.json` pins `@starci/gallery`
   at the version of the canon pins, `starci app scaffold` writes them with
   the rest of a new app, and a hand edit is `HFS_MANAGED_FILE_DRIFT`. The lockfile `gallery/package-lock.json` is the app's. **The thin gallery has no `gallery/src`.** Sync never writes it and `app.gallery` and `HFS_APP_GALLERY_MISSING` never demand it.
2. **What goes in it.** Every round that changes a screen (a UI fix, a redesign, a new screen) saves the shots of every screen it
   touches at widths 1440 (desktop) and 390 (phone), the whole screen, and updates that screen's `explain.md`. A round
   that touches no screen saves none. The gallery holds the current state only: a before and after comparison belongs in the
   fix report, never in the gallery.
3. **The layout.** One folder per screen: `gallery/pages/<area>/<screen>/`. `<area>` is the product area (a kebab-case folder,
   usually the route group), `<screen>` a kebab-case name of one agent in one state. The folder holds exactly `1440.png`
   and `390.png` (either may be absent), `explain.md` and optionally `links.json`. Every other file and every
   subfolder is `HFS_APP_GALLERY_SCREEN_FILE`, a `before/` folder included, and so is a `1920.png` (the gallery has two widths only; an app deletes its 1920 shots): a state (`today-menu-open`) or an agent variant
   (`today-sales`) is its own screen folder, so `1440-open.png` and `sales-1440.png` never exist. A file straight in `pages/` or in
   an area folder is outside a screen folder. Example: `gallery/pages/inbox/today/1440.png`.
4. **Where it serves.** On the app's base port plus 50 (`ruleParams.gallery.portOffset` of [hfs/slots.yaml](../hfs/slots.yaml)),
   so `local.basePort` 3100 serves the gallery on 3150 and 3000 on 3050 ([stacks.md](stacks.md) PROJECT-STACKS-10 owns the role
   table of the ports around it). `starci app stack up --env dev` starts it next to the other native processes, installs its
   dependencies once, waits for it to answer and records it with them; `stack down` stops it. An environment that declares its own
   process named `gallery` keeps it.
   The dev server binds the IPv4 loopback (`server.host` `127.0.0.1` of the managed `vite.config.js`), the address the dev tunnel's ingress
   rule reaches (an IPv6-only bind answers 502 there; `localhost` in a browser still works). A public host for the gallery is declared once,
   as a route of the environment's `local.tunnel` named `gallery` with `port: gallery` (the derived port, not a `local.ports` entry; it needs
   `local.basePort`): `{name: gallery, host: <project>-gallery-dev.example.org, port: gallery}`. `starci app sync` renders those hosts into
   `server.allowedHosts` of `gallery/vite.config.js` (Vite answers 403 to any other `Host`; the managed file is drift until sync writes the host),
   and `stack up --execute` adds the ingress rule and DNS record like any other route of the tunnel, so the host the config admits and the one
   the tunnel serves are the one declaration. `STACK_LOCAL_TUNNEL_GALLERY` refuses the route of an app with no gallery.
5. **The PNGs are never committed.** They are local evidence of a round, ignored by the managed `.gitignore` block
   (`gallery/pages/**/*.png`); the gallery app, every `explain.md`, every `links.json` and `flows.json` are source and are committed.
6. **A new app and an existing one.** A new app has the gallery from its scaffold. An existing app gets it from `starci app sync --execute`,
   then installs once (`npm install` in `gallery/`, or
   `starci app stack up`) and commits `gallery/` with its lockfile. An app that declares no `local.basePort` declares one first
   (PROJECT-STACKS-10): the gallery port derives from it.
7. **Its language is the app's.** The managed files render their words (the title and the README, and the `locale` that `vite.config.js`
   hands to `@starci/gallery`, which draws the search box, the empty state, the bug labels, the tabs and the status names) in the app's default locale: the `DEFAULT_LOCALE` its i18n routing source declares
   (`fe/apps/<app>/src/modules/i18n/routing.ts`). `vi`
   and `en` have a table (`GALLERY_LABELS` in `packages/hfs/runtime/scripts/hfs/gallery.mts` for the files, `LABELS` in `packages/gallery/src/labels.ts` for the app); any other locale, or none
   declared, renders `en`. The field names of `explain.md` (`Vì sao`, `Luật`, `Grammar`) are the same in every locale. The file
   stays managed per locale: sync renders the locale's text, and a hand edit or a default locale that changed is drift that
   `starci app sync --execute` settles.

## PROJECT-GALLERY-2 Every screen is explained, region by region; a region that cannot be explained is a bug

Every design decision on a screen is traceable to an owner law and a Grammar reference, so the shots stop drifting from the laws.

1. **`explain.md`.** Each screen folder with a shot holds one. Its front matter has `title`, `route` (the URL pattern of the
   screen) and `area` (the folder's). Below it is one `## <region name>` per region of the screen (a header band, a pane, a field,
   a table, a dialog), each with three lines:
   - `Vì sao:` what the region is and why it is drawn that way, naming the owner law;
   - `Luật:` the law, cited by its contexts anchor id (`starci contexts anchor <id>` prints it) or, for an owner decision not yet
     written into the contexts, by the name of the decision file; the gate does not yet resolve the cited ids against the anchor
     table (an open question of [harness/questions.md](../harness/questions.md));
   - `Grammar:` the component and prop that draws it, with its source path or story.

   A line may wrap onto indented lines, carry a list bullet or be bold; text before the first `## ` is the screen's introduction.
   The one section that is not a region is `## Phương án đã cân nhắc` (PROJECT-GALLERY-7 item 3): the options the final critique weighed, each
   with why it was chosen or rejected. It is optional while the screen is `drafted`, `approved` or `built`, and required for `matches` (PROJECT-GALLERY-6
   item 5). The readers and the gallery skip it as a region, so it needs no `Vì sao`, `Luật` or `Grammar` lines.
2. **The rule.** A region that cannot be explained with a law and a Grammar reference is a BUG in the screen, not in the
   document. The author fixes the screen first, then writes the explanation. A region the author knows is not yet explained or
   is wrong says `Vì sao: CHƯA RÕ` or `Vì sao: SAI` (a value that starts with either word) so it stays visible instead of
   being hidden by a plausible sentence.
3. **The gallery app** shows only the screens that have an `explain.md`, each image beside its explanation, and flags every
   screen without a region and every region lacking a `Vì sao` or `Grammar` value or marked `CHƯA RÕ` or `SAI`; the area list
   counts the screens it flags and a switch lists only those. The summary counts the screens it hides for lack of an
   `explain.md`, which the gate fails. The reader is `packages/gallery/src/explain.ts`, the same logic as the gate's (a spec of hfs keeps them answering alike).
4. **Who writes it.** The author of every UI round writes or updates `explain.md` with the shots; the coordinator reads the
   gallery's flags before reporting a round done.

## PROJECT-GALLERY-3 Screens link into flows

1. **`links.json`** (optional, in a screen folder) lists the hotspots that lead away from the screen, extracted from the app's
   navigation: a list (or `{ "links": [...] }`) of `{ "to": "<area>/<screen>", "x", "y", "w", "h" }`, the box a fraction of the
   shot. The gallery draws each box over the shot and opens the target on a click.
2. **`flows.json`** (optional, in `gallery/`) names flows as ordered screen ids: `{ "<flow name>": ["<area>/<screen>", ...] }` (or
   a list of `{ "name", "screens" }`). The gallery's flow map view draws each flow as its screens joined by arrows, then every link
   as an edge.
3. A `to` or a flow step that names no screen folder is `HFS_APP_GALLERY_LINKS`.

## PROJECT-GALLERY-4 Every route of the front end has a screen

0. **A route is keyed by its app.** Two front-end apps can serve the same path (a landing and the product both serve `/`), so every match of a screen to a route, a source, an exclusion, a board section or the UI-audit reach uses `<app>:<route key>`. A screen's app is, in order, the optional `app` of its `screen.yaml` (or its `explain.md` front matter), then the app whose route tree serves its route, then the single front-end app. Two apps serving the route and no `app` is `HFS_APP_GALLERY_ROUTE_AMBIGUOUS` (a warning in `--env local`, an error in `--env prod`): the harness never picks one. An entry of `gallery/routes.json` may carry `app` to exclude one app's route; without it, every app's route of that path is excluded. A board section takes `app` the same way. A project with one front-end app judges as before.

1. **The rule.** Every user-facing route of the app's front end has at least one screen folder in `gallery/pages/` whose `explain.md`
   front matter `route` matches it. A route is a Next app router `page.tsx` under `fe/apps/<app>/src/app` (the slot `fe.route`, the
   same shape in every app). Its pattern is its folder path without the `[locale]` prefix and the `(group)` folders:
   `fe/apps/web/src/app/[locale]/(console)/agents/[agentKey]/page.tsx` is `/agents/[agentKey]`. A parallel slot (`@modal`), an
   intercepting route (`(.)photo`) and a private folder (`_parts`) own no screen. A dynamic segment (`[id]`, `[...rest]`) is one
   screen: `/agents/[agentKey]` and `/agents/:key` are the same route, and a state or an agent variant of it is its own folder with
   the same `route`.
2. **Coverage is judged by `explain.md`.** The shots are local evidence (PROJECT-GALLERY-1 item 5) and never tracked, so a route is
   covered by a screen folder with an `explain.md` (front matter, regions) whether or not any PNG exists on this machine. A QA round
   that saves its shots outside `gallery/pages/` covers nothing.
3. **Exclusions.** A route that is not a product screen (a developer-only tool page, a redirect) is declared in `gallery/routes.json`,
   each with the reason it has no screen:
   ```json
   { "exclude": [{ "route": "/dev/flow-canvas", "reason": "developer tool, not shipped to users" }] }
   ```
   A missing `reason`, a file that is not this shape, and an exclusion of a route the front end does not have are
   `HFS_APP_GALLERY_LINKS`. The file is the app's (slot `app.gallery-routes`), committed.
4. **Severity.** `HFS_APP_GALLERY_ROUTE_MISSING` is a warning in `--env local` (a round in progress lists what it has not drawn yet)
   and an error in `--env prod` (the push hook, CI, the release gate; [check-cache.md](check-cache.md) owns the two environments).

## PROJECT-GALLERY-5 A screen's explanation changes with its source

1. **The convention.** A change to a screen's source is followed by a change to that screen's `screen.yaml` (or `explain.md`); no check judges it.
   The source of a screen is best-effort mapped: the route's `page.tsx` and every file under the feature folder `features/pages/<Name>/`
   the page imports (a thin page imports exactly one feature; a component a feature takes from `components/` is not followed). A
   route with several screen folders is current when any of their screen files is touched.
2. **What is judged.** `starci app check` (a whole run) judges the files the commits since the base, the index and the work tree
   change. On a branch other than `main` and `dev` the base is the merge-base of `HEAD` with `STARCI_BASE_REF`, else with `origin/dev`, else with
   `origin/main`, so a lane's own check judges the whole diff its landing brings to dev (the lane merged into `origin/dev`); on `main`, on `dev`
   or when none of those refs is behind `HEAD` it is the lint ratchet's base (`origin/<branch>`, else `HEAD^`). The same base serves
   the UI Audit (PROJECT-GALLERY-8), and the run prints it
   (`gallery coupling: judged N file(s) changed since <sha>, <why>`). A lane's own `origin/<lane>` is never the base: once the lane is pushed it
   equals `HEAD` and the base would fall to `HEAD^`, the last commit alone.
3. **Keeping it current.** An excluded route and a route with no screen have nothing to keep current (the second is `HFS_APP_GALLERY_ROUTE_MISSING`). Re-read each region of the screen against the new source, rewrite the `Vì sao`, `Luật` and `Grammar` lines
   that changed (a fix that changes no visible region still opens `explain.md` and confirms it), and re-shoot the shots (PROJECT-GALLERY-1).

## PROJECT-GALLERY-6 An area can be drawn before code: the design canvas mirrors the gallery and records each screen's design status

The design pass (`/claude-design`; [skills/claude-design/SKILL.md](../../skills/claude-design/SKILL.md) owns how it is drawn and produced) is
the gallery drawn before code: it takes the business of an existing or planned page and draws its best UX on the app's Grammar, for the owner
for the page to be coded from. No owner approval gates the build (owner decision 2026-11-25): an agent drafts, builds, and the owner fixes later if needed; the same holds for NIVO and StarCi Next. This rule owns where the canvas lives, how it maps onto the gallery, the lifecycle of a screen and what
the gate judges.

1. **The canvas lives in the app.** `.starcistacks/canvas/` at the app root (slot `app.starcistacks.canvas`; a reserved folder,
   never an environment) holds the whole design and is committed:
   ```
   .starcistacks/canvas/
     tokens.css  canvas.css         the shared kit: the app's Grammar look as tokens, and the board (frames, labels, notes)
     briefs/<NN>-<slug>.md          one brief per page, written by the lead
     pages/<NN>-<slug>.html         one fragment per page, written by its lane; NN is the board order
     <app>-design.html              the assembled board, the assembler's output
     design.json                    the status of every designed screen (item 4)
   ```
   `<slug>` is the gallery id of the page's base screen with `/` written `-` (`04-customers-list.html` for `customers/list`). The canvas is outside
   every lint and format scope (`.prettierignore` ignores `.starcistacks/`; ESLint and stylelint judge the sides). A published Artifact is only a
   view of `<app>-design.html`; the canvas in the repository is the source.
2. **The same ids, states and sizes as the gallery.** Every drawn screen is a gallery screen id `<area>/<screen>` (PROJECT-GALLERY-1 item 3): an
   existing page keeps its ids, a new one proposes them. A state is its own screen, named from the page's base screen with the suffix of its
   state:

   | state | screen id | what the frame shows |
   |---|---|---|
   | danh sách (at rest) | `<screen>` | the page with real rows, the primary action, filters at rest |
   | chi tiết | `<screen>-detail` | one record open (a pane on 1440, its own screen on 390); a detail with its own route is its own page |
   | trống | `<screen>-empty` | no record yet, with the one action that creates the first |
   | lần đầu | `<screen>-first-visit` | the first visit: the onboarding hint or setup step |
   | đang tải | `<screen>-loading` | the skeleton of the ready layout |
   | lỗi | `<screen>-error` | the load failed: the error with retry, the shell intact |
   | không khớp bộ lọc | `<screen>-no-match` | filters set, no match: the empty state that clears them |
   | đang soạn | `<screen>-editing` | the create or edit form open, a validation message on one field |

   A state the page cannot reach is not drawn. The design draws 1440 and 390, and the gallery round of the built page shoots the same two
   (PROJECT-GALLERY-1 item 2); no other width is drawn, shot, compared or recorded.
3. **The note is the screen's `explain.md`.** Each drawn screen carries one note in the format of PROJECT-GALLERY-2 item 1 (front matter,
   introduction, one region per region with its `Vì sao`, `Luật` and `Grammar` lines); what it says, the real operations and Grammar elements and
   the `cần Grammar` and `cần API` marks, is the [Method of the skill](../../skills/claude-design/SKILL.md#method). When the page is built, the
   note is copied as that screen's `explain.md`; the gallery never holds a second wording.
4. **`design.json`.** One manifest records the status of every designed screen:
   ```json
   {
     "areas": ["customers"],
     "pages": {
       "customers/list": { "status": "matches", "approvedAt": "2026-11-17T09:30:00+07:00", "matchedAt": "2026-11-18T16:00:00+07:00", "board": "https://claude.ai/artifact/…",
                           "shots": { "1440": "<sha256>", "390": "<sha256>" } }
     }
   }
   ```
   `areas` lists the areas whose screens are designed before code; every page id is in one of them. `board` is the https link of the published
   board. `approvedAt` (a full ISO timestamp with its zone, never a bare date) is set from `approved` on and absent before. `shots` holds the lowercase sha256 of the 1440 and 390 PNGs
   from `built` on and is absent before. `matchedAt` is set with `matches` and is absent before. `pending` is optional (item 9). No other key.
5. **The lifecycle, and who sets each status.**
   - `drafted`: the lead, when the screen is drawn on the board. A redraw of an approved screen returns it to `drafted` and drops `approvedAt` and
     `shots`.
   - `approved`: optional, the lead, when the drawing is settled (the owner's "đẹp" is welcome, never required). It sets
     `approvedAt` and drops any `shots`. A `drafted` page may be built without it: the code lane goes `drafted` to `built`.
   - `built`: the code lane that builds the screen: it codes the page (with every `cần API` operation of its notes), saves the screen's shots in
     `gallery/pages/<area>/<screen>/` at 1440 and 390, copies the approved note as its `explain.md`, and records the sha256 of the 1440 and
     390 PNGs.
   - `matches` (final): the lead or a reviewer, never the lane that built it, after the final critique of PROJECT-GALLERY-7 item 3 and after comparing
     the shots with the approved frames; it records the sha256 of the shots it compared and `matchedAt` (a full ISO timestamp with its zone, `matches`
     only). It requires the section `## Phương án đã cân nhắc` in the screen's `explain.md`: a screen without that record is not final.
6. **How the order is judged.** The shots are never tracked (PROJECT-GALLERY-1 item 5) and file times mean nothing in a fresh checkout, so a
   shot's age is read neither from the disk nor from git. The manifest carries the order: a redraw or an approval drops the shot record, so a sha recorded on
   a page is by construction taken after its latest design, and a shot record on a page that is only drafted or approved is older than the
   design. Where the work tree holds the PNGs (the author's machine, the push hook), each is hashed and must equal the recorded sha; a fresh
   checkout judges the record alone.
7. **Severity.** A manifest that is not this shape is an error. The other findings are warnings in `--env local` and errors in `--env prod`, as
   item 4 of PROJECT-GALLERY-4.

8. **The gallery is where the canvas is reviewed too.** Every page of the canvas shows in the gallery's tree, drafted or approved and not coded yet, with
   no `gallery/pages` folder needed: its frames at 1440 and 390 and its note (what the board shows on claude.ai; whoever does not open the board there reads
   it here) with the chip of its status (`Bản vẽ, chưa code`, `Đã duyệt, chưa code`). The gallery only reads: the status is recorded in
   `design.json` by the lead or the lane (item 5), and no button of the gallery writes it.
9. **A screen not buildable yet is `pending`.** A screen that waits on data or an API often lives on a query state of a route the code really
   changes (`/premium?step=qr`, `/premium/result?state=expired`): it renders the page's own code, so the UI Audit would flag it for a change
   it cannot yet be built for. Its entry carries `"pending": { "reason": "<what it waits on>" }`:
   ```json
   "premium/qr-payment": { "status": "approved", "approvedAt": "2026-11-11T09:00:00+07:00", "board": "https://claude.ai/artifact/…", "pending": { "reason": "waits on the QR payment API" } }
   ```
   A pending screen is skipped by the local UI audit list (PROJECT-GALLERY-8 item 3), the gallery shows it as
   `Chờ: <reason>` (`pending: <reason>` in English) instead of hiding it, and it needs no folder in `gallery/pages` (the reason is the
   note). It is not a silent bypass: `reason` is required and non-empty, and only `drafted` or `approved` may carry it (a `built` page is judged like any
   other); every run lists each pending screen with its reason, and a pending screen whose shots exist in the work tree is nudged to drop `pending`
   (`HFS_APP_GALLERY_DESIGN_PENDING`, level info, never failing). A board section (PROJECT-GALLERY-9) carries the same `pending: { reason }`.

There is no finding for a screen without an approved design: a screen of a listed area with no entry, or only `drafted`, is built like any other.

**Enforced by** (R395, `packages/hfs/runtime/scripts/hfs/rules/gallery.mts`, `gallery-routes.mts` and `gallery-design.mts`, values from `ruleParams.gallery`):

- `HFS_APP_GALLERY_MISSING`: no `gallery/`, or one of its managed files is absent.
- `HFS_APP_GALLERY_SCREEN_FILE`: a screen folder holds a file or folder other than the three shots, `explain.md` and `links.json`
  (`before/` included), or a file sits outside a screen folder.
- `HFS_APP_GALLERY_EXPLAIN_MISSING`: a screen folder holds shots (in the work tree: the PNGs are never tracked) and no `explain.md`.
- `HFS_APP_GALLERY_LINKS`: a `links.json`, `flows.json` or `routes.json` is not the shape above, or names a screen folder or a route that
  does not exist.
- `HFS_APP_GALLERY_ROUTE_MISSING` (PROJECT-GALLERY-4; a tracker code of the failure catalog: info in `--env local`, never blocking, left out of `--env prod`): a `page.tsx` route
  of the front end has no screen folder whose `explain.md` `route` matches it and no reasoned exclusion in `gallery/routes.json`.
- `HFS_APP_GALLERY_FRONT_MATTER` (a warning): the front matter lacks `title`, `route` or `area`, or its `area` is not the
  folder's.
- `HFS_APP_GALLERY_DESIGN_MANIFEST` (PROJECT-GALLERY-6): `.starcistacks/canvas/design.json` is not JSON or not the shape of its item 4.
- `HFS_APP_GALLERY_DESIGN_PAGE_MISSING` (a tracker code: info in `--env local`, never blocking): a `built` or `matches` page has no `gallery/pages/<area>/<screen>/explain.md`.
- `HFS_APP_GALLERY_DESIGN_SHOT_MISSING` (a tracker code: info in `--env local`, never blocking): a `built` or `matches` page records no sha256 of its 1440 or 390 shot, or the work tree
  holds shots of the screen without one of those widths.
- `HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING` (`rules/gallery-design.mts`; not `localOnly`): a `matches` page whose `explain.md` has no non-empty section
  `## Phương án đã cân nhắc`. An error when the page's `matchedAt` is at or after `2026-11-18T00:00:00+07:00` (the release of this rule); for an older
  `matches` page, or one with no `matchedAt`, it is level `info` ("not final yet"): listed, never failing, so the owner fixes those gradually.
- `HFS_APP_GALLERY_DESIGN_PENDING` (level info, never failing): lists every `pending` screen with its reason, and nudges a pending screen that has a shot in the work tree to drop the mark (item 9). A pending with no reason, a malformed one, or one on a `built` or `matches` page is `HFS_APP_GALLERY_DESIGN_MANIFEST`.
- `HFS_APP_GALLERY_DESIGN_SHOT_STALE` (`localOnly`): a `drafted` or `approved` page still records `shots` (a record older than the design), or
  a 1440 or 390 shot in the work tree is not the sha the manifest records.

The shots are the author's work in every UI round; a reviewer compares the screens, and reads their explanation, in the gallery.

## PROJECT-GALLERY-7 A UI change goes board first, then code, then the gallery, then one review

Any change that a user can see on a screen (a new screen, a redesign, a fix round, a moved region, a changed copy or state) follows one order. The
drawing is where the owner decides how the app looks; the code copies the decision, the gallery is shot from the code, and one review judges the
whole gallery. An app with a design board (PROJECT-GALLERY-9) draws on the board; an app without one keeps its canvas (PROJECT-GALLERY-6) in the
same order until it adopts a board.

1. **Board first, no approval gate.** Draw or revise the app's board (`gallery/board`, the `design` op): one task per app or per board revision
   draws every screen it changes in every named state at 1440 and 390, from the Grammar's components and the app's tokens, raises `revision` and
   drops `approvedAt`. The owner may look at the revision on the board (the gallery's `#/board`) and fixes it later if needed; nothing waits for an approval
   (owner decision 2026-11-25), so the lead may set `approvedAt` (a full ISO timestamp with its zone) when the revision is settled, and the code lane starts at once. In an app
   with a canvas, the screen's page is drawn with `/claude-design` and set `drafted` (PROJECT-GALLERY-6 item 5).
2. **Then the code, copying the board.** The code lane builds the screens of the drawn revision, each state with the components its section
   draws; a section's `planned` mark goes once its route is coded. In an app with a canvas the same commit records the page's build in `design.json` (`built`).
2b. **Look on dev with real data.** Green gates and gallery shots from clean demo data prove nothing about the page the owner opens next, and
   the gallery (3) and review (4) wait for the owner's OK on dev (PROJECT-GALLERY-10), so this is the look between land and the owner. After the
   lane lands and the app's dev sync has run, open every screen the change reaches on the app's dev workspace with its real data (NIVO: the demo
   workspace Hiền Mai Spa; StarCi Next: real lesson content), at 1440 and 390, in every state the data can reach:
   `starci app look --env dev --paths <route,…>` (it signs in as the app's seed owner as `gallery/look.json` declares, shoots the running dev
   stack and never starts a server). Judge each shot with the existing lenses **tech-leak**, **truth** and **business** of PROJECT-GALLERY-8
   item 2, plus three checks: the rows of a list or card share one left edge; buttons are 40 (md) or 32 (sm), as
   [../ui/presentation.md](../ui/presentation.md) P7 and PHONE-1 say; every truncation is deliberate (an ellipsis on a long name, never a cut
   label, a clipped chip or a raw `key: value; …` string). Fix, land, sync and look again until it is clean. The shots and their `index.json`
   go in the lane's evidence bundle (`.starciwork/evidence/look/`, or `--out`) and are what the owner sees first. It is a process step held by
   the lane's report ([../authority/lanes.md](../authority/lanes.md) "Processes and cleanup"), not a blocking check.
3. **Then the gallery, shot from the code.** Every screen the change reaches (PROJECT-GALLERY-8 item 2) is shot at 1440 and 390 into
   `gallery/pages/<area>/<screen>/` with its `screen.yaml` (PROJECT-GALLERY-1 item 2, PROJECT-GALLERY-5); the shots are generated from the running
   code, never drawn.
4. **Finally one review of the whole gallery.** The drawing is a decision of direction, and grammar compliance alone is not enough: the screens
   must also be sensible UX, which only the render shows. So one review (the `inspect` op), by an agent other than the builder, runs the critique
   and the audit once over every screen the change reaches, comparing the shots, the gallery and the board, in two rounds that each span all of
   them:
   - **Round 1, the desktop compositions (1440).** Compare each with real products of the same archetype (a collection with Airtable, Notion,
     Shopify or Linear; a form, a detail, a dashboard each with their own): what they put in one row, what they leave out, where the action sits.
   - **Round 2, the 390 frames and the states.** Check the phone frames and the empty, loading and error states (and no-match, first-visit,
     editing where a page has them).
   Each round fills the ten lenses of every touched screen's `screen.yaml` audit (PROJECT-GALLERY-8 item 2); the fixes of a round land in the
   code and the shots are taken again before the next. When both rounds are done the board (or the canvas page) is synced to the code.
   **The record** is `considered` in each touched `screen.yaml` (`## Phương án đã cân nhắc` in an `explain.md` not migrated yet, and the canvas
   page's note): each option weighed, including the ones the builder and the drawing chose, with why it was chosen or rejected. An option that was
   not weighed is not a final screen. In an app with a canvas, only then does the reviewer move the page `built` → `matches`, setting `matchedAt`.
   The critic brief template is in [skills/claude-design/references/production.md](../../skills/claude-design/references/production.md#the-final-critique-another-agent-after-code).
   The owner gives feedback on the finished screens gradually, never all at once; a `matches` page from before this rule is listed as not final yet.
5. **Who is bound.** Every author of a UI change: a worker, a Kernel plan, the Supervisor and a person alike. A change that touches no visible
   region (a rename, a refactor, a type fix) needs no drawing.
6. **No design gate.** Nothing in `starci app check` couples a screen's code change to an approved canvas page, and the UI audit (PROJECT-GALLERY-8) is a local helper, never a gate (owner 2026-11-27); the concept rules and the final review of item 4 are what a UI change answers to.

## PROJECT-GALLERY-8 One file per screen, `screen.yaml`, audited until it first passes

A screen is described by one structured file. The UI audit of a screen (an agent other than its builder judging its shots through ten lenses) is an
optional **local UX/UI helper**, never a gate (owner 2026-11-27: "chạy nhưng mà chỉ check local và dùng cái đó để sửa ux ui sau này ở local"; the gallery
exists to TRACK screens). `--env local` lists every touched screen without a passed audit, every route without a screen and every built page without its
shots as info findings, a to-do list for later UX/UI work; nothing about an audit, a missing `screen.yaml` or a missing shot ever refuses a commit, a push,
a tag or a release. Concept rules (canon, the Grammar laws, package boundaries, a malformed `screen.yaml`) still block.

1. **`screen.yaml` is the screen's one file.** `gallery/pages/<area>/<screen>/screen.yaml` holds, in this order: `schema: 1`, `screen` (`<area>/<screen>`, the folder), `title`, `route`, `app` (optional: the front-end app, needed only when two apps serve the route),
   `area`, `summary` (one to three sentences), `code` (the source paths the screen is built from, relative to the front-end app's `src/`), `shots` (`"1440"` and `"390"`, each `{ file, sha256 }`,
   `sha256` null before the first shot; a state shot `<state>-<width>`, such as `empty-1440`, is a further key and a further PNG), `sections` (top to bottom as the user reads:
   `id` in kebab case, `title`, `why` required; `shows`, `actions`, `states` mapping a state to its text or null, `needsApi` listing the "cần API" items, and the optional `law` and `grammar` lines), `considered` (`option`, `chosen`, `why` of each option weighed) and `audit` (item 2; `null` for a screen not audited yet). The values are Vietnamese prose, the keys English.
   The folder holds `screen.yaml`, the shots and `links.json`.
   Design status is not here: it stays in `design.json` (PROJECT-GALLERY-6). A screen.yaml that is not this shape is `HFS_APP_GALLERY_SCREEN_INVALID`
   (R395: sections without a `why`, a screen or area that is not the folder's, a shot that is no width, a sha that is not a lowercase sha256). The gallery app renders the file: summary, code, sections,
   the options considered and the audit table (rounds by lenses).
2. **The UI audit (optional, local).** When the owner or a lane wants a screen judged, an agent other than its builder audits it until its first cycle passes (item 3). A screen is touched when the source of its route changed (the PROJECT-GALLERY-5 mapping), when a file its route's `page.tsx` reaches through value imports changed (`packages/hfs/cache/screen-reach.mts`, `symbol-diff.mts`, `catalog-reach.mts`: a shared composite, a hook, a module, a workspace package, the i18n keys its sources read; a barrel is transparent, a `renders: false` slot marks nothing), or when its audited screen.yaml changed. The audit holds
   `builder.agent`, `auditor.agent` (a different agent), `rounds` (each `n`, `at`, and the ten `lenses`: the seven core `order`, `layout`, `actionable`, `live`, `words`, `states`, `truth` and the three content lenses `business`, `hand-composed`, `tech-leak` (a round written before the content lenses holds the seven core ones and stays valid), each
   `{ verdict: pass | fixed | open, notes }`, notes required unless `pass`, `at` an ISO timestamp with its zone), `escalate`, and `baseline` (`{ at, rounds }`: the first pass, written by `starci audit run`, kept by every later cycle). The lenses ask: **order** what the user needs first comes first; **layout** grouping, hierarchy and the Grammar
   rules, with an explicit checklist read on the full-resolution crops of the first viewport and the header at 390 and 1440 (never on the shrunk full-page shot): control height 40 (an `sm` control only nested in an item or a dense toolbar, never in a header), no wrapped label, overflow goes to the menu (`TopBar fit`; ui/presentation.md PHONE-1..4; `DNA-COMMON-CONTROLS-PHONE-40`, `DNA-COMMON-HEADER-CONTROLS-40`, `DNA-COMMON-BUTTON-ONE-LINE`, `DNA-COMMON-HEADER-FIT-ONE-LINE`, `DNA-COMMON-HEADER-NO-OVERFLOW`); **actionable** every value shows how to change it; **live** running, done, waiting and failed are visible with an icon and motion; **words** no mixed English or raw ids, one term per concept; **states** empty,
   loading, error and no-permission at 1440 and 390; **truth** the data is real or marked "cần API"; **business** which of the 2-3 owner questions the screen's screen.yaml states each region answers, with no run counts, trigger kinds, provider keys, raw codes or step chains on a summary; **hand-composed** a known situation ([../ui/situations.md](../ui/situations.md)) built from primitives instead of its Grammar component (a summary card from Text and Stack, a hand-drawn status circle); **tech-leak** the audience rule of [../ui/content.md](../ui/content.md) (a business app renders no raw code, English engine text, internal id or jargon outside a collapsed "Chi tiết kỹ thuật"). The audit loops, each round running all ten lenses, until every lens of the last round is `pass` or `fixed`:
   at least 2 rounds, at most 4 a cycle. Still `open` after round 4 is written to `escalate` ("needs owner: <why>"). A screen looked at again after its round 4 (a fix, a reshoot)
   opens a new cycle with `starci audit cycle` (item 4); `audit run` past a cycle's round 4 records nothing, so a reshot image never inherits round 4's verdicts.
3. **A local to-do list, never a gate.** `starci app check --env local` (and `--gate uiaudit`) judges the touched screens only; every other screen is
   grandfathered and never read, and a screen `design.json` marks `pending` (PROJECT-GALLERY-6 item 9) is skipped and named on the summary line. A screen
   whose audit has passed once (`baseline`, or current rounds that pass) is never judged again. Its findings are the catalog's **tracker** codes
   (`tracker: true` in failure-codes.yaml, `check-env.mts` `trackedForEnv`): level `info` and report-only in `--env local`, left out entirely under
   `--env prod` (the pre-push hook on `main` and `dev`, CI, the release gate `app check --release`), where the step is not run at all. The `uiaudit`
   gate is report-only in every profile (a profile that names it blocking still only reports it), and an app may switch it off in `gates`. The codes:
   - `UI_AUDIT_MISSING`: a touched screen has `audit: null` or no screen.yaml;
   - `UI_AUDIT_STALE`: a shot's sha256 is not recorded or differs from the PNG on this machine, or the screen's code or text changed since the base and screen.yaml did not;
   - `UI_AUDIT_SELF_REVIEW`: the auditor is the builder;
   - `UI_AUDIT_ROUNDS_FEW`: fewer than 2 rounds;
   - `UI_AUDIT_OPEN`: a lens is open in the last round (before round 4);
   - `UI_AUDIT_NEEDS_OWNER`: a lens is still open in round 4 of the first cycle: fix and open the next cycle with `starci audit cycle`, or the owner decides;
   - `UI_AUDIT_CONSIDERED_EMPTY`: `considered` is empty.

   `HFS_APP_GALLERY_ROUTE_MISSING` (a route with no screen), `HFS_APP_GALLERY_DESIGN_PAGE_MISSING` and `HFS_APP_GALLERY_DESIGN_SHOT_MISSING` are tracker
   codes too. A malformed audit block (a lens missing from a round, a verdict outside the three, notes missing, rounds not numbered 1.., an `at` that is not ISO with its zone, a bad `baseline`) is
   `HFS_APP_GALLERY_SCREEN_INVALID`, judged for every screen in the hfs family, and still blocks: it is a broken file, not a missing audit.
4. **`starci audit run <area>/<screen> [--builder <agent>] [--auditor <agent>] [--out <brief.md>]`** prepares a round: it takes the sha256 of `1440.png` and `390.png`, writes the next round into screen.yaml as seven
   open lenses, writes full-resolution CROPS beside the shots (`1440-first.png`, `1440-header.png`, `390-first.png`, `390-header.png`: the first viewport and the header region, cut at the shot's own pixel density, never scaled; a screen folder may hold them) and prints the brief an auditor agent reads (the crops first, then the shots at full size, the seven lenses with the layout lens's checklist, the laws: PROJECT-GALLERY-7, the DNA laws of the Grammar contract, ui-on-grammar, the owner rules).
   **The harness never calls a model.** The auditor is a separate agent (a subagent or another lane) given the brief; it fills the round, the builder fixes and shoots again, and `run` opens the next round.
   `starci audit cycle <area>/<screen> --reason <why>` closes the current cycle into `considered` (one chosen entry: the reason, the rounds and their dates, the last verdict of each lens,
   builder and auditor; the rounds stay in git history) and starts an empty audit, so the next `starci audit run` prepares round 1 of the new cycle.
   `starci audit status [--json]` lists the screens with an audit missing, pending, open, stale or past its round 4.
5. **When an audit is wanted** (a UX/UI pass the owner asks for, or the lane's own choice; never required to land or release): shoot every touched
   screen (1440 and 390) → `starci audit run` on each → the reviewer fills the round of all of them → the builder fixes → shoot → the next round, until
   round 2 or later has no open lens. Its record of options is `considered`.

**Enforced by** `packages/hfs/cache/uiaudit-family.mts` and `runtime/scripts/hfs/screen-yaml.mts` (the local UI audit list, never blocking: `check-env.mts` `trackedForEnv`; the schema, the round skeleton, the baseline and the new cycle), `rules/gallery.mts` (`HFS_APP_GALLERY_SCREEN_INVALID`), `uiaudit/cli.mts` (`starci audit run|cycle|status`, `starci gallery`).

## PROJECT-GALLERY-9 One design board per app, drawn once from the Grammar

The board is the app's one drawing: every screen of the app, in every named state, at 1440 and 390, composed only of the app's Grammar and
its tokens, so that what the owner looks at is already what the code renders. The code copies it (PROJECT-GALLERY-7 item 2); the gallery's
shots come from the code.

1. **Where it lives.** `gallery/board/` (slot `app.gallery-board`), committed:
   ```
   gallery/board/
     board.yaml                    the record (item 2)
     <area>/<screen>.tsx           one module per section: its default export draws the screen in the state it is given
   ```
   A section module imports the Grammar (`@starci/grammar/core` or the app's grammar) and nothing of the app's `fe/`: no feature component, no
   class of its own, data written in the module as the screen really shows it. A missing Grammar capability is marked "cần Grammar" and drawn
   with what exists, never invented.
2. **The record.** `board.yaml`:
   ```yaml
   schema: 1
   revision: 3                            # raised by every change the owner reviews
   approvedAt: null                       # optional: when the revision is settled, a full ISO timestamp with its zone; gates nothing
   tokens: [fe/apps/web/src/modules/brand/brand.css]   # app-root relative stylesheets, loaded after the Grammar's
   sections:
     - id: customers/list                 # the gallery screen id it becomes: gallery/pages/customers/list/screen.yaml
       title: Khách hàng
       route: /customers                  # the route it becomes
       states: [default, empty, loading, error]   # default first; the suffixes of PROJECT-GALLERY-6 item 2, or the screen's own
       needsApi: [customers.list]         # "cần API" marks, built with the page
     - id: customers/import
       title: Nhập khách hàng
       route: /customers/import
       planned: true                      # drawn, not coded yet
   ```
   Approval is the revision's, set only from the owner's words, by the lead; a new revision drops it.
3. **How it renders.** The gallery app shows it as the view "Board" (`#/board`): sections area by area, each with its route, the screen.yaml it
   becomes, its "cần API" and planned marks and a link to its gallery screen, and each state as two frames, 1440 and 390, side by side at one
   scale. A frame is a page of its own (`/__board/frame.html`), so a 390 frame is a 390 viewport and the Grammar's responsive rules see the real
   width. The board renders in the gallery's dev server (`starci app stack up`, the gallery port). **Known gap**: `vite build` of the gallery
   leaves the board out, so a static export of the gallery holds no board.
4. **Coverage.** Every coded route has a section, and every section has a coded route or is marked `planned`; a coded route excluded in
   `gallery/routes.json` needs none. A section for a state of a coded route that waits on data or an API (`/premium?step=qr`) carries `pending: { reason: <what it waits on> }`
   (the same record as PROJECT-GALLERY-6 item 9; the reason is required and non-empty) and is then neither unmapped nor "planned while coded"; the gallery shows it as `pending: <reason>`.
5. **Review copy for the owner.** The repository board is the source. A Claude Artifact of it is a review copy for the owner's comments only:
   open `#/board`, take its 1440 and 390 frames at full size and publish them with the revision number; a comment returns as a new revision,
   never as an edit of the copy.

**Enforced by** (R395, `rules/gallery-board.mts`; only where `gallery/board/board.yaml` exists):

- `HFS_APP_GALLERY_BOARD_INVALID`: the record is not YAML or not the shape of item 2 (unknown keys, a section id that is no `<area>/<screen>`,
  states not starting with `default`, a token file that does not exist), or a section has no module `gallery/board/<area>/<screen>.tsx`.
- `HFS_APP_GALLERY_BOARD_ROUTE_MISSING` (`localOnly`): a `page.tsx` route of the front end (PROJECT-GALLERY-4 item 1) has no section whose
  `route` matches it and no reasoned exclusion in `gallery/routes.json`.
- `HFS_APP_GALLERY_BOARD_SECTION_UNMAPPED` (`localOnly`): a section's `route` is no route of the front end and the section is not `planned`,
  or it is `planned` while its route is coded.

**Known gap**: the gate reads the record and the files, never the render: that a section module imports only the Grammar, and that the
code matches its section, is held by the `design` op's `anchors-cited` and by the one review of PROJECT-GALLERY-7 item 4. A board revision's `approvedAt` gates no code change.

## PROJECT-GALLERY-10 A screen's lane brief maps it to the Grammar first, and its screen.yaml waits for the owner's OK

A screen is approved by its look, slowly, and the brief that builds it names the Grammar before any code.

1. **Before any UI code, the lane brief lists the screen's questions and its component map.** The brief that starts a UI lane states the 2 or
   3 owner questions the screen answers (the same `questions` its `screen.yaml` will carry; [../ui/content.md](../ui/content.md) CONTENT-1)
   and a map of every element on the screen to the Grammar component that draws it ("the agent's summary → `EntitySummaryCard`", "the run's
   steps → `Timeline` with `status`", "who is on it → `AvatarGroup`"), read from [../ui/situations.md](../ui/situations.md). An element with no
   component is not composed from primitives in the app: it goes to Grammar first, as its own lane, and the screen lane waits for it.
2. **The order of a screen.** land → dev test → a QA polish pass → the owner's OK on the look → `screen.yaml`. The `screen.yaml` (and its
   audit) is written only AFTER the owner approves the screen as it renders ("screen phải duyệt kĩ"); a `screen.yaml` written before that
   is a draft the lane redoes once the owner has looked. The first audit cycle (PROJECT-GALLERY-8) then runs on the approved shots.
3. **What the audit adds.** The three content lenses of PROJECT-GALLERY-8 item 2 judge what the brief promised: **business** (each region
   answers one of the questions, no tech on a summary), **hand-composed** (no known situation built from primitives, no hand-drawn status
   circle) and **tech-leak** (the app's `audience` rule).

**Enforced by** review (the lane brief and the owner's OK are words, not files a check reads); the content lenses are part of the audit
block `starci audit run` writes, judged against the concept of [../ui/content.md](../ui/content.md), with no word list.

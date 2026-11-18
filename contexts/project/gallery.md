# The screenshot gallery of an app

Every app source repository carries a screenshot gallery at `gallery/`: the one place where the shots of every screen and the
explanation of why each region is drawn that way are kept and looked at. This file owns the rule; every other page links to it.

```
gallery/
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
   the rest of a new app, and a hand edit is `HFS_MANAGED_FILE_DRIFT`. The lockfile `gallery/package-lock.json` is the app's. **One truth since hfs 6.13.33: the thin gallery has no `gallery/src`.** Sync never writes it, `app.gallery` and `HFS_APP_GALLERY_MISSING` never demand it, and `starci app sync --execute` deletes the three managed files (`main.js`, `explain.js`, `style.css`) an earlier render left there; a gallery that demands `gallery/src` or a sync that writes it is an older CLI than the app pins (`HFS_CLI_HFS_SKEW`, [cli/README.md](../../cli/README.md#the-starci-cli)).
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
6. **A new app and an existing one.** A new app has the gallery from its scaffold. An existing app gets it from the next
   `starci app sync --execute` after the release that carries this rule, then installs once (`npm install` in `gallery/`, or
   `starci app stack up`) and commits `gallery/` with its lockfile. An app that declares no `local.basePort` declares one first
   (PROJECT-STACKS-10): the gallery port derives from it. An app whose shots still sit in the earlier `gallery/shots/<area>/`
   layout moves each `<page>__<width>__after.png` to `pages/<area>/<page>/<width>.png`, drops every `__before` shot and every
   width other than the two, and writes the screen's `explain.md`.
7. **Its language is the app's.** The managed files render their words (the title and the README, and the `locale` that `vite.config.js`
   hands to `@starci/gallery`, which draws the search box, the empty state, the bug labels, the tabs and the status names) in the app's default locale: the `DEFAULT_LOCALE` its i18n routing source declares
   (`fe/packages/<project>-i18n/src/routing.ts` of a full app, `fe/apps/<app>/src/modules/i18n/routing.ts` of a lite one). `vi`
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

1. **The rule.** Every user-facing route of the app's front end has at least one screen folder in `gallery/pages/` whose `explain.md`
   front matter `route` matches it. A route is a Next app router `page.tsx` under `fe/apps/<app>/src/app` (the slot `fe.route`, the
   same shape in both editions). Its pattern is its folder path without the `[locale]` prefix and the `(group)` folders:
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

1. **The rule.** A change to a screen's source that leaves that screen's `explain.md` untouched is `HFS_APP_GALLERY_EXPLAIN_STALE`.
   The source of a screen is best-effort mapped: the route's `page.tsx` and every file under the feature folder `features/pages/<Name>/`
   the page imports (a thin page imports exactly one feature; a component a feature takes from `components/` is not followed). A
   route with several screen folders is current when any of their `explain.md` files is touched.
2. **What is judged.** `starci app check` (a whole run) judges the files the commits since the base, the index and the work tree
   change: the base is the merge-base of `HEAD` with `STARCI_BASE_REF`, else with `origin/<branch>`, else `HEAD^` (the base the lint
   ratchet uses). The pre-commit guard (`starci app check --staged`) lists the same finding for the staged files and never blocks
   the commit.
3. **Severity.** A warning in `--env local`, an error in `--env prod`, as item 4 of PROJECT-GALLERY-4. An excluded route and a route
   with no screen have nothing to keep current (the second is `HFS_APP_GALLERY_ROUTE_MISSING`).
4. **Keeping it current.** Re-read each region of the screen against the new source, rewrite the `Vì sao`, `Luật` and `Grammar` lines
   that changed (a fix that changes no visible region still opens `explain.md` and confirms it), and re-shoot the shots (PROJECT-GALLERY-1).

## PROJECT-GALLERY-6 An area can be drawn before code: the design canvas mirrors the gallery and records each screen's approval

The design pass (`/claude-design`; [skills/claude-design/SKILL.md](../../skills/claude-design/SKILL.md) owns how it is drawn and produced) is
the gallery drawn before code: it takes the business of an existing or planned page and draws its best UX on the app's Grammar, for the owner
to approve before the page is coded. This rule owns where the canvas lives, how it maps onto the gallery, the lifecycle of a screen and what
the gate judges.

1. **The canvas lives in the app.** `.starcistacks/canvas/` at the app root (slot `app.starcistacks.canvas`, both editions; a reserved folder,
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
       "customers/list": { "status": "matches", "approvedAt": "2026-11-17T09:30:00+07:00", "board": "https://claude.ai/artifact/…",
                           "shots": { "1440": "<sha256>", "390": "<sha256>" } }
     }
   }
   ```
   `areas` lists the areas whose screens are designed before code; every page id is in one of them. `board` is the https link of the published
   board. `approvedAt` (a full ISO timestamp with its zone, never a bare date) is set from `approved` on and absent before. `shots` holds the lowercase sha256 of the 1440 and 390 PNGs
   from `built` on and is absent before. No other key.
5. **The lifecycle, and who sets each status.**
   - `drafted`: the lead, when the screen is drawn on the board. A redraw of an approved screen returns it to `drafted` and drops `approvedAt` and
     `shots`.
   - `approved`: the lead, only when the owner said the page is approved ("đẹp") in the owner's own words; no other word approves. It sets
     `approvedAt` and drops any `shots`. The lead adds an area to `areas` once its screens are approved.
   - `built`: the code lane that builds the screen: it codes the page (with every `cần API` operation of its notes), saves the screen's shots in
     `gallery/pages/<area>/<screen>/` at 1440 and 390, copies the approved note as its `explain.md`, and records the sha256 of the 1440 and
     390 PNGs.
   - `matches`: the lead or a reviewer, never the lane that built it, after comparing the shots with the approved frames; it records the sha256 of
     the shots it compared.
6. **How the order is judged.** The shots are never tracked (PROJECT-GALLERY-1 item 5) and file times mean nothing in a fresh checkout, so a
   shot's age is read neither from the disk nor from git. The manifest carries the order: an approval drops the shot record, so a sha recorded on
   a page is by construction taken after its latest approval, and a shot record on a page that is only drafted or approved is older than the
   approval. Where the work tree holds the PNGs (the author's machine, the push hook), each is hashed and must equal the recorded sha; a fresh
   checkout judges the record alone.
7. **Severity.** A manifest that is not this shape is an error. The other findings are warnings in `--env local` and errors in `--env prod`, as
   item 4 of PROJECT-GALLERY-4.

8. **The gallery is where the canvas is reviewed too.** Every page of the canvas shows in the gallery's tree, drafted or approved and not coded yet, with
   no `gallery/pages` folder needed: its frames at 1440 and 390 and its note (what the board shows on claude.ai; whoever does not open the board there reads
   it here) with the chip of its status (`Bản vẽ, chờ duyệt`, `Đã duyệt, chưa code`). The gallery only reads: approval is the owner's word recorded in
   `design.json` by the lead (item 5), and no button of the gallery writes it.

**Enforced by** (R395, `packages/hfs/runtime/scripts/hfs/rules/gallery.mts`, `gallery-routes.mts` and `gallery-design.mts`, values from `ruleParams.gallery`):

- `HFS_APP_GALLERY_MISSING`: no `gallery/`, or one of its managed files is absent.
- `HFS_APP_GALLERY_SCRIPT`: `gallery/package.json` has no `dev` script of the form `vite --port <base + 50> --strictPort`, or the
  app declares no `local.basePort` to derive the port from.
- `HFS_APP_GALLERY_VITE_UNPINNED`: `vite` is absent or not an exact version.
- `HFS_APP_GALLERY_SHOTS_TRACKED`: `gallery/pages/**/*.png` is not git-ignored, or a shot PNG is tracked.
- `HFS_APP_GALLERY_SCREEN_FILE`: a screen folder holds a file or folder other than the three shots, `explain.md` and `links.json`
  (`before/` included), or a file sits outside a screen folder.
- `HFS_APP_GALLERY_EXPLAIN_MISSING`: a screen folder holds shots (in the work tree: the PNGs are never tracked) and no `explain.md`.
- `HFS_APP_GALLERY_REGION_INCOMPLETE`: an `explain.md` has no region, or a region lacks a `Vì sao` or a `Grammar` value.
- `HFS_APP_GALLERY_REGION_UNCLEAR`: a region says `CHƯA RÕ` or `SAI`. It is a warning in `--env local` (reported, not blocking, so a
  round in progress can name what it has not fixed yet) and an error in `--env prod` (the push hook, CI, the release gate;
  [check-cache.md](check-cache.md) owns the two environments, and the code is `localOnly` in the failure catalog).
- `HFS_APP_GALLERY_LINKS`: a `links.json`, `flows.json` or `routes.json` is not the shape above, or names a screen folder or a route that
  does not exist.
- `HFS_APP_GALLERY_ROUTE_MISSING` (PROJECT-GALLERY-4; `localOnly` in the failure catalog, so a warning in `--env local`): a `page.tsx` route
  of the front end has no screen folder whose `explain.md` `route` matches it and no reasoned exclusion in `gallery/routes.json`.
- `HFS_APP_GALLERY_EXPLAIN_STALE` (PROJECT-GALLERY-5, `rules/gallery-coupling.mts`, run by `starci app check` over the commits since the base and
  by `starci app check --staged`, which only lists it; `localOnly`): a screen's source changed and its `explain.md` did not.
- `HFS_APP_GALLERY_FRONT_MATTER` (a warning): the front matter lacks `title`, `route` or `area`, or its `area` is not the
  folder's.
- `HFS_APP_GALLERY_DESIGN_MANIFEST` (PROJECT-GALLERY-6): `.starcistacks/canvas/design.json` is not JSON or not the shape of its item 4.
- `HFS_APP_GALLERY_DESIGN_PAGE_MISSING` (`localOnly`): a `built` or `matches` page has no `gallery/pages/<area>/<screen>/explain.md`.
- `HFS_APP_GALLERY_DESIGN_UNAPPROVED` (`localOnly`): a screen (an `explain.md` or a shot) of an area listed in `areas` has no design entry or
  only a `drafted` one.
- `HFS_APP_GALLERY_DESIGN_SHOT_MISSING` (`localOnly`): a `built` or `matches` page records no sha256 of its 1440 or 390 shot, or the work tree
  holds shots of the screen without one of those widths.
- `HFS_APP_GALLERY_DESIGN_SHOT_STALE` (`localOnly`): a `drafted` or `approved` page still records `shots` (a record older than the approval), or
  a 1440 or 390 shot in the work tree is not the sha the manifest records.

The shots are the author's work in every UI round; a reviewer compares the screens, and reads their explanation, in the gallery.

## PROJECT-GALLERY-7 A UI change goes canvas first, then code, then gallery

Any change that a user can see on a screen (a new screen, a redesign, a fix round, a moved region, a changed copy or state) follows one order. The
canvas of PROJECT-GALLERY-6 is where the owner decides how the screen looks; the code follows the decision, and the gallery proves it matches.

1. **Canvas first.** Update the screen's page in the app's `.starcistacks/canvas/`: draw or adjust its frames and its concept note with
   `/claude-design` ([skills/claude-design/SKILL.md](../../skills/claude-design/SKILL.md)), set the page `drafted` in `design.json` and publish the
   board. The owner approves it in the owner's own words; only then does the lead set the page `approved` with a new `approvedAt` (PROJECT-GALLERY-6
   item 5). A change to a screen the canvas does not hold yet starts by adding its page and its area to `design.json`.
2. **Then the code.** The code lane builds the approved page, and the same commit records the page's build in `design.json` (PROJECT-GALLERY-6
   item 5, `built`). Code written before the approval is a draft: it is redone from the approved frames, never approved after the fact.
3. **Finally the gallery.** Shoot the screen (PROJECT-GALLERY-1 item 2), copy the approved note as `explain.md` (PROJECT-GALLERY-5), then a reviewer
   moves the page `built` → `matches` after comparing the shots with the approved frames.
4. **Who is bound.** Every author of a UI change: a worker, a Kernel plan, the Supervisor and a person alike. A change that touches no visible
   region (a rename, a refactor, a type fix) needs no canvas page.
5. **Canvas-managed.** A screen is canvas-managed when its area is in `areas` of `design.json` or one of its pages is in `pages`. An app with no
   `design.json`, and a screen of an area it does not list, is outside this rule until its first page is drawn.

**Enforced by** (R395, `rules/gallery-coupling.mts`, run by `starci app check` and, listing only, by the commit guard):

- `HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED` (`localOnly`: a warning in `--env local`, an error in `--env prod`, as item 4 of PROJECT-GALLERY-4; the
  commit guard lists it and never blocks): the source of a canvas-managed screen changed (the same screen to source map and the same judged set as
  `HFS_APP_GALLERY_EXPLAIN_STALE` of PROJECT-GALLERY-5: the commits since the base, the index and the work tree) and the screen's page in
  `design.json` is missing, `drafted`, or `approved` with an `approvedAt` earlier than the newest change of that screen's source. The time of a
  change is the committer time of the newest commit since the base that touched its source files; a change not yet committed counts as now. The change
  passes when the page's entry in `design.json` also differs from the base's (a fresh `approvedAt`, or the build recorded with its shots), which is how
  an approved page is built in one change. A route with several screen folders needs every one of its canvas-managed screens to pass.
  The rule judges code against the canvas, so a screen with no `explain.md` has no mapped source and is not judged here (`HFS_APP_GALLERY_ROUTE_MISSING` is its finding).
  It is not `HFS_APP_GALLERY_DESIGN_UNAPPROVED`, which judges a screen existing in a designed area, not a change.

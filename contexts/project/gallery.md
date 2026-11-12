# The screenshot gallery of an app

Every app source repository carries a screenshot gallery at `gallery/`: the one place where the shots of every screen and the
explanation of why each region is drawn that way are kept and looked at. This file owns the rule; every other page links to it.

```
gallery/
  pages/<area>/<screen>/     one folder = one screen (one agent, one state)
    1440.png  1920.png  390.png    the shots; only these width names
    explain.md                     required when any png exists
    links.json                     optional navigation hotspots
  flows.json                       optional named flows (ordered screen ids)
```

## PROJECT-GALLERY-1 Every app carries a gallery, and every UI fix round saves shots to it

1. **What it is.** `gallery/` is a standalone Vite app at the app root, beside `be/` and `fe/`, outside the npm workspaces. It
   reads `gallery/pages/**` and `gallery/flows.json` with `import.meta.glob` and shows each screen's shots beside its explanation
   (PROJECT-GALLERY-2) and a flow map of the screens (PROJECT-GALLERY-3). Its files are managed: `starci app sync --execute`
   renders them (slot `app.gallery`, templates in `packages/hfs/templates/app/gallery`), `starci app scaffold` writes them with
   the rest of a new app, and a hand edit is `HFS_MANAGED_FILE_DRIFT`. The lockfile `gallery/package-lock.json` is the app's.
2. **What goes in it.** Every round that changes a screen (a UI fix, a redesign, a new screen) saves the shots of every screen it
   touches at widths 1440 and 1920 (desktop) and 390 (phone), the whole screen, and updates that screen's `explain.md`. A round
   that touches no screen saves none. The gallery holds the current state only: a before and after comparison belongs in the
   fix report, never in the gallery.
3. **The layout.** One folder per screen: `gallery/pages/<area>/<screen>/`. `<area>` is the product area (a kebab-case folder,
   usually the route group), `<screen>` a kebab-case name of one agent in one state. The folder holds exactly `1440.png`,
   `1920.png`, `390.png` (any of them may be absent), `explain.md` and optionally `links.json`. Every other file and every
   subfolder is `HFS_APP_GALLERY_SCREEN_FILE`, a `before/` folder included: a state (`today-menu-open`) or an agent variant
   (`today-sales`) is its own screen folder, so `1440-open.png` and `sales-1440.png` never exist. A file straight in `pages/` or in
   an area folder is outside a screen folder. Example: `gallery/pages/inbox/today/1440.png`.
4. **Where it serves.** On the app's base port plus 50 (`ruleParams.gallery.portOffset` of [hfs/slots.yaml](../hfs/slots.yaml)),
   so `local.basePort` 3100 serves the gallery on 3150 and 3000 on 3050 ([stacks.md](stacks.md) PROJECT-STACKS-10 owns the role
   table of the ports around it). `starci app stack up --env dev` starts it next to the other native processes, installs its
   dependencies once, waits for it to answer and records it with them; `stack down` stops it. An environment that declares its own
   process named `gallery` keeps it.
5. **The PNGs are never committed.** They are local evidence of a round, ignored by the managed `.gitignore` block
   (`gallery/pages/**/*.png`); the gallery app, every `explain.md`, every `links.json` and `flows.json` are source and are committed.
6. **A new app and an existing one.** A new app has the gallery from its scaffold. An existing app gets it from the next
   `starci app sync --execute` after the release that carries this rule, then installs once (`npm install` in `gallery/`, or
   `starci app stack up`) and commits `gallery/` with its lockfile. An app that declares no `local.basePort` declares one first
   (PROJECT-STACKS-10): the gallery port derives from it. An app whose shots still sit in the earlier `gallery/shots/<area>/`
   layout moves each `<page>__<width>__after.png` to `pages/<area>/<page>/<width>.png`, drops every `__before` shot and every
   width other than the three, and writes the screen's `explain.md`.
7. **Its language is the app's.** The managed files render their words (search box, the empty state, the bug labels, the tabs, the
   title and the README) in the app's default locale: the `DEFAULT_LOCALE` its i18n routing source declares
   (`fe/packages/<project>-i18n/src/routing.ts` of a full app, `fe/apps/<app>/src/modules/i18n/routing.ts` of a lite one). `vi`
   and `en` have a table (`GALLERY_LABELS` in `packages/hfs/runtime/scripts/hfs/gallery.mts`); any other locale, or none
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
   `explain.md`, which the gate fails. The reader is `gallery/src/explain.js`, the same logic as the gate's.
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

**Enforced by** (R395, `packages/hfs/runtime/scripts/hfs/rules/gallery.mts`, values from `ruleParams.gallery`):

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
- `HFS_APP_GALLERY_LINKS`: a `links.json` or `flows.json` is not the shape above, or names a screen folder that does not exist.
- `HFS_APP_GALLERY_FRONT_MATTER` (a warning): the front matter lacks `title`, `route` or `area`, or its `area` is not the
  folder's.

The shots are the author's work in every UI round; a reviewer compares the screens, and reads their explanation, in the gallery.

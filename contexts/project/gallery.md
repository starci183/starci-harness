# The screenshot gallery of an app

Every app source repository carries a screenshot gallery at `gallery/`: the one place where the before and after of every
user-interface change is kept and looked at. This file owns the rule; every other page links to it.

## PROJECT-GALLERY-1 Every app carries a gallery, and every UI fix round saves shots to it

1. **What it is.** `gallery/` is a standalone Vite app at the app root, beside `be/` and `fe/`, outside the npm workspaces. It
   reads `gallery/shots/**/*.png` with `import.meta.glob` and shows them by area and page, side by side, before and after.
   Its files are managed: `starci app sync --execute` renders them (slot `app.gallery`, templates in
   `packages/hfs/templates/app/gallery`), `starci app scaffold` writes them with the rest of a new app, and a hand edit is
   `HFS_MANAGED_FILE_DRIFT`. The lockfile `gallery/package-lock.json` is the app's.
2. **What goes in it.** Every round that changes a page (a UI fix, a redesign, a new screen) saves one shot per page and width,
   before the change and after it: width 1440 (desktop) and 390 (phone), the whole page. A round that touches no page saves none.
3. **The name.** `gallery/shots/<area>/<page>__<width>__<before|after>.png`: `<area>` the product area (a kebab-case folder,
   usually the route group), `<page>` a kebab-case page or state name, `<width>` the pixel width (`1440` or `390`), the stage
   `before` or `after`. Example: `gallery/shots/inbox/today__1440__after.png`. The gallery groups a page's shots by this name, so
   a shot outside it still shows but is not paired.
4. **Where it serves.** On the app's base port plus 50 (`ruleParams.gallery.portOffset` of [hfs/slots.yaml](../hfs/slots.yaml)),
   so `local.basePort` 3100 serves the gallery on 3150 and 3000 on 3050 ([stacks.md](stacks.md) PROJECT-STACKS-10 owns the role
   table of the ports around it). `starci app stack up --env dev` starts it next to the other native processes, installs its
   dependencies once, waits for it to answer and records it with them; `stack down` stops it. An environment that declares its own
   process named `gallery` keeps it.
5. **The PNGs are never committed.** They are local evidence of a round, ignored by the managed `.gitignore` block
   (`gallery/shots/**/*.png`); the gallery app is source.
6. **A new app and an existing one.** A new app has the gallery from its scaffold. An existing app gets it from the next
   `starci app sync --execute` after the release that carries this rule, then installs once (`npm install` in `gallery/`, or
   `starci app stack up`) and commits `gallery/` with its lockfile. An app that declares no `local.basePort` declares one first
   (PROJECT-STACKS-10): the gallery port derives from it.

**Enforced by** (R395, `packages/hfs/runtime/scripts/hfs/rules/gallery.mts`, values from `ruleParams.gallery`):

- `HFS_APP_GALLERY_MISSING`: no `gallery/`, or one of its managed files is absent.
- `HFS_APP_GALLERY_SCRIPT`: `gallery/package.json` has no `dev` script of the form `vite --port <base + 50> --strictPort`, or the
  app declares no `local.basePort` to derive the port from.
- `HFS_APP_GALLERY_VITE_UNPINNED`: `vite` is absent or not an exact version.
- `HFS_APP_GALLERY_SHOTS_TRACKED`: `gallery/shots/**/*.png` is not git-ignored, or a shot PNG is tracked.

Taking the shots is the author's work in every UI round; a reviewer compares before and after in the gallery.

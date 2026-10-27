# StarCi Harness app

A desktop app (Tauri 2, Windows and macOS) to watch and steer StarCi harness workflows: an overview of projects, provider
quota and workflows, each workflow's graph, each task's contract, checks and route, the owner's inbox of decisions, and the
harness settings. It is React + TypeScript + Vite on the StarCi Grammar (`@starci/grammar`, family `core`, HeroUI
anatomy); screens compose Grammar components and write layout CSS only.

The app holds no state of its own. It reads and writes through `starci ui`, a server inside the harness CLI, over the
contract in [`cli/src/core/ui/contract.ts`](../cli/src/core/ui/contract.ts), imported as `@contract` (types only); every write
goes through a harness verb, so gates and roles hold as if typed by hand.

## Develop

Node 22 or newer. The app installs the Grammar from [`packages/grammar`](../packages/grammar) as a copy (`install-links` in
`.npmrc`), so build it first and reinstall after a Grammar change.

```sh
(cd ../packages/grammar && npm ci && npm run build)
npm install
starci ui            # in the harness: prints http://127.0.0.1:<port>/?token=<token>
npm run dev          # http://localhost:1420
```

The dev server proxies `/api` to `http://127.0.0.1:4317`; point it elsewhere with `STARCI_UI_URL` (the printed URL works
as is). Open `http://localhost:1420/?token=<token>` once, or paste the printed URL into the connect screen; the
connection is kept in `localStorage`. A refused token brings the connect screen back.

Routes: `#/` overview, `#/w/:project/:workflow`, `#/t/:project/:task`, `#/inbox`, `#/settings`. Live updates arrive on
`/api/events` (Server-Sent Events) and refresh only the views they name.

## Source layout: the shape–slot pattern on Vite

The app follows the front-end canon it enforces on products ([contexts/code/fe](../contexts/code/fe/README.md), decisions
F-1/F-2 in [open-core.md](../contexts/decisions/open-core.md)). The canon is written for Next.js; on Vite with
react-router the same tiers map like this:

| Canon (Next)                         | Here (Vite + react-router)                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `app/**/page.tsx`, route adapters    | `src/app/router.tsx`: the hash route table, each route mounting one page owner of `features/pages`                  |
| `app/[locale]/providers.tsx`         | `src/app/providers.tsx`: React Aria locale, Grammar root, connection, the session gate and TanStack Query          |
| `app/[locale]/layout.tsx` → layout   | the root route's session gate mounts `features/layouts/WorkspaceLayout`, whose `<Outlet />` is the page             |
| `notFound()` in the page owner       | a 404 read is the region's empty sentence (`slotOfQuery`); an unknown path falls back to the overview route         |
| `useQuery<X>Swr` + `slotOfSwr`       | TanStack Query hooks in `hooks/query` folded by `slotOfQuery` (`hooks/slot/slot.shared.ts`)                         |
| next-intl catalog `messages/<l>.json`| `modules/i18n/labels.ts`, the one typed copy owner (Vietnamese only); templates use `{name}` tokens                |

Imports point down only: `app` → `features/{pages,layouts}` → `components/blocks` → `components/composites`
(`SlotView`, `DecisionBody`, `ListEditor`, `ConfigField`) → `components/leaves` (`StatusWord`, `KeyList`); hooks reach
`modules/api` only through `hooks/query`.

Every data region is a block in `components/blocks/<X>/`: `index.tsx` is the connected `X` (it calls the query and
command hooks, folds each read into a `DataSlot` with `slotOfQuery`/`mapSlot`, resolves every label and action) and
`component.tsx` is the pure `XBase({ shape?, props, on })` of atoms. Each read renders through the one `SlotView`:
loading draws the ready tree from a same-shape placeholder with `isSkeleton` (or `isLoading` on Grammar collections);
forbidden hides or says so; error shows the region's notice with a retry of that read; empty shows the region's
sentence. Only a block with more than one drawn shape takes `shape` (`WorkflowHeaderShape`, `InboxDetailShape`), and
while its read waits the shape follows the placeholder; there is no `xDefaultState`.

Pages and the layout read no data: a page owner adapts route params to atoms (`WorkflowPage`, `TaskPage`) or holds the
UI state its blocks share (`InboxPage`: the selection and the last ruling's outcome); the layout keeps the one live
event stream open. Grammar parts without a skeleton flag (`StatusDot`, `Code`, `Terminal`, `RadioGroup`) rest inside a
skeleton `Text` line or draw the placeholder's blank values in their own frame.

Stories live in `stories/blocks/` and draw the pure halves: one story per shape member and one `Loading` story per
block, each with `parameters: { dna: { pair: "<Block>", phase: "ready" | "loading" } }`. `npm run storybook`,
`npm run build-storybook`.

## Fixtures mode

`http://localhost:1420/?fixtures=1` runs the whole app on the sample data in `src/modules/api/fixtures.ts`, with no
server: reads answer from the fixtures, writes answer "accepted" and change nothing. The mode lasts for the browser
session; `?fixtures=0` leaves it. The connect screen's "Xem bằng dữ liệu mẫu" opens the same mode. `VITE_FIXTURES=1 npm
run build` bakes it into a build. To look at the loading layout, `&hold=1` keeps every fixture read pending
(`&hold=overview,task` only those), and `&delay=1500` answers them that late. `docs/screens/<route>-ready.png` and
`<route>-loading.png` are the five routes at 1440x960 in both phases.

## Desktop build

Needs the Rust toolchain and the Tauri prerequisites of your OS.

```sh
npm run desktop:dev      # Tauri window over the Vite dev server
npm run desktop:build    # bundles in src-tauri/target/release/bundle (.msi/.exe on Windows, .dmg/.app on macOS)
```

Pass the URL `starci ui` printed at launch to skip the connect screen: `"StarCi Harness" --url <url>`, or set
`STARCI_UI_URL`. The window is 1440x960 (minimum 1024x700); its content security policy lets the app talk only to
`127.0.0.1`. Icons in `src-tauri/icons` come from `public/starci-logo.png` (`npx tauri icon public/starci-logo.png -o
src-tauri/icons`).

CI: [`.github/workflows/app.yml`](../.github/workflows/app.yml). A tag `app-v*` or a manual run builds Windows (.msi, .exe) and macOS (universal .dmg) with `tauri-action` and uploads them as workflow
artifacts. Builds are unsigned unless the optional signing secrets named at the top of that file exist.

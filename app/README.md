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

## Fixtures mode

`http://localhost:1420/?fixtures=1` runs the whole app on the sample data in `src/api/fixtures.ts`, with no server:
reads answer from the fixtures, writes answer "accepted" and change nothing. The mode lasts for the browser session;
`?fixtures=0` leaves it. The connect screen's "Xem bằng dữ liệu mẫu" opens the same mode. `VITE_FIXTURES=1 npm run build`
bakes it into a build.

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

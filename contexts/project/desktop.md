# The desktop app: a Tauri shell around the web app

A project that offers its web app as an installable program (macOS, Windows, Linux) declares a desktop app. It is a [Tauri v2](https://v2.tauri.app) shell
that opens the deployed web app in a native window, so the product stays one codebase: the Next app in `fe/` is the program, and `desktop/` is the thin
shell that installs it, registers its deep links and updates it. The same declaration is the place a mobile target joins later.

## PROJECT-DESKTOP-1 The desktop app is a Tauri shell around the deployed web app

**The shell loads the deployed origin; it does not bundle the web app.** `sides.desktop.origin` (for example `https://app.nivo.vn`) is what the window shows
in a release build, and `devOrigin` (`http://localhost:3000` by default) is what `starci app desktop dev` shows. Why, and what it costs:

| | remote-origin shell (the rule) | static export bundled in the shell |
|---|---|---|
| codebase | the one Next app, as it is deployed | a second build target of the Next app, with its own routes and data rules |
| what Next features work | all (server components, route handlers, middleware, auth cookies) | only what survives `output: "export"`: no server rendering, no route handlers, no middleware, no cookie session |
| a web release | reaches the installed apps at once | needs a new installer and an update for every web change |
| offline | the window shows the webview's own error | works, for the pages that need no server |
| trust | the page is code from the origin: the shell must not give it the shell | the page is local code |

A bundled export is declined, not forbidden by the tool: a project whose web app is already a static export can point `origin` at the host that serves it.
The consequence of the rule is **isolation**, which the rest of this contract holds: the page is remote code, so the shell exposes no command to it (no
`invoke_handler`, no capability that names the origin, no global Tauri API), keeps the window on the declared origins, and sends every other link to the
system browser.

### The declaration

`hfs.json` declares it under `sides.desktop`, beside `fe` (the shell wraps one of its apps), which is required:

```json
"desktop": {
  "app": "web",
  "name": "NIVO",
  "identifier": "vn.nivo.desktop",
  "origin": "https://app.nivo.vn",
  "devOrigin": "http://localhost:3000",
  "allowedOrigins": ["https://accounts.google.com"],
  "schemes": ["nivo"],
  "targets": ["macos", "windows", "linux"],
  "updater": { "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...", "endpoint": "https://github.com/<owner>/<repo>/releases/latest/download/latest.json" }
}
```

| key | meaning | rule |
|---|---|---|
| `app` | the `sides.fe.apps` app the shell wraps | must be declared |
| `name` | the product name: window title, installer name | 1 to 40 characters of letters, digits, space, `.`, `-`, `_` |
| `identifier` | the reverse-DNS name the operating system knows the app by; **never change it after a first release**, an update cannot cross it | `vn.nivo.desktop`; does not end in `.app` |
| `origin` | the deployed web app the release build loads | `https://host[:port]`, no path, not a local host |
| `devOrigin` | what a debug build loads (default `http://localhost:3000`) | a local host |
| `allowedOrigins` | origins the window may navigate to besides `origin` (a sign-in provider); every other http(s), `mailto` and `tel` link opens in the system browser | https origins, no wildcard |
| `schemes` | deep link schemes (`nivo://crm/leads?id=3` opens `<origin>/crm/leads?id=3`) | lowercase, not `http`, `https`, `file`, `tauri`, ... |
| `targets` | the systems the release workflow builds (default all three) | `macos`, `windows`, `linux` |
| `updater` | the public key the installed apps verify updates with, and the manifest URL they poll; omit it and the release ships plain installers | `pubkey` is the **content** of the `.pub` file, never a path and never the private key |

The shape is judged with the rest of `hfs.json` (`HFS_DECLARATION_INVALID`). `desktop` is a declaration side with a folder of its own, like `nivoos`: it adds
no folder side, so the be, fe and packages checks never see it, and a project that declares none has none of the files below.

## PROJECT-DESKTOP-2 The tree: rendered files, owned files, ignored files

`desktop/` sits at the app root (slots `app.desktop-config`, `app.desktop`, `app.desktop-build`; the release workflow is slot `app.ci-desktop-release`).

```text
desktop/
  frontend/index.html                 rendered: the page Tauri bundles as frontendDist (the window never shows it; a build needs the folder)
  src-tauri/
    tauri.conf.json                   rendered from the declaration
    Cargo.toml  build.rs              rendered
    src/main.rs  src/lib.rs           rendered: the one window, its navigation guard, the deep link and the updater check
    icons/                            owned: `cargo tauri icon <1024px.png>` writes it; a build bundles it
    Cargo.lock                        owned: tracked, so a release builds what was tested
    capabilities/*.json               owned, optional: Tauri permissions; none may name the remote origin with a wildcard
    target/  gen/                     ignored: what cargo and the Tauri CLI build
.github/workflows/desktop-release.yml rendered: the release workflow
```

`starci app sync --execute` writes the rendered files from the declaration (`sync/desktop.mts`); `HFS_MANAGED_FILE_DRIFT` is what a hand edit meets. To
change the app you change `hfs.json`, not the files. The managed `.prettierignore` lists `desktop/` (the rendered files are byte-for-byte) and the managed
`.gitignore` lists `target/` and `gen/`.

**The version is the web app's.** `tauri.conf.json` has `"version": "../../package.json"`: Tauri reads the version from the root `package.json`, so the
installer, the updater manifest and the web app share one number and there is nothing to keep in step. The release tag must be `v<that version>` (the
workflow's verify job refuses any other).

**The security the rendered shell holds** (R444 judges the config and the capability files):

- one window, created in Rust (`app.windows` is empty in the config), with a navigation handler: the declared origin, `allowedOrigins` and the shell's own page
  stay in the window; other `http(s)`, `mailto` and `tel` links open in the system browser; everything else is refused;
- no IPC for the page: no registered command, no capability naming the origin (`HFS_DESKTOP_SECURITY` also refuses a capability whose `remote.urls` is a bare
  wildcard or plain http), no `withGlobalTauri`, no `dangerous*` switch, a CSP (for the shell's own page) without `unsafe-eval` or a wildcard;
- deep links go through the single-instance plugin (a second launch reaches the running window) and only the declared schemes are handled;
- the updater is configured with its public key and an https endpoint, and `dangerousInsecureTransportProtocol` is never set.

## PROJECT-DESKTOP-3 Building: locally with Rust, in CI for a release

| verb | what | needs |
|---|---|---|
| `starci app desktop init --name N --identifier I --origin O [--app A] [--scheme S]... [--allowed-origin O]... [--repo owner/name --updater-pubkey K]` | declares `sides.desktop` in `hfs.json`, adds the CI secret names to `ci.secrets` (all optional), then runs `starci app sync --execute`; prints the owner steps | nothing |
| `starci app desktop doctor [--json]` | says whether this machine has `rustc`, `cargo` and `cargo-tauri` (and the hint for what is missing) | nothing; exit 1 only reports |
| `starci app desktop build [--target <os>] [--debug] [--bundles a,b]` | `cargo tauri build` in `desktop/`, for **this machine's own system**; `--target` is `macos`, `macos-arm64`, `macos-x64`, `windows`, `linux`, their `-arm64` variants or a Rust triple of the same system | the Rust toolchain and `cargo-tauri` at the pinned version |
| `starci app desktop dev` | `cargo tauri dev`: the window on `devOrigin` | the same; the web app running |
| `starci app desktop keygen --out <file>` | `cargo tauri signer generate`, refusing a path inside the repository or an existing file | the same |

**A machine without Rust is a normal machine.** Nothing in `starci app check`, `sync`, the hooks or the gates runs cargo: the checks read the declaration, the
tree and the config (R444) as files. Only `build`, `dev` and `keygen` need the toolchain, and without it they refuse (`DESKTOP_TOOLCHAIN_MISSING`, exit 2)
and say that CI builds the installers. A project that declares no desktop app has none of this. An installer is built on its own system (a macOS app needs
macOS), so `--target` for another system is refused (`DESKTOP_TARGET_HOST`); the release builds each system on its own runner.

**The release is the workflow, not a laptop.** `.github/workflows/desktop-release.yml` runs on a `v<version>` tag push (and on dispatch for an existing tag):

1. `verify`: the tag equals `v` plus the `version` of `package.json`;
2. `build`: one job per declared target on a GitHub-hosted runner (macOS universal, Windows, Ubuntu 22.04): Rust stable, the Tauri CLI at the pinned version
   (`TAURI_CLI_VERSION` in `desktop-side.mts`, installed by `cargo install --locked`), `tauri-apps/tauri-action` (pinned by commit) builds the installers and
   uploads them to a **draft** GitHub Release of the tag, with the updater manifest `latest.json` when an updater is declared;
3. `publish`: opens the draft release only when every system built, so the manifest never names a build that is missing.

The installers are the GitHub Release assets (`.dmg`, `.app.tar.gz`, `.msi`, `.exe`, `.AppImage`, `.deb`, `.rpm`); the web site links
`https://github.com/<owner>/<repo>/releases/latest` or a download page that reads the release.

## PROJECT-DESKTOP-4 Keys and certificates: CI secrets, never files

No key is ever a tracked file (`HFS_DESKTOP_SIGNING_KEY` refuses a `.p12`, `.pfx`, key store, a minisign secret key, or a signing secret written into a file of
`desktop/`). The workflow reads these names, which `init` declares in `ci.secrets` (scope repository, **optional**: an unset secret leaves that signature out
and fails nothing) and which the owner sets with the existing flow, `starci app ci secret set <NAME> --execute` (the value on stdin):

| secret | for | who provides it |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | signs the update bundles; the installed apps verify with `updater.pubkey` | the owner: `starci app desktop keygen --out <outside the repo>`; **a lost key means installed apps can never be updated** |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | signs the macOS app (Developer ID Application certificate, `.p12` as base64) | the owner, from an Apple Developer Program account |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarizes the macOS app (an app-specific password) | the same account |

The workflow copies only the secrets that are set into the build environment (an empty `APPLE_CERTIFICATE` would make the CLI try to sign with nothing).
Without the Apple secrets the macOS app is unsigned: Gatekeeper refuses it until the user overrides it. Windows signing is **not wired**: an unsigned Windows
installer shows SmartScreen's warning until the app gains reputation; a certificate (an OV/EV code signing certificate, or Azure Trusted Signing) is an owner
decision and arrives as a `bundle.windows` setting plus its secrets in a later hfs. Linux needs no certificate.

## What a project needs to adopt it

1. `starci app desktop init --name <Product> --identifier <vn.example.desktop> --origin https://<web host> --scheme <scheme> --repo <owner/name>`;
2. make the icons (`cargo tauri icon <source.png>` in `desktop/src-tauri`) and commit them, with `Cargo.lock` after a first `starci app desktop build`;
3. generate the updater key (`keygen`), put the public key in `sides.desktop.updater` and set the CI secrets above;
4. make the web app's own sign-in work in a webview (cookies on the origin, the providers' hosts in `allowedOrigins`), and let `<scheme>://` deep links land on
   web routes;
5. tag `v<version>`: the workflow builds, signs what it can and opens the release.

Enforced by: R444 (`desktop`: `HFS_DESKTOP_UNDECLARED`, `HFS_DESKTOP_FILE_MISSING`, `HFS_DESKTOP_CONFIG`, `HFS_DESKTOP_SECURITY`, `HFS_DESKTOP_SIGNING_KEY`); the
rendered files by `HFS_MANAGED_FILE_DRIFT`; the workflow's secret reads by `CI_DECLARATION_DRIFT`.

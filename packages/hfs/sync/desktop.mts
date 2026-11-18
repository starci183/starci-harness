// desktop.mts - the managed files of the desktop app a project declares (hfs.json `sides.desktop`, runtime/scripts/hfs/desktop-side.mts, R444): the Tauri
// config, the Cargo manifest, the Rust of the shell, the page Tauri bundles beside it, the release workflow's matrix and the ignore lines. Each is a pure
// function of the declaration, and the templates under templates/app/desktop-config and desktop-workflow hold nothing but the variables these return, so
// `starci app sync` renders the shell from the declaration and HFS_MANAGED_FILE_DRIFT is what a hand edit of it meets.
// A project that declares no desktop app gets every variable empty, and an empty variable-only line disappears from a template (sync/index.mts render).
import { DESKTOP_CI_SECRETS, TAURI_CLI_VERSION, TAURI_CRATE_RANGE, crateName, tauriConfigText, type DesktopDeclaration } from '../runtime/scripts/hfs/desktop-side.mjs';

/** The variables of the desktop templates; every key is present, empty when the project declares no desktop app. */
export interface DesktopVariables {
  desktopTauriConfig: string;
  desktopCargoToml: string;
  desktopLibRs: string;
  desktopIndexHtml: string;
  desktopMatrix: string;
  desktopSecretEnv: string;
  desktopSecretNames: string;
  desktopUpdaterOn: string;
  desktopTauriCli: string;
  desktopIgnore: string;
  desktopGitignore: string;
}

/** The names of the variables, in the order they are documented. */
export const DESKTOP_VARIABLE_NAMES: readonly (keyof DesktopVariables)[] = Object.freeze(['desktopTauriConfig', 'desktopCargoToml', 'desktopLibRs', 'desktopIndexHtml', 'desktopMatrix', 'desktopSecretEnv', 'desktopSecretNames', 'desktopUpdaterOn', 'desktopTauriCli', 'desktopIgnore', 'desktopGitignore']);

const escapeRust = (text: string): string => text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const rustList = (items: readonly string[]): string => (items.length === 0 ? '' : items.map((item) => `    "${escapeRust(item)}",`).join('\n'));
const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The Cargo.toml of the shell. The updater and single-instance plugins are desktop-only, so they sit under the non-mobile target table. */
export function cargoToml(declaration: DesktopDeclaration, header: string): string {
  const updater = declaration.updater === undefined ? '' : 'tauri-plugin-updater = "2"\n';
  const deepLink = declaration.schemes.length === 0 ? '' : 'tauri-plugin-deep-link = "2"\n';
  return `${header}
[package]
name = "${crateName(declaration)}"
version = "0.0.0"
description = "${escapeRust(declaration.name)} desktop shell: a window around ${escapeRust(declaration.origin)}. The version of the app is the one of the web app's package.json (tauri.conf.json)."
edition = "2021"
rust-version = "1.77.2"
publish = false

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "${TAURI_CRATE_RANGE}", features = [] }
tauri-plugin-opener = "2"
serde_json = "1"
${deepLink}
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
${updater}
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
`.replaceAll(/\n{3,}/gu, '\n\n');
}

/**
 * The Rust of the shell (src/lib.rs). One window, created here, not in tauri.conf.json: its navigation handler lets the window stay on the declared origin
 * and the allowed ones and sends every other http(s), mailto or tel link to the system browser, so the remote page never leaves the app for a stranger's
 * site inside the window that carries the app's identity. No IPC capability is granted to the remote origin: the page cannot call the shell.
 * Deep links (`<scheme>://<path>?<query>`) navigate the window to `<origin>/<path>?<query>`; the updater checks once at start and installs on the next launch.
 */
export function libRs(declaration: DesktopDeclaration, header: string): string {
  const deepLink = declaration.schemes.length > 0;
  const updater = declaration.updater !== undefined;
  const uses = [
    'use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};',
    'use tauri_plugin_opener::OpenerExt;',
    ...(deepLink ? ['use tauri_plugin_deep_link::DeepLinkExt;'] : []),
    ...(updater ? ['use tauri_plugin_updater::UpdaterExt;'] : []),
  ];
  const deepLinkFn = deepLink ? `
/// \`<scheme>://<path>?<query>\` opens \`<origin>/<path>?<query>\` in the window: the web app owns every route, the shell only carries the link in.
fn open_deep_link(app: &tauri::AppHandle, url: &Url) {
    if !SCHEMES.contains(&url.scheme()) {
        return;
    }
    let mut target = String::from(home());
    if let Some(host) = url.host_str() {
        target.push('/');
        target.push_str(host);
    }
    target.push_str(url.path());
    if let Some(query) = url.query() {
        target.push('?');
        target.push_str(query);
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(address) = serde_json::to_string(&target) {
            let _ = window.eval(&format!("window.location.assign({address})"));
        }
        let _ = window.set_focus();
    }
}
` : '';
  const updaterFn = updater ? `
/// Looks for an update once, at start; a found one is downloaded and installed, and the app runs it from the next launch (Windows relaunches itself, passively).
fn check_for_update(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        if let Ok(Some(update)) = updater.check().await {
            let _ = update.download_and_install(|_chunk, _total| {}, || {}).await;
        }
    });
}
` : '';
  const plugins = [
    '    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {',
    '        if let Some(window) = app.get_webview_window("main") {',
    '            let _ = window.show();',
    '            let _ = window.set_focus();',
    '        }',
    '    }));',
  ].join('\n');
  const setup = [
    '            open_window(app.handle())?;',
    ...(deepLink ? [
      '            let handle = app.handle().clone();',
      '            app.deep_link().on_open_url(move |event| {',
      '                for url in event.urls() {',
      '                    open_deep_link(&handle, &url);',
      '                }',
      '            });',
      '            #[cfg(any(windows, target_os = "linux"))]',
      '            {',
      '                if cfg!(debug_assertions) {',
      '                    let _ = app.deep_link().register_all();',
      '                }',
      '            }',
    ] : []),
    ...(updater ? ['            check_for_update(app.handle().clone());'] : []),
  ].join('\n');
  return `// ${header.replace(/^# /u, '')}
${uses.join('\n')}

/// The origin a release build loads: the deployed web app (hfs.json sides.desktop.origin).
const ORIGIN: &str = "${escapeRust(declaration.origin)}";
/// The origin a debug build loads (sides.desktop.devOrigin).
const DEV_ORIGIN: &str = "${escapeRust(declaration.devOrigin)}";
/// Origins the window may navigate to besides the one it loads (sides.desktop.allowedOrigins).
const ALLOWED_ORIGINS: &[&str] = &[${declaration.allowedOrigins.length === 0 ? '' : `
${rustList(declaration.allowedOrigins)}
`}];
${deepLink ? `/// The deep link schemes the app registers (sides.desktop.schemes).\nconst SCHEMES: &[&str] = &[\n${rustList(declaration.schemes)}\n];\n` : ''}
const TITLE: &str = "${escapeRust(declaration.name)}";

fn home() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_ORIGIN
    } else {
        ORIGIN
    }
}

/// Whether the window may show \`url\`: the origin it loads, an allowed origin, or the shell's own page.
fn allowed(url: &Url) -> bool {
    let origin = url.origin().ascii_serialization();
    origin == ORIGIN
        || origin == DEV_ORIGIN
        || ALLOWED_ORIGINS.contains(&origin.as_str())
        || url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || url.as_str() == "about:blank"
}

fn open_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let start: Url = home().parse().expect("sides.desktop.origin is a URL");
    let opener = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
        .title(TITLE)
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .on_navigation(move |url| {
            if allowed(url) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()?;
    Ok(())
}
${deepLinkFn}${updaterFn}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
${plugins}
    }
    builder
        .plugin(tauri_plugin_opener::init())${deepLink ? '\n        .plugin(tauri_plugin_deep_link::init())' : ''}${updater ? '\n        .plugin(tauri_plugin_updater::Builder::new().build())' : ''}
        .setup(|app| {
${setup}
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the ${escapeRust(declaration.name)} desktop shell failed to start");
}
`;
}

/** The page Tauri bundles as the shell's frontendDist. The window never shows it (it loads the deployed origin); a build needs the folder, and a link on it opens the app. */
export function indexHtml(declaration: DesktopDeclaration): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(declaration.name)}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    </style>
  </head>
  <body>
    <p><a href="${escapeHtml(declaration.origin)}">Open ${escapeHtml(declaration.name)}</a></p>
  </body>
</html>
`;
}

/** The matrix entries of the release workflow, as the lines under `matrix:` `include:` (indented 8 spaces), one per declared operating system. */
export function releaseMatrix(declaration: DesktopDeclaration): string {
  const entry = (label: string, os: string, args: string, rustTargets: string): string[] => [
    `          - label: ${label}`,
    `            os: ${os}`,
    `            args: "${args}"`,
    `            rust-targets: "${rustTargets}"`,
  ];
  const lines = declaration.targets.flatMap((target) => {
    if (target === 'macos') return entry('macos', 'macos-latest', '--target universal-apple-darwin', 'aarch64-apple-darwin,x86_64-apple-darwin');
    if (target === 'windows') return entry('windows', 'windows-latest', '', '');
    return entry('linux', 'ubuntu-22.04', '', '');
  });
  return lines.join('\n');
}

/** The `NAME: ${{ secrets.NAME }}` lines of the step that reads the signing secrets (indented 10 spaces), and the names themselves for the shell loop. */
export function secretEnvLines(): string { return DESKTOP_CI_SECRETS.map(({ name }) => `          ${name}: \${{ secrets.${name} }}`).join('\n'); }

/** The ignore lines of the desktop folder: prettier must not rewrite what sync renders byte for byte, and git never tracks what a build writes. */
const PRETTIER_IGNORE = 'desktop/';
const GITIGNORE = ['# desktop: what cargo and the Tauri CLI build and generate, never tracked', 'desktop/src-tauri/target/', 'desktop/src-tauri/gen/'];

/** Every variable of the desktop templates for `app`: filled for a project that declares sides.desktop, else empty. */
export function desktopVariables(app: { readonly desktop?: DesktopDeclaration | undefined }, header: string): DesktopVariables {
  const declaration = app.desktop;
  if (declaration === undefined) {
    return Object.fromEntries(DESKTOP_VARIABLE_NAMES.map((name) => [name, ''])) as unknown as DesktopVariables;
  }
  return {
    desktopTauriConfig: tauriConfigText(declaration).trimEnd(),
    desktopCargoToml: cargoToml(declaration, header).trimEnd(),
    desktopLibRs: libRs(declaration, header).trimEnd(),
    desktopIndexHtml: indexHtml(declaration).trimEnd(),
    desktopMatrix: releaseMatrix(declaration),
    desktopSecretEnv: secretEnvLines(),
    desktopSecretNames: DESKTOP_CI_SECRETS.map(({ name }) => name).join(' '),
    desktopUpdaterOn: declaration.updater === undefined ? 'false' : 'true',
    desktopTauriCli: TAURI_CLI_VERSION,
    desktopIgnore: PRETTIER_IGNORE,
    desktopGitignore: GITIGNORE.join('\n'),
  };
}

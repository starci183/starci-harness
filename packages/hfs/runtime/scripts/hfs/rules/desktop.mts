// desktop.mts - R444: the desktop app a project declares (hfs.json `sides.desktop`, desktop-side.mts, contexts/project/desktop.md PROJECT-DESKTOP-1) agrees with its
// tree and its config, each way:
//   HFS_DESKTOP_UNDECLARED    a tracked file of the desktop folder (desktop/) or its release workflow exists, but hfs.json declares no sides.desktop;
//   HFS_DESKTOP_FILE_MISSING  a declared desktop app lacks the icons a bundle needs (desktop/src-tauri/icons/, written by `tauri icon`), or its Cargo.lock (a warning);
//   HFS_DESKTOP_CONFIG        tauri.conf.json does not say what the declaration says: identifier, product name, the version taken from the app's package.json,
//                             the deep link schemes, the updater key and endpoint, the dev origin, the one window created in Rust;
//   HFS_DESKTOP_SECURITY      the shell's isolation is loosened: the global Tauri API, a dangerous* switch, an empty or unsafe CSP, an updater over plain http, or a capability
//                             that hands the IPC to a wildcard or plain-http remote origin;
//   HFS_DESKTOP_SIGNING_KEY   a signing certificate, a key store or a private key is a tracked file, or a signing secret is written into a tracked file: the keys are CI secrets.
// The managed files are held by HFS_MANAGED_FILE_DRIFT (they are rendered from the declaration); these findings name the law a hand edit broke.
import { DESKTOP_DIR, MINISIGN_SECRET, SIGNING_ASSIGNMENT, SIGNING_FILE, TAURI_CONFIG_FILE, TAURI_DIR, TAURI_ICONS, capabilityOpensRemote, desktopConfigProblems, type DesktopDeclaration } from '../desktop-side.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

const WORKFLOW = '.github/workflows/desktop-release.yml';
/** The extensions of the tracked files of desktop/ that are binary or generated media: not scanned for a signing secret. */
const NOT_SCANNED = /\.(?:png|icns|ico|jpe?g|webp|gif|svg)$/iu;

/** The findings of R444 over the tracked tree `files` of the app root. */
export function desktopFindings({ repoRoot, files, repo }: { repoRoot: string; files: readonly string[]; repo: Repo }): Finding[] {
  const findings: Finding[] = [];
  const tracked = new Set(files);
  const inDesktop = files.filter((file) => file.startsWith(`${DESKTOP_DIR}/`));
  const declared = repo.desktop as DesktopDeclaration | undefined;
  if (declared === undefined) {
    for (const file of [...inDesktop.slice(0, 1), ...(tracked.has(WORKFLOW) ? [WORKFLOW] : [])]) {
      findings.push(found('HFS_DESKTOP_UNDECLARED', file, `${file} belongs to the desktop app, but hfs.json declares no sides.desktop: declare it ("desktop": { "app": "<fe app>", "name": "...", "identifier": "...", "origin": "https://..." }), or remove ${DESKTOP_DIR}/ and ${WORKFLOW} (PROJECT-DESKTOP-1)`));
    }
    return [...findings, ...signingFindings(repoRoot, files, inDesktop, false)];
  }
  for (const icon of TAURI_ICONS) {
    if (!tracked.has(`${TAURI_DIR}/${icon}`)) findings.push(found('HFS_DESKTOP_FILE_MISSING', `${TAURI_DIR}/${icon}`, `the desktop app declares a bundle, but ${TAURI_DIR}/${icon} is not tracked: run \`tauri icon <1024px-source.png>\` in ${DESKTOP_DIR}/src-tauri and commit the icons (a build bundles them)`));
  }
  if (!tracked.has(`${TAURI_DIR}/Cargo.lock`)) findings.push({ ...found('HFS_DESKTOP_FILE_MISSING', `${TAURI_DIR}/Cargo.lock`, `${TAURI_DIR}/Cargo.lock is not tracked: run \`starci app desktop build\` once (or \`cargo generate-lockfile\` in ${TAURI_DIR}) and commit it, so a release builds the dependencies that were tested`), level: 'warning' });
  if (tracked.has(TAURI_CONFIG_FILE)) {
    const manifest = readJson(repoRoot, 'package.json') as { version?: unknown } | null;
    for (const problem of desktopConfigProblems(readJson(repoRoot, TAURI_CONFIG_FILE), declared, manifest?.version)) findings.push(found(problem.code, TAURI_CONFIG_FILE, `${problem.message} (PROJECT-DESKTOP-1)`));
  }
  for (const file of files.filter((candidate) => candidate.startsWith(`${TAURI_DIR}/capabilities/`) && candidate.endsWith('.json'))) {
    const opened = capabilityOpensRemote(readJson(repoRoot, file));
    if (opened !== null) findings.push(found('HFS_DESKTOP_SECURITY', file, `${file} grants the Tauri IPC to the remote origin ${opened}, a wildcard or plain-http origin: the shell loads the deployed web app and the page must not call the shell; name an https origin of the app, or remove the remote grant (PROJECT-DESKTOP-1)`));
  }
  return [...findings, ...signingFindings(repoRoot, files, inDesktop, true)];
}

/** HFS_DESKTOP_SIGNING_KEY: a signing file anywhere in the tree (only when a desktop app is declared or its folder exists) and a signing secret written into a file of desktop/. */
function signingFindings(repoRoot: string, files: readonly string[], inDesktop: readonly string[], declared: boolean): Finding[] {
  const findings: Finding[] = [];
  if (!declared && inDesktop.length === 0) return findings;
  for (const file of files.filter((candidate) => SIGNING_FILE.test(candidate))) {
    findings.push(found('HFS_DESKTOP_SIGNING_KEY', file, `${file} is a signing certificate or key store, tracked in a project with a desktop app: keep it out of Git; its base64 is a CI secret set with \`starci app ci secret set <NAME> --execute\` (PROJECT-DESKTOP-1)`));
  }
  for (const file of inDesktop.filter((candidate) => !NOT_SCANNED.test(candidate))) {
    const text = readText(repoRoot, file);
    if (text !== null && (MINISIGN_SECRET.test(text) || SIGNING_ASSIGNMENT.test(text))) {
      findings.push(found('HFS_DESKTOP_SIGNING_KEY', file, `${file} holds a private signing key or a signing secret: the updater key and the Apple credentials are CI secrets (TAURI_SIGNING_PRIVATE_KEY, APPLE_*), never a tracked file (PROJECT-DESKTOP-1)`));
    }
  }
  return findings;
}

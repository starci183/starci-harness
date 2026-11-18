// desktop-side.mts - the desktop app a project declares (contexts/project/desktop.md PROJECT-DESKTOP-1, R444): hfs.json `sides.desktop`
//   "desktop": { "app": "web", "name": "NIVO", "identifier": "vn.nivo.app", "origin": "https://app.nivo.vn", "schemes": ["nivo"], "updater": { "pubkey": "...", "endpoint": "https://..." } }
// wraps one front-end app in a Tauri v2 shell that loads the deployed origin (the remote-origin shell): the web app stays the only codebase, the shell
// is the folder `desktop/` (desktop/src-tauri/, desktop/frontend/) and installs a native window, deep links and the updater around it.
// `desktop` is a declaration side with a folder of its own, like `nivoos` is a declaration over packages/: it is not a member of PROJECT_SIDES, so the
// be/fe/packages machinery never sees it; the slots `app.desktop-config` (managed), `app.desktop-workflow` (managed) and `app.desktop` (owned) carry its tree.
// Pure and dependency-free: the declaration shape, its defaults, the config a declaration renders, and the judgment of a rendered config.
import { isPlainObject } from '../../engine/plain-object.mjs';

/** The key of `sides` that declares the desktop app. */
export const DESKTOP_SIDE = 'desktop';
/** The folder of the desktop app, at the app root. */
export const DESKTOP_DIR = 'desktop';
/** The Tauri project inside it: tauri.conf.json, Cargo.toml, src/ and icons/. */
export const TAURI_DIR = `${DESKTOP_DIR}/src-tauri`;
/** The file that holds the Tauri config. */
export const TAURI_CONFIG_FILE = `${TAURI_DIR}/tauri.conf.json`;
/** The operating systems an installer is built for, in the order the release matrix lists them. */
export const DESKTOP_TARGETS: readonly string[] = Object.freeze(['macos', 'windows', 'linux']);
/** The version of the Tauri CLI (the crate `tauri-cli`) that the CI workflow and `starci app desktop` install and expect. */
export const TAURI_CLI_VERSION = '2.12.5';
/** The Tauri version range of the generated Cargo.toml; Cargo.lock (tracked) pins the exact one. */
export const TAURI_CRATE_RANGE = '2.12';
/** The GitHub Actions secrets the release workflow reads, with what each one is for. All are optional: an unset secret builds an unsigned installer, and the updater key is checked by the rule when an updater is declared. */
export const DESKTOP_CI_SECRETS: readonly Readonly<{ name: string; purpose: string }>[] = Object.freeze([
  { name: 'TAURI_SIGNING_PRIVATE_KEY', purpose: 'the updater signing key (tauri signer generate): signs the update bundles the shipped apps verify with the public key of hfs.json sides.desktop.updater.pubkey' },
  { name: 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', purpose: 'the password of the updater signing key, when it has one' },
  { name: 'APPLE_CERTIFICATE', purpose: 'the base64 of the Developer ID Application certificate (.p12) that signs the macOS app' },
  { name: 'APPLE_CERTIFICATE_PASSWORD', purpose: 'the password of the macOS signing certificate' },
  { name: 'APPLE_SIGNING_IDENTITY', purpose: 'the identity of the macOS signing certificate (Developer ID Application: <name> (<team>))' },
  { name: 'APPLE_ID', purpose: 'the Apple ID that notarizes the macOS app' },
  { name: 'APPLE_PASSWORD', purpose: 'the app-specific password of the notarizing Apple ID' },
  { name: 'APPLE_TEAM_ID', purpose: 'the Apple developer team that notarizes the macOS app' },
]);
/** The URL schemes the operating systems and Tauri keep for themselves; a deep link scheme is never one of them. */
const RESERVED_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'ws', 'wss', 'data', 'blob', 'about', 'javascript', 'mailto', 'tel', 'tauri', 'ipc', 'asset', 'chrome', 'view-source']);

/** The origin a debug build loads when the declaration names none: the dev server of a Next app. */
const DESKTOP_DEV_DEFAULT = 'http://localhost:3000';
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/u;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/u;
const APP_NAME = /^[a-z][a-z0-9-]*$/u;
const SCHEME = /^[a-z][a-z0-9+.-]{1,31}$/u;
/** A minisign public key as `tauri signer generate` prints it: the base64 of two lines, which always starts `dW50cnVzdGVkIGNvbW1lbnQ6` ("untrusted comment:"). */
const UPDATER_PUBKEY = /^dW50cnVzdGVkIGNvbW1lbnQ6[A-Za-z0-9+/=]{40,400}$/u;
const KEYS = ['app', 'name', 'identifier', 'origin', 'devOrigin', 'allowedOrigins', 'schemes', 'targets', 'updater'] as const;
const UPDATER_KEYS = ['pubkey', 'endpoint'] as const;

/** The updater a project declares: the public key the installed apps verify bundles with, and the manifest URL they poll. */
export interface DesktopUpdater { readonly pubkey: string; readonly endpoint: string }
/** The desktop app of a project, with the defaults applied. */
export interface DesktopDeclaration {
  /** The front-end app the shell wraps (a name of sides.fe.apps); its deployed origin is `origin`. */
  readonly app: string;
  /** The product name: the title of the window and the name of the installer. */
  readonly name: string;
  /** The reverse-DNS identifier of the app (vn.nivo.app); it names the app to the operating system and never changes after a first release. */
  readonly identifier: string;
  /** The origin the window loads in a release build: https scheme, host and optional port, no path. */
  readonly origin: string;
  /** The origin the window loads in `starci app desktop dev` (a debug build). */
  readonly devOrigin: string;
  /** Origins the window may navigate to beside `origin` (a sign-in provider); every other link opens in the system browser. */
  readonly allowedOrigins: readonly string[];
  /** The deep link schemes the app registers (nivo:// opens the app); none when the app declares none. */
  readonly schemes: readonly string[];
  /** The operating systems the release workflow builds an installer for. */
  readonly targets: readonly string[];
  /** The updater, when the project ships updates; none builds plain installers only. */
  readonly updater?: DesktopUpdater;
}

/** The origin of a URL string when it is `scheme://host[:port]` and nothing else (lowercase, no path, query or trailing slash), else null. */
export function originOf(value: unknown): { scheme: string; host: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/u.exec(value);
  if (match === null) return null;
  const port = match[3];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return { scheme: match[1] as string, host: match[2] as string };
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocalHost = (host: string): boolean => LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
const unique = (list: readonly unknown[]): boolean => new Set(list).size === list.length;

/**
 * The problems of the value of `sides.desktop`, in the words of the declaration. `feApps` are the names of the declared front-end apps (empty when the
 * project declares no fe side: a desktop app wraps one, so that is itself a problem).
 */
export function desktopSideProblems(value: unknown, feApps: readonly string[]): string[] {
  const at = 'sides.desktop';
  if (!isPlainObject(value)) return [`${at} must be an object { "app": "<fe app>", "name": "<product name>", "identifier": "<reverse.dns>", "origin": "https://<host>" }`];
  const record = value as Record<string, unknown>;
  const bad = Object.keys(record).filter((key) => !(KEYS as readonly string[]).includes(key)).map((key) => `${at} has unknown key ${key}`);
  if (feApps.length === 0) bad.push(`${at} wraps a front-end app, but the project declares no fe side with an app: declare sides.fe first`);
  const { app, name, identifier, origin, devOrigin, allowedOrigins, schemes, targets, updater } = record;
  if (typeof app !== 'string' || !APP_NAME.test(app)) bad.push(`${at}.app must be the name of the front-end app the shell loads (a name of sides.fe.apps)`);
  else if (feApps.length > 0 && !feApps.includes(app)) bad.push(`${at}.app names ${app}, which is not an app of sides.fe.apps (${feApps.join(', ')})`);
  if (typeof name !== 'string' || !NAME.test(name)) bad.push(`${at}.name must be the product name: 1 to 40 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit`);
  if (typeof identifier !== 'string' || !IDENTIFIER.test(identifier)) bad.push(`${at}.identifier must be a reverse-DNS name (vn.nivo.app): two or more dot-separated parts of letters, digits and dashes, each starting with a letter`);
  else if (identifier.endsWith('.app')) bad.push(`${at}.identifier must not end in .app: macOS reads that as a bundle extension (use vn.nivo.desktop)`);
  const home = originOf(origin);
  if (home === null) bad.push(`${at}.origin must be an origin: https://<host>[:port], lowercase, no path and no trailing slash`);
  else if (home.scheme !== 'https') bad.push(`${at}.origin must be https: the shell loads the deployed web app and a release never loads plain http`);
  else if (isLocalHost(home.host)) bad.push(`${at}.origin must be the deployed origin of the web app, not a local host (${DESKTOP_DEV_DEFAULT} is the devOrigin)`);
  if (devOrigin !== undefined) {
    const dev = originOf(devOrigin);
    if (dev === null) bad.push(`${at}.devOrigin must be an origin: http(s)://<host>[:port], no path`);
    else if (!isLocalHost(dev.host)) bad.push(`${at}.devOrigin must be a local host (localhost, 127.0.0.1): a debug build never loads a deployed origin`);
  }
  if (allowedOrigins !== undefined) {
    if (!Array.isArray(allowedOrigins) || !unique(allowedOrigins)) bad.push(`${at}.allowedOrigins must be a unique list of https origins`);
    else allowedOrigins.forEach((entry: unknown, index) => {
      const parsed = originOf(entry);
      if (parsed === null || parsed.scheme !== 'https') bad.push(`${at}.allowedOrigins[${String(index)}] must be an https origin (https://<host>[:port], no path, no wildcard)`);
      else if (entry === origin) bad.push(`${at}.allowedOrigins[${String(index)}] repeats origin`);
    });
  }
  if (schemes !== undefined) {
    if (!Array.isArray(schemes) || !unique(schemes)) bad.push(`${at}.schemes must be a unique list of deep link schemes`);
    else schemes.forEach((entry: unknown, index) => {
      if (typeof entry !== 'string' || !SCHEME.test(entry)) bad.push(`${at}.schemes[${String(index)}] must be a lowercase URL scheme (nivo): 2 to 32 letters, digits, +, . or -`);
      else if (RESERVED_SCHEMES.has(entry)) bad.push(`${at}.schemes[${String(index)}] ${entry} is a scheme the browser or Tauri keeps for itself`);
    });
  }
  if (targets !== undefined && (!Array.isArray(targets) || targets.length === 0 || !unique(targets) || !targets.every((entry: unknown) => typeof entry === 'string' && DESKTOP_TARGETS.includes(entry)))) bad.push(`${at}.targets must be a non-empty unique list of ${DESKTOP_TARGETS.join(', ')}`);
  if (updater !== undefined) bad.push(...updaterProblems(updater, `${at}.updater`));
  return bad;
}
function updaterProblems(value: unknown, at: string): string[] {
  if (!isPlainObject(value)) return [`${at} must be an object { "pubkey": "<public key>", "endpoint": "https://.../latest.json" }`];
  const record = value as Record<string, unknown>;
  const bad = Object.keys(record).filter((key) => !(UPDATER_KEYS as readonly string[]).includes(key)).map((key) => `${at} has unknown key ${key}`);
  if (typeof record.pubkey !== 'string' || !UPDATER_PUBKEY.test(record.pubkey)) bad.push(`${at}.pubkey must be the public key \`tauri signer generate\` prints (its content, not a path; never the private key): the base64 text that starts dW50cnVzdGVkIGNvbW1lbnQ6`);
  const endpoint = typeof record.endpoint === 'string' ? record.endpoint : '';
  if (!/^https:\/\/[a-z0-9][a-z0-9.-]*(?::\d{1,5})?\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u.test(endpoint) || endpoint.includes('..')) bad.push(`${at}.endpoint must be an https URL of the update manifest (https://github.com/<owner>/<repo>/releases/latest/download/latest.json)`);
  return bad;
}

/** The desktop declaration of a parsed hfs.json `sides`, defaults applied; undefined when none is declared or it is malformed (the shape check reports that). */
export function desktopOf(sides: unknown): DesktopDeclaration | undefined {
  if (!isPlainObject(sides) || !Object.hasOwn(sides, DESKTOP_SIDE)) return undefined;
  const raw = (sides as Record<string, unknown>)[DESKTOP_SIDE];
  const feApps = feAppNames(sides);
  if (desktopSideProblems(raw, feApps).length > 0) return undefined;
  const d = raw as Record<string, unknown>;
  const updater = d.updater as DesktopUpdater | undefined;
  return Object.freeze({
    app: d.app as string,
    name: d.name as string,
    identifier: d.identifier as string,
    origin: d.origin as string,
    devOrigin: (d.devOrigin as string | undefined) ?? DESKTOP_DEV_DEFAULT,
    allowedOrigins: Object.freeze([...((d.allowedOrigins as string[] | undefined) ?? [])]),
    schemes: Object.freeze([...((d.schemes as string[] | undefined) ?? [])]),
    targets: Object.freeze(DESKTOP_TARGETS.filter((target) => ((d.targets as string[] | undefined) ?? DESKTOP_TARGETS).includes(target))),
    ...(updater === undefined ? {} : { updater: Object.freeze({ pubkey: updater.pubkey, endpoint: updater.endpoint }) }),
  });
}

/** The names of the front-end apps a parsed `sides` declares. */
export function feAppNames(sides: unknown): string[] {
  const fe = isPlainObject(sides) ? (sides as Record<string, unknown>).fe : undefined;
  const apps = isPlainObject(fe) ? (fe as Record<string, unknown>).apps : undefined;
  return Array.isArray(apps) ? apps.flatMap((entry: unknown) => (isPlainObject(entry) && typeof (entry as Record<string, unknown>).name === 'string' ? [(entry as { name: string }).name] : [])) : [];
}

/** The Cargo package name of the shell: the product name as lowercase kebab-case, `app` when nothing is left. */
export const crateName = (declaration: Pick<DesktopDeclaration, 'name'>): string => `${declaration.name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-').replaceAll(/^-+|-+$/gu, '') || 'app'}-desktop`;

/** The Content-Security-Policy of the shell's own pages (the offline notice in desktop/frontend); the web app keeps the policy its own headers send. */
export const SHELL_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The `icon` list of the bundle: the files `tauri icon <source.png>` writes into desktop/src-tauri/icons/. */
export const TAURI_ICONS: readonly string[] = Object.freeze(['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);

/**
 * The tauri.conf.json a declaration renders, as an object (the order of its keys is the order of the file). The window is not in it: the shell creates its
 * one window in Rust, so it can refuse a navigation outside `origin` and `allowedOrigins`.
 * `version` is the path of the app's package.json: Tauri reads the version from it, so the installer, the updater manifest and the web app share one number.
 */
export function tauriConfig(declaration: DesktopDeclaration): Record<string, unknown> {
  return {
    $schema: 'https://schema.tauri.app/config/2',
    productName: declaration.name,
    version: '../../package.json',
    identifier: declaration.identifier,
    build: { frontendDist: '../frontend', devUrl: declaration.devOrigin },
    app: { withGlobalTauri: false, windows: [], security: { csp: SHELL_CSP } },
    bundle: {
      active: true,
      targets: 'all',
      icon: [...TAURI_ICONS],
      category: 'Business',
      ...(declaration.updater === undefined ? {} : { createUpdaterArtifacts: true }),
      macOS: { minimumSystemVersion: '10.15' },
    },
    plugins: {
      ...(declaration.schemes.length === 0 ? {} : { 'deep-link': { desktop: { schemes: [...declaration.schemes] } } }),
      ...(declaration.updater === undefined ? {} : { updater: { pubkey: declaration.updater.pubkey, endpoints: [declaration.updater.endpoint], windows: { installMode: 'passive' } } }),
    },
  };
}

/** The tauri.conf.json text of a declaration. */
export const tauriConfigText = (declaration: DesktopDeclaration): string => `${JSON.stringify(tauriConfig(declaration), null, 2)}\n`;

/** A problem of a tauri.conf.json: the code of its rule and the words that name it. */
export interface DesktopConfigProblem { readonly code: 'HFS_DESKTOP_CONFIG' | 'HFS_DESKTOP_SECURITY'; readonly message: string }

/**
 * Judges a parsed tauri.conf.json against the declaration it belongs to and the version of the app's package.json: the identifier, the product name and
 * the version source agree (HFS_DESKTOP_CONFIG), the deep link schemes and the updater are exactly the declared ones, and nothing opens the shell's IPC
 * to the remote origin or loosens its policy (HFS_DESKTOP_SECURITY).
 */
export function desktopConfigProblems(config: unknown, declaration: DesktopDeclaration, packageVersion: unknown): DesktopConfigProblem[] {
  const problems: DesktopConfigProblem[] = [];
  const config_ = (message: string): void => { problems.push({ code: 'HFS_DESKTOP_CONFIG', message }); };
  const security = (message: string): void => { problems.push({ code: 'HFS_DESKTOP_SECURITY', message }); };
  if (!isPlainObject(config)) return [{ code: 'HFS_DESKTOP_CONFIG', message: `${TAURI_CONFIG_FILE} is not a JSON object` }];
  const conf = config as Record<string, any>; // reason: a parsed JSON document, read field by field below
  if (conf.identifier !== declaration.identifier) config_(`identifier is ${JSON.stringify(conf.identifier)}, but hfs.json sides.desktop.identifier is ${declaration.identifier}`);
  if (conf.productName !== declaration.name) config_(`productName is ${JSON.stringify(conf.productName)}, but hfs.json sides.desktop.name is ${declaration.name}`);
  if (conf.version !== '../../package.json') config_(`version is ${JSON.stringify(conf.version)}: it must be "../../package.json", the version of the web app, so the installer, the updater manifest and the web app share one number`);
  if (typeof packageVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(packageVersion)) config_(`the package.json of the app has no semver version (${JSON.stringify(packageVersion)}): the installers take it`);
  const schemes: unknown = conf.plugins?.['deep-link']?.desktop?.schemes ?? [];
  if (JSON.stringify(schemes) !== JSON.stringify(declaration.schemes)) config_(`the deep link schemes are ${JSON.stringify(schemes)}, but hfs.json sides.desktop.schemes is ${JSON.stringify(declaration.schemes)}`);
  const updater: Record<string, any> | undefined = conf.plugins?.updater;
  if (declaration.updater === undefined) {
    if (updater !== undefined || conf.bundle?.createUpdaterArtifacts !== undefined) config_('the config carries an updater, but hfs.json sides.desktop declares none');
  } else {
    if (updater?.pubkey !== declaration.updater.pubkey) config_('plugins.updater.pubkey is not the sides.desktop.updater.pubkey of hfs.json');
    if (JSON.stringify(updater?.endpoints) !== JSON.stringify([declaration.updater.endpoint])) config_('plugins.updater.endpoints is not the one sides.desktop.updater.endpoint of hfs.json');
    if (conf.bundle?.createUpdaterArtifacts !== true) config_('bundle.createUpdaterArtifacts is not true: the release builds no signed update bundle');
    if (updater?.dangerousInsecureTransportProtocol === true) security('plugins.updater.dangerousInsecureTransportProtocol is true: updates would be fetched over plain http');
  }
  const url = conf.build?.devUrl;
  if (url !== declaration.devOrigin) config_(`build.devUrl is ${JSON.stringify(url)}, but the devOrigin is ${declaration.devOrigin}`);
  if (Array.isArray(conf.app?.windows) && conf.app.windows.length > 0) config_('app.windows is not empty: the shell creates its one window in Rust, where it refuses navigation outside the declared origins');
  if (conf.app?.withGlobalTauri === true) security('app.withGlobalTauri is true: it hands the whole Tauri API to every page the window loads');
  if (conf.app?.security?.dangerousRemoteDomainAccess !== undefined || conf.app?.security?.dangerousDisableAssetCspModification !== undefined) security('app.security carries a dangerous* switch that weakens the isolation of the remote origin');
  const csp: unknown = conf.app?.security?.csp;
  if (typeof csp !== 'string' || csp.trim() === '') security('app.security.csp is empty: the shell\'s own pages need a Content-Security-Policy');
  else if (/'unsafe-eval'|(?:^|[;\s])\*(?:[;\s]|$)|default-src[^;]*\*/u.test(csp)) security(`app.security.csp allows unsafe-eval or a wildcard source: ${csp}`);
  return problems;
}

/** Whether a capability file (parsed JSON) grants a remote origin the IPC: a `remote.urls` entry that is a wildcard or plain http. */
export function capabilityOpensRemote(capability: unknown): string | null {
  if (!isPlainObject(capability)) return null;
  const remote = (capability as Record<string, unknown>).remote;
  const urls = isPlainObject(remote) && Array.isArray((remote as Record<string, unknown>).urls) ? ((remote as Record<string, unknown>).urls as unknown[]) : [];
  for (const entry of urls) {
    if (typeof entry !== 'string') continue;
    // A bare wildcard host (the whole web) or plain http to a deployed host; a *.domain wildcard and a local http host are the app's own choice.
    const bareWildcard = entry === '*' || /^(?:\*|[a-z]+:\/\/\*)(?:[/:?#]|$)/u.test(entry);
    const plainHttp = entry.startsWith('http://') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?:[/:?#]|$)/u.test(entry);
    if (bareWildcard || plainHttp) return entry;
  }
  return null;
}

/** A file that holds private signing material: its path or content names a Tauri or minisign secret key, a PKCS#12 bundle or a key store. */
export const SIGNING_FILE = /(?:^|\/)[^/]*\.(?:p12|pfx|jks|keystore|mobileprovision|p8)$/iu;
/** The first line of a minisign secret key file (`tauri signer generate` writes one). */
export const MINISIGN_SECRET = /untrusted comment: [^\n]*secret key/iu;
/** A TAURI_SIGNING_PRIVATE_KEY (or Apple password) assigned a literal value in a file. */
export const SIGNING_ASSIGNMENT = /\b(?:TAURI_SIGNING_PRIVATE_KEY|TAURI_PRIVATE_KEY|APPLE_PASSWORD|APPLE_CERTIFICATE)\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{16,}/u;

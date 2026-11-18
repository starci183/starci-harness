// cli.mts - `starci app desktop <init|doctor|build|dev|keygen>`: the desktop app of a project (hfs.json `sides.desktop`, runtime/scripts/hfs/desktop-side.mts, contexts/project/desktop.md).
//   init     declares the desktop app (hfs.json sides.desktop and the CI secret names its release workflow reads), then renders its files with `starci app sync --execute`.
//   doctor   says whether this machine can build the installers: the Rust toolchain and the Tauri CLI. A machine without Rust is not an error anywhere else: the checks never run cargo.
//   build    builds the installers on this machine (`cargo tauri build`), for this machine's operating system; the release builds every system in CI.
//   dev      opens the shell on the dev origin (`cargo tauri dev`).
//   keygen   writes the updater signing key pair outside the repository (`cargo tauri signer generate`) and says where the public key and the CI secret go.
// Every other effect belongs to CI: the installers of a release, the draft GitHub Release and the updater manifest come from .github/workflows/desktop-release.yml.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { DESKTOP_CI_SECRETS, DESKTOP_DIR, DESKTOP_SIDE, DESKTOP_TARGETS, TAURI_CLI_VERSION, TAURI_CONFIG_FILE, TAURI_DIR, desktopOf, desktopSideProblems, feAppNames, type DesktopDeclaration } from '../runtime/scripts/hfs/desktop-side.mjs';
import { SideRefusal } from '../runtime/scripts/hfs/side-gate.mjs';
import { YamlBlockEdit } from '../scaffold/yaml-block-edit.mjs';
import { formatFiles, loadPrettier, type Prettier } from '../sync/format.mjs';

/** A refusal of a desktop verb: its code and the words that say what to do. */
export class DesktopRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** The IO of the verb: the working directory and the two streams, with the seams a spec replaces. */
export interface DesktopIo {
  cwd: string;
  stdout: (text: string) => unknown;
  stderr: (text: string) => unknown;
  env?: NodeJS.ProcessEnv | undefined;
  prettier?: Prettier | undefined;
  platform?: NodeJS.Platform | undefined;
}
/** What a spawned tool answers. */
export interface Spawned { readonly status: number | null; readonly stdout: string }
/** The seams of the verb: how a tool runs (`probe` captures its output, `stream` hands it the terminal), and the sync that renders the files after init. */
export interface DesktopSeam {
  probe?: (command: string, args: readonly string[]) => Spawned;
  stream?: (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => number;
  sync?: (io: DesktopIo) => Promise<number> | number;
}

/** The actions of the verb. */
export const DESKTOP_ACTIONS: readonly string[] = Object.freeze(['init', 'doctor', 'build', 'dev', 'keygen']);

interface FlagSet { readonly boolean?: readonly string[]; readonly value?: readonly string[]; readonly list?: readonly string[] }
const FLAGS: Readonly<Record<string, FlagSet>> = Object.freeze({
  init: { value: ['--app', '--name', '--identifier', '--origin', '--dev-origin', '--updater-pubkey', '--updater-endpoint', '--repo'], list: ['--scheme', '--allowed-origin', '--target'] },
  doctor: { boolean: ['--json'] },
  build: { value: ['--target', '--bundles'], boolean: ['--debug'] },
  dev: {},
  keygen: { value: ['--out'] },
});
const PLACEHOLDER: Readonly<Record<string, string>> = Object.freeze({ '--app': '<fe app>', '--name': '<product name>', '--identifier': '<reverse.dns>', '--origin': 'https://<host>', '--dev-origin': 'http://localhost:<port>', '--updater-pubkey': '<public key>', '--updater-endpoint': 'https://<host>/<path>/latest.json', '--repo': '<owner/name>', '--scheme': '<scheme>', '--allowed-origin': 'https://<host>', '--target': `<${DESKTOP_TARGETS.join('|')}>`, '--bundles': '<a,b>', '--out': '<file outside the repository>' });
const flagText = (flag: string, kind: 'boolean' | 'value' | 'list'): string => (kind === 'boolean' ? `[${flag}]` : kind === 'value' ? `[${flag} ${PLACEHOLDER[flag] ?? '<value>'}]` : `[${flag} ${PLACEHOLDER[flag] ?? '<value>'}]...`);
const OPERANDS: Readonly<Record<string, string>> = Object.freeze({ init: '', doctor: '', build: '', dev: '', keygen: '' });

/** The usage lines of the verb, one per action, from the flag tables the parser refuses every other flag with. */
export const DESKTOP_USAGE: readonly string[] = Object.freeze(DESKTOP_ACTIONS.map((action) => {
  const spec = FLAGS[action] as FlagSet;
  return ['starci app desktop', action, OPERANDS[action], ...(spec.boolean ?? []).map((f) => flagText(f, 'boolean')), ...(spec.value ?? []).map((f) => flagText(f, 'value')), ...(spec.list ?? []).map((f) => flagText(f, 'list'))].filter(Boolean).join(' ');
}));

interface Parsed_ { values: Record<string, string>; lists: Record<string, string[]>; booleans: Set<string> }
function parse(action: string, argv: readonly string[]): Parsed_ {
  const spec = FLAGS[action] as FlagSet;
  const out: Parsed_ = { values: {}, lists: {}, booleans: new Set() };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] as string;
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (!flag.startsWith('--')) throw new DesktopRefusal('DESKTOP_USAGE', `starci app desktop ${action} takes no operand (got ${JSON.stringify(arg)})`);
    if (spec.boolean?.includes(flag)) { out.booleans.add(flag); continue; }
    const kind = spec.value?.includes(flag) ? 'value' : spec.list?.includes(flag) ? 'list' : null;
    if (kind === null) throw new DesktopRefusal('DESKTOP_USAGE', `starci app desktop ${action} takes no ${flag}\n${DESKTOP_USAGE.filter((line) => line.includes(` ${action}`)).join('\n')}`);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[(at += 1)];
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new DesktopRefusal('DESKTOP_USAGE', `${flag} needs a value`);
    if (kind === 'value') {
      if (Object.hasOwn(out.values, flag)) throw new DesktopRefusal('DESKTOP_USAGE', `${flag} is given twice`);
      out.values[flag] = value;
    } else (out.lists[flag] ??= []).push(value);
  }
  return out;
}

const HFS_FILE = 'hfs.json';
const STACK_FILE = '.starcistacks/application-stacks.yaml';

/** The parsed hfs.json of the app at `root`, or a refusal naming what is wrong. */
function readDeclaration(root: string): { text: string; json: Record<string, any> } { // reason: a parsed hfs.json, read field by field
  let text: string;
  try { text = fs.readFileSync(path.join(root, HFS_FILE), 'utf8'); } catch { throw new DesktopRefusal('DESKTOP_NOT_AN_APP', `no ${HFS_FILE} here: run starci app desktop at the app root`); }
  try {
    const json = JSON.parse(text);
    if (json?.kind !== 'app' || json.sides === null || typeof json.sides !== 'object') throw new Error('not an app');
    return { text, json };
  } catch { throw new DesktopRefusal('DESKTOP_NOT_AN_APP', `${HFS_FILE} is not the declaration of an app`); }
}

/** The declared desktop app, or the refusal of a verb whose side the project does not declare. */
function requireDesktop(root: string, what: string): DesktopDeclaration {
  const declaration = desktopOf(readDeclaration(root).json.sides);
  if (declaration === undefined) throw new SideRefusal(`${what} works on the desktop side, which hfs.json does not declare; \`starci app desktop init --name ... --identifier ... --origin https://...\` declares it (PROJECT-DESKTOP-1)`);
  return declaration;
}

/** hfs.json `text` with `"desktop": <block>` as the last entry of its `sides` object, every other byte kept; null when `sides` is not one block object the edit can find. */
export function withDesktopSide(text: string, block: Record<string, unknown>): string | null {
  const lines = text.split(/(?<=\n)/u);
  const open = lines.findIndex((line) => /^\s*"sides":\s*\{\s*$/u.test(line));
  if (open < 0) return null;
  const indent = /^\s*/u.exec(lines[open] ?? '')?.[0] ?? '';
  const close = lines.findIndex((line, index) => index > open && line.startsWith(`${indent}}`));
  if (close < 1) return null;
  const last = lines[close - 1] ?? '';
  const newline = last.endsWith('\r\n') ? '\r\n' : '\n';
  const inner = /^\s*/u.exec(last)?.[0] ?? '';
  const body = JSON.stringify(block, null, 2).split('\n').map((line, index) => (index === 0 ? line : `${inner}${line}`)).join(newline);
  lines.splice(close - 1, 1, `${last.replace(/\r?\n$/u, '')},${newline}`, `${inner}"desktop": ${body}${newline}`);
  return lines.join('');
}

const quoteYaml = (text: string): string => JSON.stringify(text);

/** The block of ci.secrets items a desktop app adds (the names its release workflow reads), those `existing` names left out. */
export function ciSecretBlock(existing: ReadonlySet<string>): string {
  return DESKTOP_CI_SECRETS.filter(({ name }) => !existing.has(name)).map(({ name, purpose }) => `- {name: ${name}, scope: repository, purpose: ${quoteYaml(purpose)}, optional: true}`).join('\n');
}

/** The stack declaration text with the desktop CI secrets added under ci.secrets; null (with the note why) when the file has no ci block to add them to. */
export function withCiSecrets(text: string): { text: string; added: number; note?: string } {
  const doc = parseYaml(text) as { ci?: { secrets?: Array<{ name?: unknown }> } } | null;
  if (doc?.ci === undefined || doc.ci === null || typeof doc.ci !== 'object') return { text, added: 0, note: `${STACK_FILE} declares no ci block: declare ci.secrets with ${DESKTOP_CI_SECRETS.map(({ name }) => name).join(', ')} (scope repository, optional), the names the release workflow reads` };
  const have = new Set((doc.ci.secrets ?? []).map((entry) => String(entry?.name)));
  const block = ciSecretBlock(have);
  if (block === '') return { text, added: 0 };
  const added = DESKTOP_CI_SECRETS.filter(({ name }) => !have.has(name)).length;
  const edit = new YamlBlockEdit(text, STACK_FILE);
  if (doc.ci.secrets === undefined) edit.append(['ci'], `secrets:\n${block.split('\n').map((line) => `  ${line}`).join('\n')}`);
  else if (doc.ci.secrets.length === 0) edit.fill(['ci', 'secrets'], block);
  else edit.append(['ci', 'secrets'], block);
  const list = (edit.value as { ci: { secrets?: unknown[] } }).ci;
  const items = DESKTOP_CI_SECRETS.filter(({ name }) => !have.has(name)).map(({ name, purpose }) => ({ name, scope: 'repository', purpose, optional: true }));
  list.secrets = [...(list.secrets ?? []), ...items];
  return { text: edit.text(), added };
}

/** The `sides.desktop` block `init` writes from its flags, and the problems of it. */
export function initBlock(parsed: Parsed_, feApps: readonly string[]): { block: Record<string, unknown>; problems: string[] } {
  const v = parsed.values;
  const app = v['--app'] ?? (feApps.length === 1 ? feApps[0] : undefined);
  const repo = v['--repo'];
  const pubkey = v['--updater-pubkey'];
  // --repo names the GitHub Release manifest of the updater once there is a public key; without one it only says where the release lives.
  const endpoint = v['--updater-endpoint'] ?? (repo === undefined || pubkey === undefined ? undefined : `https://github.com/${repo}/releases/latest/download/latest.json`);
  const problems: string[] = [];
  for (const required of ['--name', '--identifier', '--origin']) if (v[required] === undefined) problems.push(`init needs ${required}`);
  if (app === undefined) problems.push(feApps.length === 0 ? 'the project declares no fe app for the shell to wrap: declare sides.fe first' : `init needs --app (${feApps.join(', ')})`);
  if ((pubkey === undefined) !== (endpoint === undefined)) problems.push('the updater needs both its public key (--updater-pubkey) and its manifest URL (--updater-endpoint, or --repo <owner/name> for the GitHub Release one); give both or neither');
  const targets = parsed.lists['--target'];
  const block: Record<string, unknown> = {
    app, name: v['--name'], identifier: v['--identifier'], origin: v['--origin'],
    ...(v['--dev-origin'] === undefined ? {} : { devOrigin: v['--dev-origin'] }),
    ...(parsed.lists['--allowed-origin'] === undefined ? {} : { allowedOrigins: parsed.lists['--allowed-origin'] }),
    ...(parsed.lists['--scheme'] === undefined ? {} : { schemes: parsed.lists['--scheme'] }),
    ...(targets === undefined ? {} : { targets }),
    ...(pubkey === undefined || endpoint === undefined ? {} : { updater: { pubkey, endpoint } }),
  };
  if (problems.length === 0) problems.push(...desktopSideProblems(block, feApps));
  return { block, problems };
}

/** The formatter of the app, or undefined when it has none installed. */
const formatterOf = (root: string, given: Prettier | undefined): Prettier | undefined => { if (given !== undefined) return given; try { return loadPrettier(root); } catch { return undefined; } };

async function initMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam): Promise<number> {
  const root = io.cwd;
  const parsed = parse('init', argv);
  const { text, json } = readDeclaration(root);
  if (Object.hasOwn(json.sides, DESKTOP_SIDE)) throw new DesktopRefusal('DESKTOP_ALREADY_DECLARED', `${HFS_FILE} already declares sides.desktop: edit it there, then run \`npx starci app sync --execute\``);
  const { block, problems } = initBlock(parsed, feAppNames(json.sides));
  if (problems.length > 0) throw new DesktopRefusal('DESKTOP_DECLARATION_INVALID', problems.join('\n'));
  const edited = withDesktopSide(text, block);
  if (edited === null) throw new DesktopRefusal('DESKTOP_DECLARATION_SHAPE', `${HFS_FILE} writes sides in a shape the declaration cannot be added to; add "desktop": ${JSON.stringify(block)} under sides by hand`);
  fs.writeFileSync(path.join(root, HFS_FILE), edited);
  const touched = [HFS_FILE];
  const stackFile = path.join(root, STACK_FILE);
  if (fs.existsSync(stackFile)) {
    const secrets = withCiSecrets(fs.readFileSync(stackFile, 'utf8'));
    if (secrets.added > 0) { fs.writeFileSync(stackFile, secrets.text); io.stdout(`updated ${STACK_FILE}: ${secrets.added} CI secret name${secrets.added === 1 ? '' : 's'} the release workflow reads (all optional)\n`); }
    if (secrets.note !== undefined) io.stdout(`owner step: ${secrets.note}\n`);
  }
  const formatter = formatterOf(root, io.prettier);
  if (formatter !== undefined) await formatFiles({ repoRoot: root, files: touched, prettier: formatter });
  io.stdout(`updated ${HFS_FILE}: sides.desktop\n`);
  const synced = await (seam.sync ?? defaultSync)(io);
  if (synced !== 0) return synced;
  io.stdout([
    'starci app desktop init: declared. What is left is yours:',
    `  owner step: make the icons: \`cargo tauri icon <1024px-source.png>\` in ${TAURI_DIR} (writes ${TAURI_DIR}/icons/), then commit them`,
    '  owner step: for updates, `starci app desktop keygen --out <file outside the repo>`, put the public key in sides.desktop.updater.pubkey and set TAURI_SIGNING_PRIVATE_KEY with `starci app ci secret set TAURI_SIGNING_PRIVATE_KEY --execute`',
    '  owner step: to sign the macOS app, set APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID the same way (an unset one builds an unsigned app)',
    `  then: tag v<version of package.json> and the desktop-release workflow builds every system (contexts/project/desktop.md)\n`,
  ].join('\n'));
  return 0;
}

async function defaultSync(io: DesktopIo): Promise<number> {
  const { main } = await import('../sync/cli.mjs');
  return (main as (argv: string[], io: unknown) => Promise<number> | number)(['sync', '--execute'], io);
}

/** One tool's probe: its first output line, or null when it is absent or fails. */
function probeLine(seam: DesktopSeam, command: string, args: readonly string[]): string | null {
  try {
    const result = (seam.probe ?? defaultProbe)(command, args);
    return result.status === 0 ? (result.stdout.split(/\r?\n/u).find((line) => line.trim() !== '') ?? '').trim() : null;
  } catch { return null; }
}
const defaultProbe = (command: string, args: readonly string[]): Spawned => {
  const run = spawnSync(command, [...args], { encoding: 'utf8', windowsHide: true, timeout: 20_000, shell: false });
  return { status: run.error === undefined ? run.status : null, stdout: String(run.stdout ?? '') };
};

/** What this machine has of the toolchain: the version line of each tool, null when missing. */
export interface Toolchain { readonly rustc: string | null; readonly cargo: string | null; readonly tauri: string | null }
export function probeToolchain(seam: DesktopSeam = {}): Toolchain {
  return { rustc: probeLine(seam, 'rustc', ['--version']), cargo: probeLine(seam, 'cargo', ['--version']), tauri: probeLine(seam, 'cargo', ['tauri', '--version']) };
}

const HOST: Readonly<Record<string, string>> = Object.freeze({ darwin: 'macos', win32: 'windows', linux: 'linux' });
const HOST_HINT: Readonly<Record<string, string>> = Object.freeze({
  macos: 'macOS: `xcode-select --install`, then rustup (https://rustup.rs)',
  windows: 'Windows: the Visual Studio Build Tools (Desktop development with C++) and rustup (https://rustup.rs); WebView2 ships with Windows 11',
  linux: 'Linux: libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf, and rustup (https://rustup.rs)',
});

function doctorMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam): number {
  const parsed = parse('doctor', argv);
  const tools = probeToolchain(seam);
  const host = HOST[io.platform ?? process.platform] ?? 'linux';
  const tauriOk = tools.tauri !== null && tools.tauri.includes(TAURI_CLI_VERSION);
  const ok = tools.rustc !== null && tools.cargo !== null && tools.tauri !== null;
  if (parsed.booleans.has('--json')) { io.stdout(`${JSON.stringify({ host, ...tools, expectedTauriCli: TAURI_CLI_VERSION, ok }, null, 2)}\n`); return ok ? 0 : 1; }
  const line = (name: string, value: string | null, hint: string): string => `  ${value === null ? 'missing' : 'ok     '}  ${name}${value === null ? `: ${hint}` : `: ${value}`}\n`;
  io.stdout(`starci app desktop doctor (${host}):\n`);
  io.stdout(line('rustc', tools.rustc, HOST_HINT[host] as string));
  io.stdout(line('cargo', tools.cargo, 'comes with rustup'));
  io.stdout(line('tauri-cli', tools.tauri, `\`cargo install tauri-cli --version "=${TAURI_CLI_VERSION}" --locked\``));
  if (tools.tauri !== null && !tauriOk) io.stdout(`  note    the release workflow builds with tauri-cli ${TAURI_CLI_VERSION}; \`cargo install tauri-cli --version "=${TAURI_CLI_VERSION}" --locked\` matches it\n`);
  io.stdout(ok ? 'this machine can build the desktop app.\n' : 'this machine cannot build the desktop app; CI can: a v<version> tag runs .github/workflows/desktop-release.yml on every system.\n');
  return ok ? 0 : 1;
}

/** The Rust target a `--target` names on this host, undefined for the host's own default; a refusal for an operating system this host cannot build. */
export function resolveTarget(target: string | undefined, host: string, declared: readonly string[]): { os: string; triple: string | undefined } {
  const NAMED: Readonly<Record<string, { os: string; triple: string | undefined }>> = {
    macos: { os: 'macos', triple: 'universal-apple-darwin' }, 'macos-arm64': { os: 'macos', triple: 'aarch64-apple-darwin' }, 'macos-x64': { os: 'macos', triple: 'x86_64-apple-darwin' },
    windows: { os: 'windows', triple: undefined }, 'windows-arm64': { os: 'windows', triple: 'aarch64-pc-windows-msvc' },
    linux: { os: 'linux', triple: undefined }, 'linux-arm64': { os: 'linux', triple: 'aarch64-unknown-linux-gnu' },
  };
  const wanted = target ?? host;
  const named = NAMED[wanted];
  const resolved = named ?? (/^[a-z0-9_]+-[a-z0-9_]+-[a-z0-9_-]+$/u.test(wanted) ? { os: wanted.includes('apple') ? 'macos' : wanted.includes('windows') ? 'windows' : 'linux', triple: wanted } : undefined);
  if (resolved === undefined) throw new DesktopRefusal('DESKTOP_TARGET_UNKNOWN', `--target ${wanted} is not ${Object.keys(NAMED).join(', ')} or a Rust target triple`);
  if (!declared.includes(resolved.os)) throw new DesktopRefusal('DESKTOP_TARGET_UNDECLARED', `--target ${wanted} builds for ${resolved.os}, which sides.desktop.targets (${declared.join(', ')}) does not declare`);
  if (resolved.os !== host) throw new DesktopRefusal('DESKTOP_TARGET_HOST', `--target ${wanted} builds for ${resolved.os}, but this machine is ${host}: an installer is built on its own operating system; the release workflow builds each one on a runner of its own`);
  return resolved;
}

function toolchainRefusal(tools: Toolchain, host: string): DesktopRefusal {
  const missing = [tools.rustc === null ? 'rustc' : '', tools.cargo === null ? 'cargo' : '', tools.tauri === null ? 'cargo-tauri' : ''].filter(Boolean);
  return new DesktopRefusal('DESKTOP_TOOLCHAIN_MISSING', `building the desktop app needs the Rust toolchain; missing here: ${missing.join(', ')} (${HOST_HINT[host] as string}; then \`cargo install tauri-cli --version "=${TAURI_CLI_VERSION}" --locked\`). \`starci app desktop doctor\` lists what is there. The checks never need Rust: CI builds the installers when a v<version> tag is pushed`);
}

const defaultStream = (command: string, args: readonly string[], { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }): number => spawnSync(command, [...args], { cwd, env, stdio: 'inherit', windowsHide: true }).status ?? 1;

/** The `cargo tauri build` arguments for a declaration: the target, debug, bundles, and the override that drops the updater artifacts when no signing key is at hand. */
export function buildArguments({ declaration, triple, debug, bundles, keyPresent }: { declaration: DesktopDeclaration; triple: string | undefined; debug: boolean; bundles: string | undefined; keyPresent: boolean }): { args: string[]; notices: string[] } {
  const notices: string[] = [];
  const args = ['tauri', 'build', ...(triple === undefined ? [] : ['--target', triple]), ...(debug ? ['--debug'] : []), ...(bundles === undefined ? [] : ['--bundles', bundles])];
  if (declaration.updater !== undefined && !keyPresent) {
    args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
    notices.push('TAURI_SIGNING_PRIVATE_KEY is not set: this build makes no signed update bundle (the release workflow does, with the CI secret)');
  }
  return { args, notices };
}

function buildMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam): number {
  const parsed = parse('build', argv);
  const root = io.cwd;
  const declaration = requireDesktop(root, 'starci app desktop build');
  const host = HOST[io.platform ?? process.platform] ?? 'linux';
  const { triple } = resolveTarget(parsed.values['--target'], host, declaration.targets);
  if (!fs.existsSync(path.join(root, TAURI_CONFIG_FILE))) throw new DesktopRefusal('DESKTOP_NOT_RENDERED', `${TAURI_CONFIG_FILE} does not exist: run \`npx starci app sync --execute\` to render the desktop files`);
  const tools = probeToolchain(seam);
  if (tools.rustc === null || tools.cargo === null || tools.tauri === null) throw toolchainRefusal(tools, host);
  const env = io.env ?? process.env;
  const { args, notices } = buildArguments({ declaration, triple, debug: parsed.booleans.has('--debug'), bundles: parsed.values['--bundles'], keyPresent: (env.TAURI_SIGNING_PRIVATE_KEY ?? '') !== '' });
  for (const notice of notices) io.stderr(`starci app desktop build: ${notice}\n`);
  const code = (seam.stream ?? defaultStream)('cargo', args, { cwd: path.join(root, DESKTOP_DIR), env: { ...env } });
  if (code === 0) io.stdout(`starci app desktop build: the installers are in ${TAURI_DIR}/target/${triple === undefined ? '' : `${triple}/`}${parsed.booleans.has('--debug') ? 'debug' : 'release'}/bundle/\n`);
  return code;
}

function devMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam): number {
  parse('dev', argv);
  const root = io.cwd;
  const declaration = requireDesktop(root, 'starci app desktop dev');
  const host = HOST[io.platform ?? process.platform] ?? 'linux';
  const tools = probeToolchain(seam);
  if (tools.rustc === null || tools.cargo === null || tools.tauri === null) throw toolchainRefusal(tools, host);
  io.stderr(`starci app desktop dev: the window loads ${declaration.devOrigin}; start the web app first (starci app stack up --env local)\n`);
  return (seam.stream ?? defaultStream)('cargo', ['tauri', 'dev'], { cwd: path.join(root, DESKTOP_DIR), env: { ...(io.env ?? process.env) } });
}

function keygenMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam): number {
  const parsed = parse('keygen', argv);
  const out = parsed.values['--out'];
  if (out === undefined) throw new DesktopRefusal('DESKTOP_USAGE', 'keygen needs --out <file>: the private key is written there, outside the repository');
  const target = path.resolve(io.cwd, out);
  const inside = path.relative(io.cwd, target);
  if (inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside))) throw new DesktopRefusal('DESKTOP_KEY_INSIDE_REPO', `--out ${out} is inside the repository: a signing key is never a tracked file; write it somewhere outside (the key store of the machine, a secrets folder), then set it as a CI secret`);
  if (fs.existsSync(target)) throw new DesktopRefusal('DESKTOP_KEY_EXISTS', `${target} exists: a key is never overwritten`);
  const tools = probeToolchain(seam);
  if (tools.cargo === null || tools.tauri === null) throw toolchainRefusal(tools, HOST[io.platform ?? process.platform] ?? 'linux');
  const code = (seam.stream ?? defaultStream)('cargo', ['tauri', 'signer', 'generate', '--write-keys', target], { cwd: io.cwd, env: { ...(io.env ?? process.env) } });
  if (code === 0) {
    io.stdout([
      `starci app desktop keygen: wrote ${target} (private) and ${target}.pub (public).`,
      '  1. put the CONTENT of the .pub file in hfs.json sides.desktop.updater.pubkey, then `npx starci app sync --execute`',
      `  2. set the CI secret from the private file: \`starci app ci secret set TAURI_SIGNING_PRIVATE_KEY --execute\` (the value on stdin), and TAURI_SIGNING_PRIVATE_KEY_PASSWORD if you gave it a password`,
      '  3. keep a copy of the private key in the owner\'s password manager: an app signed with a lost key can never be updated, its users reinstall\n',
    ].join('\n'));
  }
  return code;
}

/** `starci app desktop <action>`. */
export async function desktopMain(argv: readonly string[], io: DesktopIo, seam: DesktopSeam = {}): Promise<number> {
  const [action, ...rest] = argv;
  if (action === undefined || !DESKTOP_ACTIONS.includes(action)) throw new DesktopRefusal('DESKTOP_USAGE', `starci app desktop takes ${DESKTOP_ACTIONS.join(', ')}\n${DESKTOP_USAGE.join('\n')}`);
  if (action === 'init') return initMain(rest, io, seam);
  if (action === 'doctor') return doctorMain(rest, io, seam);
  if (action === 'build') return buildMain(rest, io, seam);
  if (action === 'dev') return devMain(rest, io, seam);
  return keygenMain(rest, io, seam);
}

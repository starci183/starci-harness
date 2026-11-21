/** The desktop app a project declares (PROJECT-DESKTOP-1): `sides.desktop` in hfs.json, its managed files and the `starci app desktop` verb. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { DESKTOP_CI_SECRETS, TAURI_CLI_VERSION, TAURI_ICONS, crateName, desktopOf, desktopSideProblems, originOf, tauriConfig, tauriConfigText, type DesktopDeclaration } from '../runtime/scripts/hfs/desktop-side.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { declaredAppSides, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { ciSecretBlock, buildArguments, desktopMain, initBlock, probeToolchain, resolveTarget, withCiSecrets, withDesktopSide, DESKTOP_USAGE, DesktopRefusal, type DesktopSeam } from '../desktop/cli.mjs';
import { cargoToml, desktopVariables, indexHtml, libRs, releaseMatrix } from '../sync/desktop.mjs';
import { renderTargets, type AppSourceFacts } from '../sync/index.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: hfs.json declarations are JSON trees the assertions build and judge.
type Json = any;
const manifest = loadSlotManifest();
const BE = { apps: [{ name: 'api', kind: 'api', contract: 'rest' }], kinds: ['api'] };
const FE = { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] };
const PUBKEY = `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDEyMzQ1Njc4${'A'.repeat(40)}`;
const DESKTOP = { app: 'web', name: 'NIVO', identifier: 'vn.nivo.desktop', origin: 'https://app.nivo.vn' };
const FULL = { ...DESKTOP, devOrigin: 'http://localhost:3100', allowedOrigins: ['https://accounts.google.com'], schemes: ['nivo'], targets: ['macos', 'linux'], updater: { pubkey: PUBKEY, endpoint: 'https://github.com/nivo/nivo/releases/latest/download/latest.json' } };
const declarationOf = (sides: Json) => ({ hfs: manifest.major, kind: 'app', project: 'demo', sides });
const declare = (sides: Json) => resolveRepoDeclaration(manifest, declarationOf(sides));
const declared = (raw: Json): DesktopDeclaration => desktopOf({ fe: FE, desktop: raw }) as DesktopDeclaration;

test('the declaration: sides.desktop is a Tauri shell around one fe app, with an https origin, a reverse-DNS identifier and optional origins, schemes, targets and updater', () => {
  assert.deepEqual(desktopSideProblems(DESKTOP, ['web']), []);
  assert.deepEqual(desktopSideProblems(FULL, ['web']), []);
  assert.deepEqual(declarationShapeProblems(declarationOf({ be: BE, fe: FE, desktop: FULL }), ['be', 'fe']), []);
  for (const [value, words] of [
    [{ ...DESKTOP, app: 'admin' }, /names admin, which is not an app of sides\.fe\.apps \(web\)/],
    [{ ...DESKTOP, name: '' }, /name must be the product name/],
    [{ ...DESKTOP, identifier: 'nivo' }, /reverse-DNS/],
    [{ ...DESKTOP, identifier: 'vn.nivo.app' }, /must not end in \.app/],
    [{ ...DESKTOP, origin: 'http://app.nivo.vn' }, /origin must be https/],
    [{ ...DESKTOP, origin: 'https://app.nivo.vn/' }, /origin must be an origin/],
    [{ ...DESKTOP, origin: 'https://localhost:3000' }, /not a local host/],
    [{ ...DESKTOP, devOrigin: 'https://example.com' }, /devOrigin must be a local host/],
    [{ ...DESKTOP, allowedOrigins: ['http://a.com'] }, /allowedOrigins\[0\] must be an https origin/],
    [{ ...DESKTOP, allowedOrigins: ['https://*.a.com'] }, /allowedOrigins\[0\] must be an https origin/],
    [{ ...DESKTOP, allowedOrigins: ['https://app.nivo.vn'] }, /repeats origin/],
    [{ ...DESKTOP, schemes: ['https'] }, /keeps for itself/],
    [{ ...DESKTOP, schemes: ['Nivo'] }, /lowercase URL scheme/],
    [{ ...DESKTOP, targets: ['android'] }, /targets must be a non-empty unique list/],
    [{ ...DESKTOP, targets: [] }, /targets must be a non-empty unique list/],
    [{ ...DESKTOP, updater: { pubkey: 'x', endpoint: 'https://a.com/latest.json' } }, /updater\.pubkey must be the public key/],
    [{ ...DESKTOP, updater: { pubkey: PUBKEY, endpoint: 'http://a.com/latest.json' } }, /updater\.endpoint must be an https URL/],
    [{ ...DESKTOP, updater: { pubkey: PUBKEY, endpoint: 'https://a.com/latest.json', extra: 1 } }, /updater has unknown key extra/],
    [{ ...DESKTOP, other: 1 }, /unknown key other/],
    ['nivo', /must be an object/],
  ] as Array<[Json, RegExp]>) assert.match(desktopSideProblems(value, ['web']).join('\n'), words);
  assert.match(desktopSideProblems(DESKTOP, []).join('\n'), /declares no fe side with an app/);
  assert.match(declarationShapeProblems(declarationOf({ be: BE, desktop: DESKTOP }), ['be', 'fe']).join('\n'), /declares no fe side with an app/, 'a desktop app needs the fe side it wraps');
  assert.deepEqual([originOf('https://app.nivo.vn'), originOf('http://localhost:3000'), originOf('https://a.com:70000'), originOf('ftp://a.com')], [{ scheme: 'https', host: 'app.nivo.vn' }, { scheme: 'http', host: 'localhost' }, null, null]);
});

test('the declaration resolves: defaults applied, the app view carries it, and no folder side is added or required', () => {
  const view = declare({ be: BE, fe: FE, desktop: DESKTOP });
  assert.deepEqual(view.desktop, { app: 'web', name: 'NIVO', identifier: 'vn.nivo.desktop', origin: 'https://app.nivo.vn', devOrigin: 'http://localhost:3000', allowedOrigins: [], schemes: [], targets: ['macos', 'windows', 'linux'] });
  assert.deepEqual(view.declaredSides, ['be', 'fe'], 'the desktop app is a declaration with a folder of its own, not a fourth PROJECT_SIDE');
  assert.deepEqual(declaredAppSides(view), ['be', 'fe']);
  assert.equal(declare({ be: BE, fe: FE }).desktop, undefined);
  assert.deepEqual(declared(FULL).targets, ['macos', 'linux'], 'targets keep the canonical order');
  assert.equal(declared(FULL).updater?.pubkey, PUBKEY);
  assert.equal(desktopOf({ fe: FE, desktop: { ...DESKTOP, origin: 'http://x.com' } }), undefined, 'a malformed declaration resolves to none; the shape check reports it');
  assert.throws(() => declare({ be: BE, fe: FE, desktop: { ...DESKTOP, identifier: 'x' } }), /reverse-DNS/);
});

test('the config: tauri.conf.json is rendered from the declaration, reads the version from the app, creates no window and keeps the shell isolated', () => {
  const conf = tauriConfig(declared(FULL)) as Json;
  assert.equal(conf.identifier, 'vn.nivo.desktop');
  assert.equal(conf.version, '../../package.json');
  assert.deepEqual(conf.app.windows, []);
  assert.equal(conf.app.withGlobalTauri, false);
  assert.equal(conf.build.devUrl, 'http://localhost:3100');
  assert.equal(conf.build.frontendDist, '../frontend');
  assert.deepEqual(conf.plugins['deep-link'], { desktop: { schemes: ['nivo'] } });
  assert.deepEqual(conf.plugins.updater, { pubkey: PUBKEY, endpoints: ['https://github.com/nivo/nivo/releases/latest/download/latest.json'], windows: { installMode: 'passive' } });
  assert.equal(conf.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(conf.bundle.icon, [...TAURI_ICONS]);
  const plain = tauriConfig(declared(DESKTOP)) as Json;
  assert.deepEqual(plain.plugins, {}, 'no schemes and no updater: no plugin config');
  assert.equal(plain.bundle.createUpdaterArtifacts, undefined);
  assert.ok(tauriConfigText(declared(DESKTOP)).endsWith('}\n'));
});

function tree(t: Pick<import('node:test').TestContext, 'after'>, files: Record<string, string>): { root: string; all: string[] } {
  const root = mkdtemp(t, 'starci-desktop-');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, all: Object.keys(files) };
}

const PRESETS = { sonarExclusions: '**/*.spec.ts' };
const STACK = { images: [], passEnv: [], imageEnvironments: {}, environments: [], imageCache: 'gha' };
const source = { files: [], read: () => '', rootPackages: [], packageScopes: {}, stack: STACK, hasImage: () => true } as unknown as AppSourceFacts;
const rendered = (sides: Json) => {
  const targets = renderTargets(declarationOf(sides), PRESETS, { source });
  return { paths: targets.map((target) => target.path), text: (file: string): string => targets.find((target) => target.path === file)?.content ?? '' };
};
const DESKTOP_FILES = ['desktop/frontend/index.html', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/build.rs', 'desktop/src-tauri/tauri.conf.json', 'desktop/src-tauri/src/main.rs', 'desktop/src-tauri/src/lib.rs', '.github/workflows/desktop-release.yml'];

test('sync: a project that declares the desktop app renders its files from the declaration, and one that does not renders none and no empty line', () => {
  const on = rendered({ be: BE, fe: FE, desktop: FULL });
  for (const file of DESKTOP_FILES) assert.ok(on.paths.includes(file), `${file} is rendered`);
  assert.equal(on.text('desktop/src-tauri/tauri.conf.json').trimEnd(), tauriConfigText(declared(FULL)).trimEnd());
  assert.match(on.text('desktop/src-tauri/src/lib.rs'), /const ORIGIN: &str = "https:\/\/app\.nivo\.vn";/);
  assert.match(on.text('desktop/src-tauri/Cargo.toml'), /name = "nivo-desktop"/);
  assert.match(on.text('.prettierignore'), /^desktop\/$/mu, 'prettier leaves the rendered shell alone');
  assert.match(on.text('.gitignore'), /desktop\/src-tauri\/target\/\ndesktop\/src-tauri\/gen\//);
  const off = rendered({ be: BE, fe: FE });
  for (const file of DESKTOP_FILES) assert.equal(off.paths.includes(file), false, `${file} is not rendered without the declaration`);
  assert.doesNotMatch(off.text('.prettierignore'), /desktop/);
  assert.doesNotMatch(off.text('.gitignore'), /desktop|src-tauri/);
});

test('the release workflow: tag-triggered, one matrix entry per declared system, a draft release opened last, every secret read by name and none committed', () => {
  const on = rendered({ be: BE, fe: FE, desktop: FULL }).text('.github/workflows/desktop-release.yml');
  assert.match(on, /tags:\n\s+- "v\*"/);
  assert.match(on, /- label: macos\n\s+os: macos-latest\n\s+args: "--target universal-apple-darwin"/);
  assert.match(on, /- label: linux\n\s+os: ubuntu-22\.04/);
  assert.doesNotMatch(on, /label: windows/, 'only the declared targets build');
  assert.match(on, /uploadUpdaterJson: true/);
  assert.match(on, /cargo install tauri-cli --version "=2\.\d+\.\d+" --locked/);
  assert.ok(on.includes(`--version "=${TAURI_CLI_VERSION}"`));
  assert.match(on, /releaseDraft: true/);
  assert.match(on, /gh release edit "\$TAG" --repo "\$REPOSITORY" --draft=false/);
  for (const { name } of DESKTOP_CI_SECRETS) assert.ok(on.includes(`${name}: \${{ secrets.${name} }}`), `${name} is read as a secret`);
  assert.doesNotMatch(on, /dW50cnVzdGVkIGNvbW1lbnQ6|BEGIN [A-Z ]*PRIVATE KEY/u, 'no key material in the workflow');
  for (const line of on.split('\n').filter((l) => l.includes('uses:'))) assert.match(line, /@[0-9a-f]{40} # /, `${line.trim()} is pinned by commit`);
  assert.match(rendered({ be: BE, fe: FE, desktop: DESKTOP }).text('.github/workflows/desktop-release.yml'), /uploadUpdaterJson: false/);
  assert.match(releaseMatrix(declared(DESKTOP)), /label: windows/);
});

test('the shell: the Rust navigates only to the declared origins, opens the rest in the system browser and carries a deep link and the updater only when declared', () => {
  const full = libRs(declared(FULL), '# Generated by starci app sync.');
  assert.match(full, /^\/\/ Generated by starci app sync\.$/mu);
  assert.match(full, /const DEV_ORIGIN: &str = "http:\/\/localhost:3100";/);
  assert.match(full, /"https:\/\/accounts\.google\.com",/);
  assert.match(full, /const SCHEMES: &\[&str\] = &\[\n {4}"nivo",\n\];/);
  assert.match(full, /\.on_navigation\(move \|url\| \{/);
  assert.match(full, /opener\(\)\.open_url\(url\.as_str\(\), None::<&str>\)/);
  assert.match(full, /fn open_deep_link/);
  assert.match(full, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(full, /check_for_update\(app\.handle\(\)\.clone\(\)\);/);
  assert.doesNotMatch(full, /capabilit|invoke_handler/u, 'no command is exposed to the page');
  const plain = libRs(declared(DESKTOP), '# Generated.');
  assert.doesNotMatch(plain, /deep_link|SCHEMES|updater|check_for_update/u);
  assert.match(cargoToml(declared(FULL), '# h'), /tauri-plugin-updater = "2"\n/);
  assert.match(cargoToml(declared(FULL), '# h'), /tauri-plugin-deep-link = "2"/);
  assert.doesNotMatch(cargoToml(declared(DESKTOP), '# h'), /tauri-plugin-(?:updater|deep-link)/);
  assert.equal(/\n{3,}/u.test(cargoToml(declared(DESKTOP), '# h')), false);
  assert.match(indexHtml({ ...declared(DESKTOP), name: 'A & B' }), /<title>A &amp; B<\/title>/);
  assert.equal(crateName({ name: 'My App!' }), 'my-app-desktop');
  assert.equal(desktopVariables({}, '#').desktopTauriConfig, '', 'no declaration, no variable');
});

test('init: the block comes from the flags, goes into hfs.json as the last entry of sides and its CI secret names into ci.secrets', () => {
  const parse = (values: Record<string, string>, lists: Record<string, string[]> = {}) => ({ values, lists, booleans: new Set<string>() });
  const ok = initBlock(parse({ '--name': 'NIVO', '--identifier': 'vn.nivo.desktop', '--origin': 'https://app.nivo.vn', '--repo': 'nivo/nivo', '--updater-pubkey': PUBKEY }, { '--scheme': ['nivo'] }), ['web']);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.block, { app: 'web', name: 'NIVO', identifier: 'vn.nivo.desktop', origin: 'https://app.nivo.vn', schemes: ['nivo'], updater: { pubkey: PUBKEY, endpoint: 'https://github.com/nivo/nivo/releases/latest/download/latest.json' } });
  assert.match(initBlock(parse({}), ['web']).problems.join('\n'), /init needs --name/);
  assert.match(initBlock(parse({ '--name': 'N', '--identifier': 'vn.n.d', '--origin': 'https://a.vn', '--updater-pubkey': PUBKEY }), ['web']).problems.join('\n'), /give both or neither/);
  assert.match(initBlock(parse({ '--name': 'N', '--identifier': 'vn.n.d', '--origin': 'https://a.vn' }), ['web', 'admin']).problems.join('\n'), /init needs --app \(web, admin\)/);
  assert.match(initBlock(parse({ '--name': 'N', '--identifier': 'vn.n.d', '--origin': 'https://a.vn' }), []).problems.join('\n'), /declares no fe app/);

  const hfs = '{\n  "hfs": 3,\n  "kind": "app",\n  "sides": {\n    "be": {\n      "apps": []\n    },\n    "fe": {\n      "apps": []\n    }\n  }\n}\n';
  const edited = withDesktopSide(hfs, { app: 'web', name: 'NIVO' }) as string;
  const json = JSON.parse(edited);
  assert.deepEqual(Object.keys(json.sides), ['be', 'fe', 'desktop']);
  assert.deepEqual(json.sides.desktop, { app: 'web', name: 'NIVO' });
  assert.match(edited, /\n {4}\},\n {4}"desktop": \{\n {6}"app": "web",/);
  assert.equal(withDesktopSide('{ "sides": { "be": {} } }', {}), null, 'a one-line sides object is left for the owner');

  const stack = 'schema: starci/application-stacks@1\nci:\n  secrets:\n    - {name: SONAR_TOKEN, scope: repository, purpose: "Sonar"}\n  vars: []\nservices: {}\n';
  const out = withCiSecrets(stack);
  assert.equal(out.added, DESKTOP_CI_SECRETS.length);
  const names = ((parseYaml(out.text) as Json).ci.secrets as Array<{ name: string; optional?: boolean }>).map((entry) => entry.name);
  assert.deepEqual(names, ['SONAR_TOKEN', ...DESKTOP_CI_SECRETS.map(({ name }) => name)]);
  assert.ok(((parseYaml(out.text) as Json).ci.secrets as Json[]).slice(1).every((entry) => entry.optional === true && entry.scope === 'repository'));
  assert.equal(withCiSecrets(out.text).added, 0, 'a second run adds nothing');
  assert.match(withCiSecrets('schema: x\nservices: {}\n').note ?? '', /declares no ci block/);
  assert.equal(ciSecretBlock(new Set(DESKTOP_CI_SECRETS.map(({ name }) => name))), '');
  const noSecrets = withCiSecrets('schema: x\nci:\n  vars: []\n');
  assert.equal(((parseYaml(noSecrets.text) as Json).ci.secrets as Json[]).length, DESKTOP_CI_SECRETS.length);
});

const io = (root: string, platform: NodeJS.Platform = 'linux', env: NodeJS.ProcessEnv = {}) => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { cwd: root, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text), env, platform, prettier: undefined } };
};
const TOOLS: DesktopSeam['probe'] = (command, args) => {
  const line = `${command} ${args.join(' ')}`;
  if (line === 'rustc --version') return { status: 0, stdout: 'rustc 1.90.0 (abc 2026-01-01)\n' };
  if (line === 'cargo --version') return { status: 0, stdout: 'cargo 1.90.0\n' };
  if (line === 'cargo tauri --version') return { status: 0, stdout: `tauri-cli ${TAURI_CLI_VERSION}\n` };
  return { status: 1, stdout: '' };
};
const NO_TOOLS: DesktopSeam['probe'] = () => { throw new Error('spawn ENOENT'); };

test('doctor, build and dev: a machine without Rust is told so and never fails a check; with it the build runs cargo tauri in desktop/ for this system only', async (t) => {
  assert.deepEqual(probeToolchain({ probe: NO_TOOLS }), { rustc: null, cargo: null, tauri: null });
  const app = tree(t, { 'hfs.json': JSON.stringify(declarationOf({ be: BE, fe: FE, desktop: FULL })), 'desktop/src-tauri/tauri.conf.json': tauriConfigText(declared(FULL)) });
  const bare = io(app.root);
  assert.equal(await desktopMain(['doctor'], bare.io, { probe: NO_TOOLS }), 1);
  assert.match(bare.out.join(''), /missing {2}rustc: Linux: libwebkit2gtk-4\.1-dev/);
  assert.match(bare.out.join(''), /CI can: a v<version> tag runs/);
  const good = io(app.root);
  assert.equal(await desktopMain(['doctor', '--json'], good.io, { probe: TOOLS }), 0);
  assert.equal(JSON.parse(good.out.join('')).ok, true);

  await assert.rejects(desktopMain(['build'], io(app.root).io, { probe: NO_TOOLS }), (error: DesktopRefusal) => error.code === 'DESKTOP_TOOLCHAIN_MISSING' && /CI builds the installers when a v<version> tag is pushed/.test(error.message));
  const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
  const stream: DesktopSeam['stream'] = (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); return 0; };
  const built = io(app.root, 'darwin');
  assert.equal(await desktopMain(['build', '--target', 'macos-arm64', '--debug'], built.io, { probe: TOOLS, stream }), 0);
  assert.deepEqual(calls[0], { command: 'cargo', args: ['tauri', 'build', '--target', 'aarch64-apple-darwin', '--debug', '--config', '{"bundle":{"createUpdaterArtifacts":false}}'], cwd: path.join(app.root, 'desktop') });
  assert.match(built.err.join(''), /TAURI_SIGNING_PRIVATE_KEY is not set/);
  assert.match(built.out.join(''), /desktop\/src-tauri\/target\/aarch64-apple-darwin\/debug\/bundle\//);
  const signed = io(app.root, 'linux', { TAURI_SIGNING_PRIVATE_KEY: 'k' });
  await desktopMain(['build', '--bundles', 'deb'], signed.io, { probe: TOOLS, stream });
  assert.deepEqual(calls[1]?.args, ['tauri', 'build', '--bundles', 'deb'], 'with the key at hand the update bundle is built too');
  await assert.rejects(desktopMain(['build', '--target', 'windows'], io(app.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_TARGET_UNDECLARED');
  await assert.rejects(desktopMain(['build', '--target', 'macos'], io(app.root, 'linux').io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_TARGET_HOST');
  await assert.rejects(desktopMain(['build', '--target', 'amiga'], io(app.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_TARGET_UNKNOWN');
  await assert.rejects(desktopMain(['build', '--nope'], io(app.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_USAGE');
  assert.equal(await desktopMain(['dev'], io(app.root).io, { probe: TOOLS, stream }), 0);
  assert.deepEqual(calls[2]?.args, ['tauri', 'dev']);
  assert.deepEqual(resolveTarget(undefined, 'linux', ['linux']), { os: 'linux', triple: undefined });
  assert.deepEqual(resolveTarget('x86_64-unknown-linux-gnu', 'linux', ['linux']), { os: 'linux', triple: 'x86_64-unknown-linux-gnu' });
  assert.deepEqual(buildArguments({ declaration: declared(DESKTOP), triple: undefined, debug: false, bundles: undefined, keyPresent: false }), { args: ['tauri', 'build'], notices: [] });

  const plain = tree(t, { 'hfs.json': JSON.stringify(declarationOf({ be: BE, fe: FE })) });
  await assert.rejects(desktopMain(['build'], io(plain.root).io, { probe: TOOLS, stream }), /desktop side, which hfs\.json does not declare/);
  const unrendered = tree(t, { 'hfs.json': JSON.stringify(declarationOf({ be: BE, fe: FE, desktop: DESKTOP })) });
  await assert.rejects(desktopMain(['build'], io(unrendered.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_NOT_RENDERED');
  await assert.rejects(desktopMain(['nope'], io(app.root).io), (error: DesktopRefusal) => error.code === 'DESKTOP_USAGE');
  assert.equal(DESKTOP_USAGE.length, 5);
});

test('keygen writes the key outside the repository only, and init declares then renders', async (t) => {
  const app = tree(t, { 'hfs.json': JSON.stringify(declarationOf({ be: BE, fe: FE }), null, 2), '.starcistacks/application-stacks.yaml': 'schema: x\nci:\n  secrets: []\n' });
  const calls: Array<readonly string[]> = [];
  const stream: DesktopSeam['stream'] = (_command, args) => { calls.push(args); return 0; };
  await assert.rejects(desktopMain(['keygen', '--out', path.join(app.root, 'key')], io(app.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_KEY_INSIDE_REPO');
  await assert.rejects(desktopMain(['keygen'], io(app.root).io, { probe: TOOLS, stream }), (error: DesktopRefusal) => error.code === 'DESKTOP_USAGE');
  const outside = path.join(mkdtemp(t, 'starci-desktop-key-'), 'updater.key');
  const run = io(app.root);
  assert.equal(await desktopMain(['keygen', '--out', outside], run.io, { probe: TOOLS, stream }), 0);
  assert.deepEqual(calls[0], ['tauri', 'signer', 'generate', '--write-keys', outside]);
  assert.match(run.out.join(''), /3\. keep a copy of the private key/);

  let synced = 0;
  const initIo = io(app.root);
  assert.equal(await desktopMain(['init', '--name', 'NIVO', '--identifier', 'vn.nivo.desktop', '--origin', 'https://app.nivo.vn', '--scheme', 'nivo'], initIo.io, { sync: () => { synced += 1; return 0; } }), 0);
  assert.equal(synced, 1);
  const declaration = JSON.parse(fs.readFileSync(path.join(app.root, 'hfs.json'), 'utf8'));
  assert.deepEqual(declaration.sides.desktop, { app: 'web', name: 'NIVO', identifier: 'vn.nivo.desktop', origin: 'https://app.nivo.vn', schemes: ['nivo'] });
  assert.equal(((parseYaml(fs.readFileSync(path.join(app.root, '.starcistacks/application-stacks.yaml'), 'utf8')) as Json).ci.secrets as Json[]).length, DESKTOP_CI_SECRETS.length);
  assert.match(initIo.out.join(''), /owner step: make the icons/);
  await assert.rejects(desktopMain(['init', '--name', 'N', '--identifier', 'a.b', '--origin', 'https://a.vn'], io(app.root).io, { sync: () => 0 }), (error: DesktopRefusal) => error.code === 'DESKTOP_ALREADY_DECLARED');
});

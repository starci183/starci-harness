// nivoos-package-check.mts - the nivoos package check of `starci app check` (R436, contexts/project/business-repo.md PROJECT-BUSINESS-1): for each package
// hfs.json `sides.nivoos.packages` declares, `nivoos package check <entry> --out <out>` run from the package folder with this Node, through the heavy governor
// (a `build` child of the step's parity port). The nivoos CLI type-checks the entry under the package's own tsconfig, loads it, builds the seed document in memory and
// fails when the committed seed document or secrets template differs from that fresh build. It runs inside the `checks` step, beside the project checks
// (cache/project-checks.mts), wherever the hfs gate runs. The check includes the version guard (a cell, graph or agent whose content changed under the same version as the seed on origin/dev is refused,
// the instance's CELLS_VERSION_IMMUTABLE), so it must be what `build:modules` would say. Its verdict is scoped and cached per package (cache/check-verdicts.mts): keyed on the tracked files of the package, of every
// workspace package it and the CLI depend on (the SDK) and the built output of those (dist, untracked), the CLI's version when it is installed from the registry, and the seed the published ref holds for the package
// (`origin/dev:packages/<name>/<out>`). An unchanged key reuses the verdict; a run where the ref cannot be named (not fetched) runs the check and stores nothing.
// The CLI is the package's own dev dependency (`@starci/nivoos-cli`, or the package `nivoos`): resolved from packages/<name>/node_modules, then the app root's, by the `bin` its manifest names. When it is not
// installed the finding says how to add it, and nothing is run.
import fs from 'node:fs';
import path from 'node:path';
import { nivoosPackagesOf, type NivoosPackage } from '../runtime/scripts/hfs/nivoos-side.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { revisionSha, VerdictBook, verdictKey, type VerdictKey } from './check-verdicts.mjs';
import { hashFile } from './hash.mjs';
import { buildPackages, builtPackagesOf } from './built-packages.mjs';
import { toolCacheDir } from './run-log.mjs';
import { launch } from '../stack/local-host.mjs';
import type { CheckSession } from './types.mjs';
import type { ParityRun } from './parity-family.mjs';

/** The finding of a nivoos package whose check failed or could not run. */
export const NIVOOS_PACKAGE_CHECK = 'HFS_NIVOOS_PACKAGE_CHECK';
/** The step of a nivoos package's verdict in the records of check/build. */
export const NIVOOS_PACKAGE_STEP = 'nivoos-package';
/** The ref whose committed seeds count as published: the default of `nivoos package check --published`. */
export const NIVOOS_PUBLISHED_REF = 'origin/dev';
/** The most lines of a red check's output its finding carries. */
const TAIL_LINES = 20;

/** The nivoos packages hfs.json declares at `repoRoot`, defaults applied; none when it declares none or cannot be read (the declaration shape is judged by the hfs structure pass). */
export function declaredNivoosPackages(repoRoot: string): NivoosPackage[] {
  try { return nivoosPackagesOf((JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')) as { sides?: unknown }).sides); } catch { return []; }
}

/** The packages that provide the `nivoos` bin: the published CLI first, then a package named for the bin. */
export const NIVOOS_CLI_PACKAGES: readonly string[] = ['@starci/nivoos-cli', 'nivoos'];

/** The script the `nivoos` bin of one CLI package installed under `modules` (a node_modules folder) names, or null when it is not installed there. */
function binOfPackage(modules: string, name: string): string | null {
  try {
    const folder = path.join(modules, ...name.split('/'));
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['nivoos'];
    if (bin === undefined) return null;
    const file = path.join(folder, bin);
    return fs.existsSync(file) ? file : null;
  } catch { return null; }
}

/** The script the `nivoos` bin of an install at `modules` names, from whichever CLI package provides it; null when the CLI is not installed there. */
function binOf(modules: string): string | null {
  for (const name of NIVOOS_CLI_PACKAGES) {
    const file = binOfPackage(modules, name);
    if (file !== null) return file;
  }
  return null;
}

/** The nivoos CLI script for a package: its own node_modules first, then the app root's; null when neither holds it. */
export function nivoosCli(repoRoot: string, name: string): string | null {
  return binOf(path.join(repoRoot, 'packages', name, 'node_modules')) ?? binOf(path.join(repoRoot, 'node_modules'));
}

/** The Node warnings a `.ts` entry in a package without `"type": "module"` makes the CLI print: noise around the verdict, never part of it. */
const NODE_NOISE = /^(?:\(node:\d+\) |Reparsing as ES module|To eliminate this warning|\(Use `node --trace-warnings)/u;

/** The last TAIL_LINES non-empty lines of a check's output, less the Node warnings, joined. */
const tailOf = (text: string): string => text.split(/\r?\n/u).map((line) => line.trimEnd()).filter((line) => line.trim() !== '' && !NODE_NOISE.test(line)).slice(-TAIL_LINES).join('\n');

const posix = (file: string): string => file.split(path.sep).join('/');

/** The workspace folders (app-relative) a package name resolves to from `from` (its own node_modules, then the app root's) when the link leads into the app, outside node_modules; else null. */
function workspaceFolderOf(repoRoot: string, from: string, name: string): string | null {
  for (const base of [path.join(from, 'node_modules'), path.join(repoRoot, 'node_modules')]) {
    try {
      const real = fs.realpathSync(path.join(base, ...name.split('/')));
      const relative = posix(path.relative(fs.realpathSync(repoRoot), real));
      return relative === '' || relative.startsWith('..') || relative.split('/').includes('node_modules') ? null : relative;
    } catch { /* not installed here */ }
  }
  return null;
}

/** The dependency names of the package.json in `folder` (app-relative), every block. */
function dependenciesOf(repoRoot: string, folder: string): string[] {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, folder, 'package.json'), 'utf8')) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((block) => Object.keys((manifest[block] ?? {}) as Record<string, unknown>));
  } catch { return []; }
}

/** The workspace packages `folder` depends on, transitively (the SDK a CLI loads), app-relative, with `folder` itself first. */
export function workspaceClosure(repoRoot: string, folder: string, extra: readonly string[] = []): string[] {
  const seen = [folder];
  for (let at = 0; at < seen.length && seen.length < 40; at += 1) {
    const current = seen[at] ?? folder;
    for (const name of [...dependenciesOf(repoRoot, current), ...(at === 0 ? extra : [])]) {
      const found = workspaceFolderOf(repoRoot, path.join(repoRoot, current), name);
      if (found !== null && !seen.includes(found)) seen.push(found);
    }
  }
  return seen;
}

/** Every file below `dir` (absolute) as app-relative posix, up to a bound: the built output a workspace package emits, which git does not track. */
function filesBelow(repoRoot: string, dir: string, found: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (found.length >= 4000) break;
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) filesBelow(repoRoot, next, found);
    else found.push(posix(path.relative(repoRoot, next)));
  }
  return found;
}

/** The standalone front-end apps a package ships (`packages/<name>/workbench/<app>/package.json`), app-relative folders. */
export function workbenchFolders(repoRoot: string, name: string): string[] {
  const base = path.join(repoRoot, 'packages', name, 'workbench');
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'package.json'))).map((entry) => `packages/${name}/workbench/${entry.name}`).sort();
  } catch { return []; }
}

/** True when the app at `folder` has its dependencies installed and not older than its lockfile (the stamp `npm ci` leaves is node_modules/.package-lock.json). */
export function workbenchInstalled(repoRoot: string, folder: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, folder, 'package.json'), 'utf8')) as { dependencies?: object; devDependencies?: object };
    if (Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).length === 0) return true; // nothing to install
  } catch { return false; }
  try {
    const stamp = fs.statSync(path.join(repoRoot, folder, 'node_modules', '.package-lock.json')).mtimeMs;
    const lock = path.join(repoRoot, folder, 'package-lock.json');
    return !fs.existsSync(lock) || stamp >= fs.statSync(lock).mtimeMs;
  } catch { return false; }
}

/**
 * Installs the dependencies of every workbench app of a package that lacks them (a fresh worktree has none), with `npm ci --ignore-scripts` through the heavy governor, before the package is judged:
 * the CLI builds the workbench, so a missing install would be a false red. The folders still not installed afterwards (an install that failed), one message each.
 */
export async function ensureWorkbenchInstalls({ repoRoot, name, run, env }: { repoRoot: string; name: string; run: ParityRun; env: NodeJS.ProcessEnv }): Promise<{ folder: string; message: string }[]> {
  const failed: { folder: string; message: string }[] = [];
  for (const folder of workbenchFolders(repoRoot, name)) {
    if (workbenchInstalled(repoRoot, folder)) continue;
    const lock = fs.existsSync(path.join(repoRoot, folder, 'package-lock.json'));
    const [file, args] = launch(process.platform, 'npm', [lock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund']);
    const result = await run({ kind: 'install', label: `app check workbench install ${folder}`, cwd: path.join(repoRoot, folder), argv: [file, ...args], env });
    if (result.error !== undefined || result.status !== 0 || !workbenchInstalled(repoRoot, folder)) failed.push({ folder, message: result.error?.message ?? `npm exit ${String(result.status)}${tailOf(`${result.stdout}
${result.stderr}`) === '' ? '' : `
${tailOf(`${result.stdout}
${result.stderr}`)}`}` });
  }
  return failed;
}

/** The key of one nivoos package's verdict, and whether it may be stored (the published ref was named). */
export function nivoosPackageKey(session: CheckSession, repoRoot: string, entry: NivoosPackage, cli: string): { key: VerdictKey; complete: boolean } {
  const folder = `packages/${entry.name}`;
  const owners = workspaceClosure(repoRoot, folder, NIVOOS_CLI_PACKAGES);
  const extra: Record<string, string> = { '#cli': hashFile(cli) ?? 'absent', '#entry': `${entry.entry}|${entry.out}` };
  // What an installed (registry) CLI or SDK is: its version, since its files are no part of the tracked tree. A workspace one is judged by its tracked files and its built output.
  for (const name of [...NIVOOS_CLI_PACKAGES, '@starci/nivoos-sdk']) {
    try { extra[`pkg:${name}`] = String((JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: unknown }).version); } catch { /* not installed */ }
  }
  for (const owner of owners) for (const file of filesBelow(repoRoot, path.join(repoRoot, owner, 'dist'))) extra[`built:${file}`] = hashFile(path.join(repoRoot, file)) ?? 'absent';
  const published = revisionSha(repoRoot, `${NIVOOS_PUBLISHED_REF}:${folder}/${entry.out}`);
  extra[`ref:${NIVOOS_PUBLISHED_REF}`] = published ?? 'unresolved';
  return { key: verdictKey(session, owners, extra), complete: published !== null };
}

/**
 * Builds the workspace packages the nivoos CLI of the declared packages runs from (the CLI and the SDK it loads: `dist/` is untracked and stale after a source change), by the same
 * stamped build the types step uses (built-packages.mts): a package whose tracked sources are unchanged is not built again. The failures, one message per package that could not be built.
 */
export async function buildNivoosTools({ session, repoRoot, run, env, packages }: { session: CheckSession; repoRoot: string; run: ParityRun; env: NodeJS.ProcessEnv; packages: readonly NivoosPackage[] }): Promise<{ pkg: string; message: string }[]> {
  const closure = new Set(packages.flatMap((entry) => workspaceClosure(repoRoot, `packages/${entry.name}`, NIVOOS_CLI_PACKAGES)));
  const built = builtPackagesOf(repoRoot, session.index.paths).filter((pkg) => closure.has(pkg.dir));
  if (built.length === 0) return [];
  const result = await buildPackages({ session, repoRoot, built, toolCacheDir: toolCacheDir(repoRoot, env), env, run });
  return result.failed.map(({ pkg, message }) => ({ pkg: pkg.dir, message }));
}

/** Runs the check of every declared nivoos package: its findings (one per red package) and one line per package, `nivoos package check <name>: green|red (exit n)`. */
export async function runNivoosPackageChecks({ repoRoot, run, env, session }: { repoRoot: string; run: ParityRun; env: NodeJS.ProcessEnv; session?: CheckSession | undefined }): Promise<{ findings: CheckFinding[]; lines: string[] }> {
  const findings: CheckFinding[] = [];
  const lines: string[] = [];
  const declared = declaredNivoosPackages(repoRoot);
  if (session !== undefined && declared.length > 0) {
    const failed = await buildNivoosTools({ session, repoRoot, run, env, packages: declared });
    for (const { pkg, message } of failed) {
      findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${pkg}/package.json`, message: `the nivoos tools the package checks run from could not be built: ${message}` });
      lines.push(`  nivoos tools ${pkg}: red, not built`);
    }
    if (failed.length > 0) return { findings, lines };
  }
  const book = session === undefined ? undefined : new VerdictBook(session, NIVOOS_PACKAGE_STEP, session.decide('hfs').mode === 'diff');
  for (const entry of declared) {
    const folder = `packages/${entry.name}`;
    const cli = nivoosCli(repoRoot, entry.name);
    if (cli === null) {
      findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${folder}/package.json`, message: `the nivoos CLI is not installed for ${folder}: add "@starci/nivoos-cli" to the devDependencies of ${folder}/package.json (with the nivoos SDK it authors with) and run npm install, then \`nivoos package check ${entry.entry} --out ${entry.out}\` runs here (PROJECT-BUSINESS-1)` });
      lines.push(`  nivoos package check ${entry.name}: red, the nivoos CLI is not installed`);
      continue;
    }
    const notInstalled = await ensureWorkbenchInstalls({ repoRoot, name: entry.name, run, env });
    if (notInstalled.length > 0) {
      // No verdict is judged or stored on a missing install: it would be a false red that the cache then keeps.
      for (const { folder: workbench, message } of notInstalled) findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${workbench}/package.json`, message: `the dependencies of the workbench ${workbench} could not be installed, so nivoos package check ${entry.name} was not judged (nothing is recorded): ${message}` });
      lines.push(`  nivoos package check ${entry.name}: red, the workbench install failed (not judged, not recorded)`);
      continue;
    }
    const keyed = session === undefined ? undefined : nivoosPackageKey(session, repoRoot, entry, cli);
    const recordId = `${NIVOOS_PACKAGE_STEP}/${entry.name}`;
    const held = keyed?.complete === true ? book?.held(recordId, keyed.key) : undefined;
    if (held !== undefined) {
      if (!held.red) lines.push(`  nivoos package check ${entry.name}: green (reused, nothing it reads changed)`);
      else {
        findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${folder}/${entry.entry}`, message: `${held.message} (the verdict recorded for this tree)` });
        lines.push(`  nivoos package check ${entry.name}: red (reused, nothing it reads changed)`);
      }
      continue;
    }
    const result = await run({ kind: 'build', label: `app check nivoos package check ${entry.name}`, cwd: path.join(repoRoot, folder), argv: [process.execPath, cli, 'package', 'check', entry.entry, '--out', entry.out], env });
    const output = tailOf(`${result.stdout}\n${result.stderr}`);
    const exit = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
    const settled = result.error === undefined && result.status !== null && result.status >= 0 && result.status < 128;
    const message = `nivoos package check ${entry.name} failed (${exit}): the package does not type-check or build, its committed ${entry.out}/ differs from a fresh build (\`npm run build\` in ${folder}, then commit the seed), or a cell, graph or agent changed content under a version the published seed already holds (raise the version)${output === '' ? '' : `\n${output}`}`;
    if (keyed?.complete === true && settled) book?.put(recordId, keyed.key, { red: !(result.status === 0 && result.error === undefined), message });
    if (result.status === 0 && result.error === undefined) {
      lines.push(`  nivoos package check ${entry.name}: green (exit 0)${output === '' ? '' : `: ${output.split('\n').at(-1) ?? ''}`}`);
      continue;
    }
    findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${folder}/${entry.entry}`, message });
    lines.push(`  nivoos package check ${entry.name}: red (${exit})`);
  }
  book?.finish();
  return { findings, lines };
}

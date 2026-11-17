// built-packages.mts - the workspace packages a type program resolves through a build output (contexts/project/check-cache.md, "Which step reuses what", the `types` step).
// A package that exports what it built (`exports`, `main`, `module` or `types` pointing into a folder git does not track, `dist/`) has no declarations in a fresh tree, so a
// program that imports it reports hundreds of unresolved imports that are no code defect. The types step therefore builds these packages first, each by the app's own `build`
// script of the package, dependencies first. A build is skipped while its stamp (the tracked sources of the package, those of the built packages it depends on and the
// lockfile) is unchanged and every output is present; the stamp is host state in the untracked tool cache and is never committed. A program's cache key reads the folders of
// the built packages it depends on, so a source change in one re-keys exactly the programs that read it (programsWithBuiltReads).
import fs from 'node:fs';
import path from 'node:path';
import { combineHashes } from './hash.mjs';
import { shellArgv, type ParityRun } from './parity-family.mjs';
import type { CheckSession } from './types.mjs';
import type { TypesProgram } from './types-family.mjs';

/** The failure code of a package build that fails. */
export const TYPES_PACKAGE_BUILD_FAILED = 'TYPES_PACKAGE_BUILD_FAILED';

/** One workspace package that exports a build output. */
export interface BuiltPackage {
  readonly name: string;
  /** App-relative posix folder. */
  readonly dir: string;
  /** The output paths its manifest points at, app-relative posix; a pattern target (`./dist/*`) stands for its folder prefix. */
  readonly outputs: readonly string[];
  /** The names of the other built packages it declares as dependencies. */
  readonly needs: readonly string[];
  /** Whether the manifest has a `build` script (without one the package cannot be built here). */
  readonly buildable: boolean;
}

type Json = Record<string, unknown>;

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

function readJson(root: string, file: string): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : undefined;
  } catch {
    return undefined;
  }
}

/** The folders the root manifest's `workspaces` name, as the package folders among `tracked` (a package is a tracked `<folder>/package.json`). Only `*` and `**` globs are read. */
export function workspaceDirs(rootManifest: Json | undefined, tracked: readonly string[]): string[] {
  const field = rootManifest?.['workspaces'];
  const globs = Array.isArray(field) ? field : (field !== null && typeof field === 'object' && Array.isArray((field as Json)['packages']) ? ((field as Json)['packages'] as unknown[]) : []);
  const toRegex = (glob: string): RegExp => new RegExp(`^${glob.replace(/^\.\//u, '').replace(/\/$/u, '').split('/').map((part) => (part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '[^/]+'))).join('/')}$`, 'u');
  const include = globs.filter((glob): glob is string => typeof glob === 'string' && !glob.startsWith('!')).map(toRegex);
  const exclude = globs.filter((glob): glob is string => typeof glob === 'string' && glob.startsWith('!')).map((glob) => toRegex(glob.slice(1)));
  const dirs = tracked.filter((file) => file.endsWith('/package.json') && !file.includes('node_modules/')).map((file) => file.slice(0, -'/package.json'.length));
  return dirs.filter((dir) => include.some((pattern) => pattern.test(dir)) && !exclude.some((pattern) => pattern.test(dir))).sort();
}

/** Every string target a manifest's entry fields name (`exports` at any depth, `main`, `module`, `types`, `typings`). */
function targetsOf(manifest: Json): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') Object.values(value as Json).forEach(walk);
  };
  walk(manifest['exports']);
  for (const field of ['main', 'module', 'types', 'typings']) walk(manifest[field]);
  return out.filter((target) => target.startsWith('./') || /^[A-Za-z0-9_@-]/u.test(target));
}

/**
 * The workspace packages of the app whose manifest points into a build output: a target that is no tracked file (nor a folder holding tracked files). Sorted so a package
 * comes after the built packages it depends on.
 */
export function builtPackagesOf(root: string, tracked: readonly string[]): BuiltPackage[] {
  const trackedSet = new Set(tracked);
  const found: Omit<BuiltPackage, 'needs'>[] = [];
  const manifests = new Map<string, Json>();
  for (const dir of workspaceDirs(readJson(root, 'package.json'), tracked)) {
    const manifest = readJson(root, `${dir}/package.json`);
    if (manifest === undefined || typeof manifest['name'] !== 'string') continue;
    const outputs = new Set<string>();
    for (const target of targetsOf(manifest)) {
      const rel = target.replace(/^\.\//u, '');
      const full = path.posix.join(dir, rel.includes('*') ? rel.slice(0, rel.indexOf('*')) : rel).replace(/\/$/u, '');
      if (full === dir || full.includes('node_modules/')) continue;
      const holdsTracked = trackedSet.has(full) || tracked.some((file) => file.startsWith(`${full}/`));
      if (!holdsTracked) outputs.add(full);
    }
    if (outputs.size === 0) continue;
    const scripts = manifest['scripts'];
    manifests.set(manifest['name'], manifest);
    found.push({ name: manifest['name'], dir, outputs: [...outputs].sort(), buildable: scripts !== null && typeof scripts === 'object' && typeof (scripts as Json)['build'] === 'string' });
  }
  const names = new Set(found.map((pkg) => pkg.name));
  const withNeeds: BuiltPackage[] = found.map((pkg) => ({ ...pkg, needs: DEPENDENCY_FIELDS.flatMap((field) => Object.keys((manifests.get(pkg.name)?.[field] ?? {}) as Json)).filter((name) => names.has(name) && name !== pkg.name) }));
  // Dependencies first (a cycle keeps the order of the folders).
  const ordered: BuiltPackage[] = [];
  const visit = (pkg: BuiltPackage, trail: ReadonlySet<string>): void => {
    if (ordered.includes(pkg) || trail.has(pkg.name)) return;
    for (const need of pkg.needs) { const next = withNeeds.find((other) => other.name === need); if (next !== undefined) visit(next, new Set([...trail, pkg.name])); }
    ordered.push(pkg);
  };
  for (const pkg of withNeeds) visit(pkg, new Set());
  return ordered;
}

/** The built packages `dir`'s own manifest depends on, with the built packages those need in turn. */
function reachedBy(root: string, dir: string, built: readonly BuiltPackage[]): BuiltPackage[] {
  const manifest = readJson(root, `${dir}/package.json`);
  const reached = new Map<string, BuiltPackage>();
  const add = (name: string): void => {
    const pkg = built.find((candidate) => candidate.name === name);
    if (pkg === undefined || reached.has(name)) return;
    reached.set(name, pkg);
    pkg.needs.forEach(add);
  };
  for (const field of DEPENDENCY_FIELDS) Object.keys((manifest?.[field] ?? {}) as Json).forEach(add);
  return [...reached.values()];
}

/**
 * The programs with the folders of the built packages they depend on added to what they read, so the key of a program that resolves a package through its build output
 * changes when that package's tracked sources do (the build output itself is untracked and no key part). A program keeps its first `reads` entry first.
 */
export function programsWithBuiltReads(programs: readonly TypesProgram[], built: readonly BuiltPackage[], root: string): TypesProgram[] {
  if (built.length === 0) return [...programs];
  return programs.map((program) => {
    const dir = path.posix.dirname(program.tsconfig);
    const extra = reachedBy(root, dir, built).map((pkg) => pkg.dir).filter((folder) => !(program.reads ?? [dir]).includes(folder));
    return extra.length === 0 ? program : { ...program, reads: [...(program.reads ?? [dir]), ...extra] };
  });
}

/** The programs that depend on a package of `names` (as `programsWithBuiltReads` reads them). */
export function programsDependingOn(programs: readonly TypesProgram[], built: readonly BuiltPackage[], names: ReadonlySet<string>, root: string): string[] {
  return programs.filter((program) => reachedBy(root, path.posix.dirname(program.tsconfig), built).some((pkg) => names.has(pkg.name))).map((program) => program.name);
}

/** What the builds of one types step came to. */
export interface PackageBuildResult {
  readonly built: readonly string[];
  readonly skipped: readonly string[];
  /** The packages whose build failed (or could not be run), with the last lines the build printed. */
  readonly failed: readonly { readonly pkg: BuiltPackage; readonly message: string }[];
}

const tailOf = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-5).join(' | ').slice(0, 600);
const stampFile = (toolCacheDir: string, pkg: BuiltPackage): string => path.join(path.resolve(toolCacheDir), 'built-packages', `${pkg.name.replace(/^@/u, '').replaceAll('/', '__')}.json`);

function stampKey(session: CheckSession, pkg: BuiltPackage, built: readonly BuiltPackage[], keys: ReadonlyMap<string, string>): string {
  const parts: Record<string, string> = { '#lock': session.index.hashOf('package-lock.json') ?? 'none' };
  for (const file of session.index.paths) if (file.startsWith(`${pkg.dir}/`)) parts[`tracked:${file}`] = session.index.hashOf(file) ?? 'absent';
  for (const need of pkg.needs) parts[`need:${need}`] = keys.get(need) ?? built.find((other) => other.name === need)?.dir ?? 'none';
  return combineHashes(parts);
}

/**
 * Builds every built package in dependency order, each by `npm run build --workspace <folder>` from the app root through the governor's command port. A package whose
 * stamp is unchanged and whose outputs are all present is skipped; one whose dependency failed is not run (its failure would be the dependency's). A failed build stores no
 * stamp. Every package builds in turn: the step runs alone and a build is one `tsc`.
 */
export async function buildPackages(options: { readonly session: CheckSession; readonly repoRoot: string; readonly built: readonly BuiltPackage[]; readonly toolCacheDir: string; readonly env: NodeJS.ProcessEnv; readonly run: ParityRun }): Promise<PackageBuildResult> {
  const { session, repoRoot, built, toolCacheDir, env, run } = options;
  const keys = new Map<string, string>();
  const done: string[] = [];
  const skipped: string[] = [];
  const failed: { pkg: BuiltPackage; message: string }[] = [];
  const failedNames = new Set<string>();
  for (const pkg of built) {
    const key = stampKey(session, pkg, built, keys);
    keys.set(pkg.name, key);
    const blocker = pkg.needs.find((need) => failedNames.has(need));
    if (blocker !== undefined) { failedNames.add(pkg.name); continue; }
    const stamp = stampFile(toolCacheDir, pkg);
    let held: unknown;
    try { held = (JSON.parse(fs.readFileSync(stamp, 'utf8')) as Json)['key']; } catch { held = undefined; }
    if (held === key && pkg.outputs.every((output) => fs.existsSync(path.join(repoRoot, output)))) { skipped.push(pkg.name); continue; }
    if (!pkg.buildable) { failedNames.add(pkg.name); failed.push({ pkg, message: `${pkg.dir}/package.json exports a build output (${pkg.outputs.join(', ')}) but has no \`build\` script, so nothing can produce it` }); continue; }
    const result = await run({ kind: 'build', label: `app check types build ${pkg.name}`, cwd: repoRoot, argv: shellArgv(`npm run build --workspace ${pkg.dir}`, process.platform, env), env });
    const missing = pkg.outputs.filter((output) => !fs.existsSync(path.join(repoRoot, output)));
    if (result.status !== 0 || result.error !== undefined || missing.length > 0) {
      failedNames.add(pkg.name);
      const why = result.status !== 0 || result.error !== undefined ? `\`npm run build\` of ${pkg.name} failed (exit ${String(result.status)}): ${result.error?.message ?? tailOf(`${result.stdout}\n${result.stderr}`)}` : `\`npm run build\` of ${pkg.name} left ${missing.join(', ')} missing`;
      failed.push({ pkg, message: why });
      continue;
    }
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, `${JSON.stringify({ key })}\n`);
    done.push(pkg.name);
  }
  return { built: done, skipped, failed };
}

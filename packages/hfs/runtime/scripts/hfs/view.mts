// hfs-view.mjs - the frozen view of one side of an app (be/ or fe/, the side folder as its root) that the lint factories hand
// their rules (`settings.starci.hfs`). Both @starci/eslint-canon-be and @starci/eslint-canon-fe ship a byte copy of this file in their
// runtime/ bundle (scripts/hfs/sync-runtime.mjs), so a path-scoped rule in either package asks the SAME resolver the
// architecture machine and `starci app check` use, and never tests a path with a regular expression of its own.
import fs from 'node:fs';
import path from 'node:path';
import { allowsFile } from './allows.mjs';
import { openHfs } from './slots.mjs';
import type { AllowsResult } from './allows.mjs';
import type { OpenedHfs, ClassifiedPath, RepoView, RuleParams } from './slots.mjs';
import type { Parsed } from './manifest-shape.mjs';
import { ROOT_PACKAGE_SLOTS } from './architecture/root-packages.mjs';

/** The frozen view of one side of an app that the lint factories hand their rules (`settings.starci.hfs`). */
export interface HfsView {
  repoRoot: string;
  profile: string;
  side: string | null;
  edition: string;
  grammar?: string;
  apps: RepoView['apps'];
  connections: RepoView['connections'];
  patterns: readonly string[];
  ruleParams: RuleParams | null;
  relative: (file: string) => string;
  classify: (file: string) => ClassifiedPath;
  slotOf: (file: string) => string | null;
  tierOf: (file: string) => string | null;
  ownerOf: (file: string) => string | null;
  allows: (file: string) => AllowsResult | null;
  slot: OpenedHfs['slot'];
  /** The vocabulary a root workspace package declares for itself (`starci` of its manifest); only the view of the root packages has it. */
  packageContract?: (file: string) => PackageContract | null;
}

/** A type a root package declares: its name and the file of the package that declares it, relative to the app root. */
export interface PackageDeclaredType {
  readonly name: string;
  readonly file: string;
}

/**
 * What a root workspace package declares in the `starci` key of its own `package.json`, since it cannot import the app's
 * `platform/errors` or its `GraphQLResponse<T>`: `errorBase` is the class its errors derive from, `outcome` its one result union, each
 * `{ name, file }` with `file` relative to the package folder.
 */
export interface PackageContract {
  readonly errorBase?: PackageDeclaredType;
  readonly outcome?: PackageDeclaredType;
}

const posix = (p: unknown): string => String(p).replaceAll('\\', '/');
const isAbsoluteAny = (text: string): boolean => path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);

/**
 * The view rules read, over an opened resolver.
 *
 * @param {object} opened - The result of `openHfs` (manifest, repo and resolver methods).
 * @param {string} repoRoot - The absolute repository root.
 * @returns {object} The frozen view: profile, apps, connections, patterns, ruleParams, relative, classify, slotOf, tierOf, ownerOf, slot.
 */
function hfsView(opened: OpenedHfs, repoRoot: string): HfsView {
  const rel = (file: string): string => {
    const text = posix(file);
    if (!isAbsoluteAny(text)) return text.replace(/^\.\//, '');
    return posix(path.relative(repoRoot, file));
  };
  const slotCache = new Map<string, ClassifiedPath>();
  const classify = (file: string): ClassifiedPath => {
    const key = rel(file);
    if (!slotCache.has(key)) slotCache.set(key, opened.classifyPath(key));
    return slotCache.get(key) as ClassifiedPath;
  };
  return Object.freeze({
    repoRoot,
    profile: opened.repo.profile,
    side: opened.repo.side ?? null,
    edition: opened.repo.edition ?? 'full',
    ...(opened.repo.grammar === undefined ? {} : { grammar: opened.repo.grammar }),
    apps: opened.repo.apps,
    connections: opened.repo.connections,
    patterns: Object.freeze([...(opened.repo.patterns ?? [])]),
    ruleParams: opened.ruleParams(),
    /** The repository-relative, forward-slash form of a linted filename. */
    relative: rel,
    /** The classification of a file: `{ slot, tier, owner?, bindings? ... }` or a no-slot status. */
    classify,
    /** The slot id that owns a file, or null when no slot does. */
    slotOf: (file: string) => classify(file).slot ?? null,
    /** The tier of a file, or null. */
    tierOf: (file: string) => opened.tierOf(rel(file)) ?? null,
    /** The owner root of a file, or null. */
    ownerOf: (file: string) => opened.ownerOf(rel(file))?.root ?? null,
    /** What the slot that owns a file says about it: `{ slot, root, relative, allowed, entry?, forbiddenBy?, allows }`, or null when the slot names no `allows`. */
    allows: (file: string) => allowsFile(opened, rel(file)),
    /** A slot definition by id. */
    slot: (id: string) => opened.slot(id),
  });
}

/**
 * The view of the app folder on disk at `repoRoot`, against the manifest under `runtimeRoot`: a side folder (be/, fe/) finds the
 * app-root hfs.json one level up and gets that side's view, so every linted file below it is judged by its own side's slots.
 *
 * @param {{ runtimeRoot: string, repoRoot: string }} input - Where the manifest copy lives and the side folder (or app root).
 * @returns {object} The frozen view.
 */
export const openHfsView = ({ runtimeRoot, repoRoot }: { runtimeRoot: string; repoRoot: string }): HfsView => hfsView(openHfs({ root: runtimeRoot, repoRoot }), repoRoot);

/**
 * The view of one side of an in-memory app declaration (rule tests): no file is read except the manifest.
 *
 * @param {{ runtimeRoot: string, declaration: object, repoRoot: string, side: string }} input - Manifest root, hfs.json object, the linted side folder, its side.
 * @returns {object} The frozen view.
 */
export const declaredHfsView = ({ runtimeRoot, declaration, repoRoot, side }: { runtimeRoot: string; declaration: Parsed; repoRoot: string; side: string }): HfsView => hfsView(openHfs({ root: runtimeRoot, declaration, side }), repoRoot);

const CONTRACT_KEYS = ['errorBase', 'outcome'] as const;

/**
 * The contract of the package at `packageDir` (app-root relative, `packages/<pkg>`), read from the `starci` key of its manifest. A
 * declaration that is not `{ name, file }` with an identifier name and a file inside `src/` stops the lint, because a rule must not guess.
 *
 * @param {string} repoRoot - The absolute app root.
 * @param {string} packageDir - The package folder, relative to the app root.
 * @returns {object} The declared error base and outcome union, each with its file relative to the app root.
 */
export const readPackageContract = (repoRoot: string, packageDir: string): PackageContract => {
  const manifestPath = path.join(repoRoot, packageDir, 'package.json');
  const manifest = (fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null) as { starci?: unknown } | null;
  const declared = manifest?.starci;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null) throw new Error(`${packageDir}/package.json: "starci" is an object ({ errorBase, outcome })`);
  const contract: Record<string, PackageDeclaredType> = {};
  for (const key of CONTRACT_KEYS) {
    const entry: unknown = (declared as Record<string, unknown>)[key];
    if (entry === undefined) continue;
    const { name, file } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name) || typeof file !== 'string' || !/^src\/(?:[\w.-]+\/)*[\w.-]+\.ts$/.test(file)) {
      throw new Error(`${packageDir}/package.json: "starci.${key}" is { "name": "<Identifier>", "file": "src/<path>.ts" }`);
    }
    contract[key] = Object.freeze({ name, file: `${packageDir}/${file}` });
  }
  return Object.freeze(contract);
};

/**
 * The view of the root workspace packages of an app (`packages/<pkg>/src/**`, slots app.packages and app.module-registry), as the lint of one
 * side sees them: the rule parameters, the apps and the Grammar of `side` (a package is judged by the laws of the side whose subpath a file
 * sits in), and the paths of the APP ROOT (`repoRoot` is the app root, not a side folder). The slots answer for the root paths; a file of a
 * package is of the tier `package` and has no owner: the owner laws (one `index.ts` per owner root) are the module folders', a package's public
 * surface being the `exports` of its manifest.
 *
 * @param {object} opened - The result of `openHfs` for the app root (profile app, both sides resolved).
 * @param {string} repoRoot - The absolute app root.
 * @param {string} side - `be` or `fe`: the side whose laws the file is judged by.
 * @returns {object} The frozen view: the profile of the side over the paths of the app root.
 */
function packagesView(opened: OpenedHfs, repoRoot: string, side: 'be' | 'fe'): HfsView {
  const scope = opened.sides?.[side];
  const sideRepo = opened.repo.sides?.[side];
  if (scope === undefined || sideRepo === undefined) throw new Error('the view of the root packages needs the declaration of an app with both sides');
  const rel = (file: string): string => {
    const text = posix(file);
    return isAbsoluteAny(text) ? posix(path.relative(repoRoot, file)) : text.replace(/^\.\//, '');
  };
  const cache = new Map<string, ClassifiedPath>();
  const classify = (file: string): ClassifiedPath => {
    const key = rel(file);
    if (!cache.has(key)) cache.set(key, opened.classifyPath(key));
    return cache.get(key) as ClassifiedPath;
  };
  const packageOf = (file: string): string | null => {
    const slot = classify(file).slot;
    const relative = rel(file);
    return slot !== undefined && ROOT_PACKAGE_SLOTS.has(slot) ? relative.split('/').slice(0, 2).join('/') : null;
  };
  const contracts = new Map<string, PackageContract>();
  const packageContract = (file: string): PackageContract | null => {
    const dir = packageOf(file);
    if (dir === null) return null;
    if (!contracts.has(dir)) contracts.set(dir, readPackageContract(repoRoot, dir));
    return contracts.get(dir) as PackageContract;
  };
  return Object.freeze({
    repoRoot,
    profile: side,
    side,
    edition: opened.repo.edition ?? 'full',
    ...(sideRepo.grammar === undefined ? {} : { grammar: sideRepo.grammar }),
    apps: sideRepo.apps,
    connections: sideRepo.connections,
    patterns: Object.freeze([...(sideRepo.patterns ?? [])]),
    ruleParams: scope.ruleParams(),
    relative: rel,
    classify,
    slotOf: (file: string) => classify(file).slot ?? null,
    tierOf: (file: string) => (packageOf(file) === null ? null : 'package'),
    // A package is no owner of the module laws (one index.ts at the owner root): its public surface is the `exports` of its manifest, so no file of it has an owner.
    ownerOf: () => null,
    allows: (file: string) => allowsFile(opened, rel(file)),
    slot: (id: string) => opened.slot(id),
    packageContract,
  });
}

/**
 * The view of the root packages of the app at `repoRoot` (the app root, where the root `eslint.config.mjs` lives), for the laws of `side`.
 *
 * @param {{ runtimeRoot: string, repoRoot: string, side: string }} input - Where the manifest copy lives, the app root, and the side whose laws apply.
 * @returns {object} The frozen view.
 */
export const openPackagesHfsView = ({ runtimeRoot, repoRoot, side }: { runtimeRoot: string; repoRoot: string; side: 'be' | 'fe' }): HfsView => packagesView(openHfs({ root: runtimeRoot, repoRoot }), repoRoot, side);

/**
 * The view of the root packages of an in-memory app declaration (rule tests): no file is read except the manifest.
 *
 * @param {{ runtimeRoot: string, declaration: object, repoRoot: string, side: string }} input - Manifest root, the app hfs.json object, the app root and the side.
 * @returns {object} The frozen view.
 */
export const declaredPackagesHfsView = ({ runtimeRoot, declaration, repoRoot, side }: { runtimeRoot: string; declaration: Parsed; repoRoot: string; side: 'be' | 'fe' }): HfsView => packagesView(openHfs({ root: runtimeRoot, declaration }), repoRoot, side);

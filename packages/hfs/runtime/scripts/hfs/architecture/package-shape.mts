import fs from 'node:fs';
import path from 'node:path';
import { treeOf } from './required-files.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { ArchitectureConfig } from './config.mjs';
import type { ArchitectureViolation, HfsGraph } from './hfs-graph.mjs';

/** A package.json parsed from disk: only the fields this check reads are named. */
interface PackageManifest {
  scripts?: { build?: unknown };
  exports?: unknown;
  [field: string]: unknown;
}

type Report = (message: string, extra?: Record<string, unknown>) => void;

/**
 * R63 `package-shape` (FE_PACKAGE_SHAPE, knowledge/hfs/README.md 6.2). A shared package is built to `dist` and says what it
 * exports. The package manifest of every package owner (slots repo.packages and fe.package.ui, packages/<pkg>/package.json)
 * must have:
 *
 *   - a `scripts.build`;
 *   - an explicit `exports` map: present, no `*` pattern in a subpath, no folder mapping;
 *   - every export target, and `main`, `module`, `types` and `typings` when present, inside `./dist/`: a target into `src/`
 *     ships source that was never built.
 *
 * `export *` in the package entry is ARCH_OWNER_EXPORT_STAR, a dead unit is HFS_UNUSED_EXPORT and the package tiers are the
 * eslint rule `monorepo-tier-belongs-to-its-side`; none is judged a second time here.
 */
export const PACKAGE_SHAPE_RULE_IDS = ['FE_PACKAGE_SHAPE'];

const RULE = 'FE_PACKAGE_SHAPE';
const UNREADABLE = Symbol('unreadable');

/** Every string target of an exports value (a string, a condition map, an array of either), with the condition path. */
function targetsOf(value: unknown, trail: string[] = []): { target: string; trail: string[] }[] {
  if (typeof value === 'string') return [{ target: value, trail }];
  if (Array.isArray(value)) return value.flatMap((item, index) => targetsOf(item, [...trail, String(index)]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => targetsOf(item, [...trail, key]));
  return [];
}

const insideDist = (target: string): boolean => path.posix.normalize(target).replace(/^\.\//u, '').startsWith('dist/');

function packageRoots(config: ArchitectureConfig, resolver: HfsGraph['resolver']): string[] {
  const roots = new Set<string>();
  for (const rel of treeOf(config.root).files) {
    const owner = resolver.ownerOf(rel);
    if (owner && resolver.slot(owner.slot)?.tier === 'package') roots.add(owner.root);
  }
  return [...roots].sort(byCodeUnit);
}

function readManifest(config: ArchitectureConfig, manifestRel: string): PackageManifest | typeof UNREADABLE {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.root, ...manifestRel.split('/')), 'utf8')) as PackageManifest; // reason: parsed from disk; the fields read are checked at use
  } catch {
    return UNREADABLE;
  }
}

function reportExportIssues(manifest: PackageManifest, manifestRel: string, report: Report): void {
  if (manifest.exports === undefined) {
    report(`${manifestRel} declares no exports map; a package lists what it exports, subpath by subpath, each pointing into ./dist/.`);
    return;
  }
  if (typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)) {
    for (const key of Object.keys(manifest.exports as object)) { // reason: typeof narrows to object | null; a null exports map throws here exactly as before
      if (key.includes('*') || key.endsWith('/')) report(`exports key "${key}" of ${manifestRel} is a pattern or folder mapping; list each exported subpath explicitly.`, { export: key });
    }
  }
  for (const { target, trail } of targetsOf(manifest.exports)) {
    if (!insideDist(target)) report(`exports target "${target}" (${trail.join(' > ') || '.'}) of ${manifestRel} is not inside ./dist/; a package exports what it built, never its source.`, { export: target });
  }
}

function reportManifestIssues(manifest: PackageManifest, manifestRel: string, report: Report): void {
  if (typeof manifest.scripts?.build !== 'string' || !manifest.scripts.build.trim()) report(`${manifestRel} has no scripts.build; a shared package is built to dist before an app consumes it.`);
  reportExportIssues(manifest, manifestRel, report);
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string' && !insideDist(manifest[field])) report(`${field} "${manifest[field]}" of ${manifestRel} is not inside ./dist/; a package points at what it built.`, { field });
  }
}

function inspectPackage(config: ArchitectureConfig, root: string, violations: ArchitectureViolation[]): boolean {
  const manifestRel = `${root}/package.json`;
  const report: Report = (message, extra = {}) => violations.push({ ruleId: RULE, path: manifestRel, line: 1, column: 1, package: root, message, ...extra });
  const manifest = readManifest(config, manifestRel);
  if (manifest === UNREADABLE) return false;
  reportManifestIssues(manifest, manifestRel, report);
  return true;
}

export function checkPackageShape({ config, graph }: { config: ArchitectureConfig; graph: HfsGraph }) {
  const roots = packageRoots(config, graph.resolver);
  const violations: ArchitectureViolation[] = [];
  let packages = 0;
  for (const root of roots) {
    if (inspectPackage(config, root, violations)) packages += 1;
  }
  return { violations, coverage: { status: 'checked', packages } };
}

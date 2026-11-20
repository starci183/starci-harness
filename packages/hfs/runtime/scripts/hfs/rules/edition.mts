// edition.mts - R212, the one app edition. It reports what no slot path can state:
//   - HFS_EDITION_DEPRECATED, a warning: hfs.json still names `edition`. Any value is accepted and ignored (there is one edition,
//     what the live apps run); the field is dropped in a later train, so the finding asks for its removal and never blocks;
//   - a backing service that is not declared or not used: a client library of a service of ruleParams.be.backing (bullmq for
//     redis) or a declared pattern that needs one (queue) while hfs.json sides.be.backing does not declare it is
//     HFS_BACKING_UNDECLARED, and a declared service no dependency of the app consumes is HFS_BACKING_UNUSED. A declared service is also
//     consumed by an integration module of the back end named after it (`src/modules/integrations/<service>/`, imported by another file of the
//     back end), the client an app writes over the service's own protocol (qdrant over fetch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { readTypeScriptProject, resolveTypeScriptModule } from '../typescript-programs.mjs';
import { found, readJson, readText } from './read.mjs';
import { DEPENDENCY_SECTIONS } from './fe-no-tests.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

export const HFS_EDITION_DEPRECATED = 'HFS_EDITION_DEPRECATED';
export const HFS_BACKING_UNDECLARED = 'HFS_BACKING_UNDECLARED';
export const HFS_BACKING_UNUSED = 'HFS_BACKING_UNUSED';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = /(?:^|\/)package\.json$/;

const isPlainObject = (value: Parsed) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The backing services of the manifest (ruleParams.be.backing): name -> {clients, patterns, images}. */
const backingCatalog = (manifest: Parsed) => manifest?.ruleParams?.be?.backing ?? {};

/** The backing service `name` is a client library of, or null. */
const serviceOfClient = (catalog: Parsed, name: string) => Object.keys(catalog).find((service) => catalog[service].clients.includes(name)) ?? null;

/** The dependency names of a package.json, every section. */
const dependencyNames = (pkg: Parsed) => DEPENDENCY_SECTIONS.flatMap((section) => (isPlainObject(pkg?.[section]) ? Object.keys(pkg[section]) : []));

const IMPORTING_SOURCE = /\.tsx?$/u;
const NOT_PRODUCTION = /(?:\.spec\.|\.test\.|(?:^|\/)src\/tests\/)/u;
const MAX_BARREL_DEPTH = 4;

/**
 * Whether a back-end source outside the integration module `src/modules/integrations/<service>/` imports it, resolved the way the compiler
 * resolves it: each import or re-export specifier of every production source goes through the be tsconfig's module resolution (its `paths`
 * aliases, relative paths, index barrels), and counts when it lands in the module's folder, directly or through a barrel that re-exports
 * from it. The module must exist (a file under that folder). A host without TypeScript cannot prove it and reports no consumer.
 */
function integrationImported({ repoRoot, files, service, beFolder }: { repoRoot: string; files: readonly string[]; service: string; beFolder: string }): boolean {
  const base = beFolder === '' ? '' : `${beFolder}/`;
  const folder = `${base}src/modules/integrations/${service}/`;
  if (!files.some((file) => file.startsWith(folder) && IMPORTING_SOURCE.test(file))) return false;
  const ts = loadTypescript(repoRoot, HERE);
  if (!ts) return false;
  const absolute = (file: string): string => path.join(repoRoot, file);
  const config = absolute(`${base}tsconfig.json`);
  const options = fs.existsSync(config) ? (readTypeScriptProject(ts, config).parsed?.options ?? {}) : {};
  const inside = (resolved: string | undefined): boolean => resolved !== undefined && path.relative(absolute(folder), resolved).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(absolute(folder), resolved));
  const specifiers = (file: string): string[] => ts.preProcessFile(readText(repoRoot, file) ?? '', true, false).importedFiles.map((item) => item.fileName);
  const lands = (specifier: string, from: string, depth: number, seen: Set<string>): boolean => {
    const resolved = resolveTypeScriptModule(ts, specifier, absolute(from), options);
    if (resolved === undefined) return false;
    if (inside(resolved)) return true;
    // A barrel outside the module (an index that re-exports) leads on to what it re-exports.
    const next = path.relative(repoRoot, resolved).split(path.sep).join('/');
    if (depth >= MAX_BARREL_DEPTH || seen.has(next) || next.startsWith('..') || next.includes('node_modules/') || !/(?:^|\/)index\.tsx?$/u.test(next)) return false;
    seen.add(next);
    return specifiers(next).some((inner) => lands(inner, next, depth + 1, seen));
  };
  return files.some((file) => file.startsWith(`${base}src/`) && IMPORTING_SOURCE.test(file) && !file.startsWith(folder) && !NOT_PRODUCTION.test(file)
    && specifiers(file).some((specifier) => lands(specifier, file, 0, new Set())));
}

/** The warning of a declaration that still names the deprecated `edition` field. */
function deprecationFindings(repoRoot: string) {
  const declaration = readJson(repoRoot, 'hfs.json');
  if (!isPlainObject(declaration) || declaration.kind !== 'app' || declaration.edition === undefined) return [];
  return [found(HFS_EDITION_DEPRECATED, 'hfs.json', `hfs.json names edition ${JSON.stringify(declaration.edition)}: an app has one edition (R212), so the field is ignored; remove it, a later train drops it`, { edition: declaration.edition, level: 'warning' })];
}

function dependencyFindings(rel: string, pkg: Parsed, { catalog, declared }: { catalog: Parsed; declared: Parsed }) {
  const findings = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!isPlainObject(deps)) continue;
    for (const name of Object.keys(deps)) {
      const service = serviceOfClient(catalog, name);
      if (service !== null && !declared.has(service)) findings.push(found(HFS_BACKING_UNDECLARED, rel, `${rel} ${section} has ${name}, a client of ${service}, which hfs.json sides.be.backing does not declare: declare ${service} for the capability that needs it, or remove the dependency`, { section, name, service }));
    }
  }
  return findings;
}

/**
 * The backing findings of the be declaration: a declared pattern whose service is undeclared, and (at the app root or a
 * standalone back end, whose package.json carries the back end's dependencies) a declared service no dependency consumes.
 */
function backingFindings({ repoRoot, beView, catalog, files, beFolder }: { repoRoot: string; beView: Parsed; catalog: Parsed; files: readonly string[]; beFolder: string }) {
  const declared = new Set<string>(beView.backing ?? []);
  const findings = [];
  for (const [service, entry] of Object.entries<Parsed>(catalog)) {
    const needing = (beView.patterns ?? []).filter((pattern: Parsed) => entry.patterns.includes(pattern));
    if (needing.length && !declared.has(service)) findings.push(found(HFS_BACKING_UNDECLARED, 'hfs.json', `hfs.json declares the ${needing.join(', ')} pattern, which runs on ${service}: declare ${service} in sides.be.backing`, { service, patterns: needing }));
  }
  const dependencies = new Set(dependencyNames(readJson(repoRoot, 'package.json')));
  for (const service of declared) {
    const clients = catalog[service]?.clients ?? [];
    if (!clients.some((name: string) => dependencies.has(name)) && !integrationImported({ repoRoot, files, service, beFolder })) findings.push(found(HFS_BACKING_UNUSED, 'hfs.json', `hfs.json sides.be.backing declares ${service}, but no dependency consumes it (${clients.join(', ')}) and no imported module src/modules/integrations/${service}/ does: remove the declaration, or add the capability that needs it`, { service }));
  }
  return findings;
}

/**
 * R212 for one scope (the app root or one side), over `files` (scope-relative). The declaration findings are judged from the be
 * side (its patterns and backing): the root scope looks at sides.be, a standalone be-side check at its own view.
 * `withDeclaration: false` (a side scope of a whole-app check) skips them: the root scope already reported them on hfs.json.
 */
export function editionFindings({ repoRoot, files, all = files, repo, manifest, withDeclaration = true }: { repoRoot: string; files: string[]; all?: string[]; repo: Repo; manifest: Parsed; withDeclaration?: Parsed }) {
  let beView = null;
  if (withDeclaration && repo.profile === 'app') beView = repo.sides?.be;
  else if (withDeclaration && repo.profile === 'be') beView = repo;
  const catalog = backingCatalog(manifest);
  const findings = [
    ...(withDeclaration && repo.profile === 'app' ? deprecationFindings(repoRoot) : []),
    ...(beView ? backingFindings({ repoRoot, beView, catalog, files: all, beFolder: repo.profile === 'app' ? 'be' : '' }) : []),
  ];
  const declared = new Set((repo.profile === 'app' ? repo.sides?.be?.backing : repo.backing) ?? []);
  for (const file of files) {
    if (file.includes('node_modules/') || !PACKAGE_JSON.test(file)) continue;
    const pkg = readJson(repoRoot, file);
    if (isPlainObject(pkg)) findings.push(...dependencyFindings(file, pkg, { catalog, declared }));
  }
  return findings;
}

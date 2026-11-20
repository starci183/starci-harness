// edition.mts - R212, the one app edition. It reports what no slot path can state:
//   - HFS_EDITION_DEPRECATED, a warning: hfs.json still names `edition`. Any value is accepted and ignored (there is one edition,
//     what the live apps run); the field is dropped in a later train, so the finding asks for its removal and never blocks;
//   - a backing service that is not declared or not used: a client library of a service of ruleParams.be.backing (bullmq for
//     redis) or a declared pattern that needs one (queue) while hfs.json sides.be.backing does not declare it is
//     HFS_BACKING_UNDECLARED, and a declared service no dependency of the app consumes is HFS_BACKING_UNUSED.
import { found, readJson } from './read.mjs';
import { DEPENDENCY_SECTIONS } from './fe-no-tests.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

export const HFS_EDITION_DEPRECATED = 'HFS_EDITION_DEPRECATED';
export const HFS_BACKING_UNDECLARED = 'HFS_BACKING_UNDECLARED';
export const HFS_BACKING_UNUSED = 'HFS_BACKING_UNUSED';

const PACKAGE_JSON = /(?:^|\/)package\.json$/;

const isPlainObject = (value: Parsed) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The backing services of the manifest (ruleParams.be.backing): name -> {clients, patterns, images}. */
const backingCatalog = (manifest: Parsed) => manifest?.ruleParams?.be?.backing ?? {};

/** The backing service `name` is a client library of, or null. */
const serviceOfClient = (catalog: Parsed, name: string) => Object.keys(catalog).find((service) => catalog[service].clients.includes(name)) ?? null;

/** The dependency names of a package.json, every section. */
const dependencyNames = (pkg: Parsed) => DEPENDENCY_SECTIONS.flatMap((section) => (isPlainObject(pkg?.[section]) ? Object.keys(pkg[section]) : []));

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
function backingFindings({ repoRoot, beView, catalog }: { repoRoot: string; beView: Parsed; catalog: Parsed }) {
  const declared = new Set<string>(beView.backing ?? []);
  const findings = [];
  for (const [service, entry] of Object.entries<Parsed>(catalog)) {
    const needing = (beView.patterns ?? []).filter((pattern: Parsed) => entry.patterns.includes(pattern));
    if (needing.length && !declared.has(service)) findings.push(found(HFS_BACKING_UNDECLARED, 'hfs.json', `hfs.json declares the ${needing.join(', ')} pattern, which runs on ${service}: declare ${service} in sides.be.backing`, { service, patterns: needing }));
  }
  const dependencies = new Set(dependencyNames(readJson(repoRoot, 'package.json')));
  for (const service of declared) {
    const clients = catalog[service]?.clients ?? [];
    if (!clients.some((name: string) => dependencies.has(name))) findings.push(found(HFS_BACKING_UNUSED, 'hfs.json', `hfs.json sides.be.backing declares ${service}, but no dependency consumes it (${clients.join(', ')}): remove the declaration, or add the capability that needs it`, { service }));
  }
  return findings;
}

/**
 * R212 for one scope (the app root or one side), over `files` (scope-relative). The declaration findings are judged from the be
 * side (its patterns and backing): the root scope looks at sides.be, a standalone be-side check at its own view.
 * `withDeclaration: false` (a side scope of a whole-app check) skips them: the root scope already reported them on hfs.json.
 */
export function editionFindings({ repoRoot, files, repo, manifest, withDeclaration = true }: { repoRoot: string; files: string[]; repo: Repo; manifest: Parsed; withDeclaration?: Parsed }) {
  let beView = null;
  if (withDeclaration && repo.profile === 'app') beView = repo.sides?.be;
  else if (withDeclaration && repo.profile === 'be') beView = repo;
  const catalog = backingCatalog(manifest);
  const findings = [
    ...(withDeclaration && repo.profile === 'app' ? deprecationFindings(repoRoot) : []),
    ...(beView ? backingFindings({ repoRoot, beView, catalog }) : []),
  ];
  const declared = new Set((repo.profile === 'app' ? repo.sides?.be?.backing : repo.backing) ?? []);
  for (const file of files) {
    if (file.includes('node_modules/') || !PACKAGE_JSON.test(file)) continue;
    const pkg = readJson(repoRoot, file);
    if (isPlainObject(pkg)) findings.push(...dependencyFindings(file, pkg, { catalog, declared }));
  }
  return findings;
}

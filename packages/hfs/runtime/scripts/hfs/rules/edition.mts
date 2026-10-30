// edition.mjs - L01, the edition rule. An hfs.json edition is `full` or `lite` (absent means full); under lite the standard is a
// filter plus a few additions over the same manifest, never a second engine. Lite declares Docker Swarm production infrastructure
// (owner:lite-production-swarm, ruling:R212/case-4): the same slots, patterns and unit specs, provider adapters behind the same
// ports, optional contract specs, and no e2e world (owner:lite-contract-specs). The slot layer already answers the paths lite
// removed (slots lite excludes, or whose litePresence is forbidden, come back HFS_FORBIDDEN_PRESENT with their goesTo);
// this rule reports what no path can state:
//   - inside a package.json: an e2e, test-world or browser script (`test:e2e`, `test:world`, `test:browser`,
//     with a pre/post prefix too) or a dependency of the infrastructure lite does not run - a test-world container or proxy
//     (testcontainers, toxiproxy) or a browser runner (playwright, cypress), and every library the lite infraOwners own nowhere
//     while full owns them (Kafka: the lite event bus runs pgmq);
//   - a declaration of what lite does not have: an app kind, pattern or trigger kind every slot of which is forbidden under
//     lite. The forbidden names are DERIVED from the manifest, so adding or restoring a kind is a manifest edit, not an edit here
//     (under the 2026-10-13 ruling no pattern, trigger or app kind is gone);
//   - a backing service that is not declared or not used (ruling:R212/case-10): a client library of a service of
//     ruleParams.be.backing (bullmq for redis) or a declared pattern that needs one (queue) while hfs.json sides.be.backing does
//     not declare it is HFS_BACKING_UNDECLARED, as is a service the catalog's editions excludes (owner:lite-vector-is-pgvector),
//     and a declared service no dependency of the app consumes is HFS_BACKING_UNUSED.
// A full app answers []: the rule tests the edition once and a full view forbids none of these names.
import { found, readJson } from './read.mjs';
import { DEPENDENCY_SECTIONS } from './fe-no-tests.mjs';
import { editionRuleParams, judgedInEdition } from '../edition-slots.mjs';
import type { Parsed, Repo, Resolver } from './rule-types.mjs';

export const HFS_EDITION_FORBIDDEN_PRESENT = 'HFS_EDITION_FORBIDDEN_PRESENT';
export const HFS_BACKING_UNDECLARED = 'HFS_BACKING_UNDECLARED';
export const HFS_BACKING_UNUSED = 'HFS_BACKING_UNUSED';

const PACKAGE_JSON = /(?:^|\/)package\.json$/;
/** The scripts of a world lite does not have: the e2e layer, the test world and the browser journey. */
const LITE_FORBIDDEN_SCRIPT = /^(?:pre|post)?test:(?:e2e|world|browser)$/;
/** The dependencies of a test infrastructure lite does not run: containers, fault proxies and browser runners. */
const LITE_FORBIDDEN_TEST_INFRA = /^(?:testcontainers|@testcontainers\/.+|toxiproxy-node-client|playwright|playwright-core|@playwright\/.+|cypress)$/;

/**
 * The names the edition cannot declare: for each of `pattern`, `trigger` and `appKind`, the value is gone when every slot of
 * the resolver's view that carries it is forbidden there. The view is the edition's own (full forbids none of them), so the
 * rule needs no edition test: a full app has nothing gone.
 */
function editionGone(resolver: Resolver) {
  const tally = new Map();
  for (const slot of resolver.slots()) {
    const forbidden = slot.presence === 'forbidden';
    for (const field of ['pattern', 'trigger', 'appKind']) {
      if (slot[field] === undefined) continue;
      const key = `${field}:${slot[field]}`;
      const entry = tally.get(key) ?? { total: 0, forbidden: 0 };
      entry.total += 1;
      entry.forbidden += forbidden ? 1 : 0;
      tally.set(key, entry);
    }
  }
  const gone: Record<string, Set<unknown>> = { pattern: new Set(), trigger: new Set(), appKind: new Set() };
  for (const [key, entry] of tally) {
    if (entry.total !== entry.forbidden) continue;
    const [field, name] = key.split(':');
    gone[field!]!.add(name);
  }
  return gone;
}

const isPlainObject = (value: Parsed) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The specifiers a lite back end may import nowhere although full gives them an owner: the infrastructure libraries the lite
 * infraOwners override removes (kafkajs). Read from the two rule-parameter views, never listed here.
 */
function liteRemovedLibraries(manifest: Parsed) {
  const be = manifest?.ruleParams?.be;
  if (!be) return new Set();
  const lite = editionRuleParams(be, 'lite').infraOwners ?? {};
  const full = editionRuleParams(be, 'full').infraOwners ?? {};
  return new Set(Object.keys(lite).filter((name) => lite[name].length === 0 && (full[name]?.length ?? 0) > 0));
}

function scriptFindings(rel: string, pkg: Parsed) {
  const scripts = isPlainObject(pkg.scripts) ? pkg.scripts : {};
  return Object.keys(scripts)
    .filter((name) => LITE_FORBIDDEN_SCRIPT.test(name))
    .map((name) => found(HFS_EDITION_FORBIDDEN_PRESENT, rel, `${rel} has script ${JSON.stringify(name)}: a lite app has unit specs, optional integration specs on the local db service and optional contract specs, never an e2e, test-world or browser run`, { name }));
}

/** The backing services of the manifest (ruleParams.be.backing): name -> {clients, patterns, images, editions?}. */
const backingCatalog = (manifest: Parsed) => manifest?.ruleParams?.be?.backing ?? {};

/** The backing service `name` is a client library of, or null. */
const serviceOfClient = (catalog: Parsed, name: string) => Object.keys(catalog).find((service) => catalog[service].clients.includes(name)) ?? null;

/** The dependency names of a package.json, every section. */
const dependencyNames = (pkg: Parsed) => DEPENDENCY_SECTIONS.flatMap((section) => (isPlainObject(pkg?.[section]) ? Object.keys(pkg[section]) : []));

function dependencyFindings(rel: string, pkg: Parsed, { removed, catalog, declared }: { removed: Parsed; catalog: Parsed; declared: Parsed }) {
  const findings = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!isPlainObject(deps)) continue;
    for (const name of Object.keys(deps)) {
      const service = serviceOfClient(catalog, name);
      if (LITE_FORBIDDEN_TEST_INFRA.test(name)) findings.push(found(HFS_EDITION_FORBIDDEN_PRESENT, rel, `${rel} ${section} has ${name}: a lite app runs no test containers, fault proxy or browser journey - its integration specs run against \`supabase start\``, { section, name }));
      else if (removed.has(name)) findings.push(found(HFS_EDITION_FORBIDDEN_PRESENT, rel, `${rel} ${section} has ${name}: lite runs no self-hosted Kafka - the event bus port is implemented on pgmq in the db service`, { section, name }));
      else if (service !== null && !judgedInEdition(catalog[service], 'lite')) findings.push(found(HFS_BACKING_UNDECLARED, rel, `${rel} ${section} has ${name}, a client of ${service}, which the lite edition does not admit: remove the dependency`, { section, name, service }));
      else if (service !== null && !declared.has(service)) findings.push(found(HFS_BACKING_UNDECLARED, rel, `${rel} ${section} has ${name}, a client of ${service}, which hfs.json sides.be.backing does not declare: declare ${service} for the capability that needs it, or remove the dependency`, { section, name, service }));
    }
  }
  return findings;
}

/** The findings one package.json's scripts and dependencies produce under lite. */
function packageFindings(repoRoot: string, rel: string, context: Parsed) {
  const pkg = readJson(repoRoot, rel);
  if (!isPlainObject(pkg)) return [];
  return [...scriptFindings(rel, pkg), ...dependencyFindings(rel, pkg, context)];
}

/**
 * The backing findings of the be declaration: a declared pattern whose service is undeclared, and (at the app root or a
 * standalone back end, whose package.json carries the back end's dependencies) a declared service no dependency consumes.
 */
function backingFindings({ repoRoot, beView, catalog, ownsPackage }: { repoRoot: string; beView: Parsed; catalog: Parsed; ownsPackage: Parsed }) {
  const declared = new Set<string>(beView.backing ?? []);
  const findings = [];
  for (const service of declared) {
    if (catalog[service] && !judgedInEdition(catalog[service], 'lite')) findings.push(found(HFS_BACKING_UNDECLARED, 'hfs.json', `hfs.json sides.be.backing declares ${service}, which the lite edition does not admit: remove the declaration`, { service }));
  }
  for (const [service, entry] of Object.entries<Parsed>(catalog)) {
    const needing = (beView.patterns ?? []).filter((pattern: Parsed) => entry.patterns.includes(pattern));
    if (needing.length && !declared.has(service)) findings.push(found(HFS_BACKING_UNDECLARED, 'hfs.json', `hfs.json declares the ${needing.join(', ')} pattern, which runs on ${service}: declare ${service} in sides.be.backing`, { service, patterns: needing }));
  }
  if (!ownsPackage) return findings;
  const dependencies = new Set(dependencyNames(readJson(repoRoot, 'package.json')));
  for (const service of declared) {
    if (!judgedInEdition(catalog[service], 'lite')) continue;
    const clients = catalog[service]?.clients ?? [];
    if (!clients.some((name: string) => dependencies.has(name))) findings.push(found(HFS_BACKING_UNUSED, 'hfs.json', `hfs.json sides.be.backing declares ${service}, but no dependency consumes it (${clients.join(', ')}): remove the declaration, or add the capability that needs it`, { service }));
  }
  return findings;
}

const goneAppFindings = (repo: Repo, gone: Parsed) => (repo.apps ?? [])
  .filter((app: Parsed) => gone.appKind.has(app.kind))
  .map((app: Parsed) => found(HFS_EDITION_FORBIDDEN_PRESENT, 'hfs.json', `hfs.json declares the ${app.kind} app ${app.name}: a ${app.kind} belongs to the full edition, a lite app has none`, { app: app.name, kind: app.kind }));

const goneNameFindings = (field: Parsed, verb: Parsed, declared: Parsed, goneNames: Parsed) => declared
  .filter((name: string) => goneNames.has(name))
  .map((name: string) => found(HFS_EDITION_FORBIDDEN_PRESENT, 'hfs.json', `hfs.json ${verb} the ${name} ${field}: ${name} belongs to the full edition, a lite app has none`, { name }));

/** The findings one be-side declaration produces under lite: a worker app, an event pattern or a gone trigger kind. */
function declarationFindings(repo: Repo, gone: Parsed) {
  return [
    ...goneAppFindings(repo, gone),
    ...goneNameFindings('pattern', 'declares', repo.patterns ?? [], gone.pattern),
    ...goneNameFindings('trigger', 'names', repo.kinds ?? [], gone.trigger),
  ];
}

/**
 * L01 for one scope (the app root or one side), over `files` (scope-relative). The declaration findings are judged from the be
 * side (its apps, patterns and kinds): the root scope looks at sides.be, a standalone be-side check at its own view.
 * `withDeclaration: false` (a side scope of a whole-app check) skips them: the root scope already reported them on hfs.json.
 * The package findings read every package.json of the scope under lite.
 */
export function editionFindings({ repoRoot, files, repo, resolver, manifest, withDeclaration = true }: { repoRoot: string; files: string[]; repo: Repo; resolver: Resolver; manifest: Parsed; withDeclaration?: Parsed }) {
  if ((repo.edition ?? 'full') !== 'lite') return [];
  const gone = editionGone(resolver);
  let beView = null;
  if (withDeclaration && repo.profile === 'app') beView = repo.sides?.be;
  else if (withDeclaration && repo.profile === 'be') beView = repo;
  const catalog = backingCatalog(manifest);
  const findings = beView ? [...declarationFindings(beView, gone), ...backingFindings({ repoRoot, beView, catalog, ownsPackage: true })] : [];
  const declared = new Set((repo.profile === 'app' ? repo.sides?.be?.backing : repo.backing) ?? []);
  const context = { removed: liteRemovedLibraries(manifest), catalog, declared };
  for (const file of files) {
    if (file.includes('node_modules/') || !PACKAGE_JSON.test(file)) continue;
    findings.push(...packageFindings(repoRoot, file, context));
  }
  return findings;
}

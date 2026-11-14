// data-sets.mts - R427: every copy is written through a driver (contexts/project/stacks.md PROJECT-STACKS-14), over `data.sets[]` of
// .starcistacks/application-stacks.yaml:
//   DATA_PURPOSE               a set with no id (or a twin), a purpose outside {seed-standard, seed-backup}, no or an unknown store, no or an
//                              unknown environment (stores name declared stores, environments name declared environments);
//   DATA_DRIVER_KIND           a set with no destination, a driver outside {git, s3}, or a git destination without a repository;
//   DATA_COPY_NAME             a git repository (its last path segment, without .git) that does not end -seed-standard for a standard, or for a
//                              backup does not carry {env} and end -seed-backup-<env> for each of the set's environments (<env> = the environment's declared `short`,
//                              else its name; a `short` that is not lowercase kebab of at most 12 characters, or two environments with one label);
//   DATA_SEED_UNPINNED         a seed-standard without `commit`, a 40-hex pin;
//   DATA_FORCE_MISPLACED       `force` (a boolean) on a backup, `commit` on a backup, `everyMinutes` or `maxAgeMinutes` on a standard, a `maxAgeMinutes` that is not a whole number;
//   DATA_BACKUP_LOADED         a seeds.yaml entry of any level, or a document it names, mentions a -seed-backup repository: a backup is
//                              never loaded by a bring-up;
//   DATA_EXTENSION_UNDECLARED  `completeness` is not `ext:<id>` of a check ext/manifest.json declares.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

// The closed lists are owned by `@starci/seed` src/words.ts (DATA_PURPOSES, DRIVER_KINDS); @starci/hfs does not depend on it, so they are copied.
/** The purposes of a data set. */
export const DATA_PURPOSES: readonly string[] = ['seed-standard', 'seed-backup'];
/** The drivers a copy may be written through. */
export const DRIVER_KINDS: readonly string[] = ['git', 's3'];

const STACK_FILE = '.starcistacks/application-stacks.yaml';
const mapping = (value: unknown): Record<string, Parsed> => (plain(value) ? value as Record<string, Parsed> : {});
const list = (value: unknown): Parsed[] => (Array.isArray(value) ? value : []);
const present = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const COMMIT = /^[0-9a-f]{40}$/u;

/** The last path segment of a repository URL or path, without a trailing slash or `.git`. */
export const repositoryName = (repository: string): string => repository.replace(/[\\/]+$/u, '').split(/[\\/:]/u).pop()!.replace(/\.git$/u, '');

/** The `short` an environment declares: lowercase kebab, at most 12 characters. */
const SHORT_NAME = /^[a-z][a-z0-9-]{0,11}$/u;

/** The `<env>` of an environment's backup repository: its declared `short`, else its name (PROJECT-STACKS-13). */
export function environmentLabel(environments: unknown, env: string): string {
  const declared = plain(environments) && plain(environments[env]) ? environments[env].short : undefined;
  return typeof declared === 'string' && declared !== '' ? declared : env;
}

/** The repository of a destination for one environment: `{env}` becomes the environment's label (short name, else name). */
export const resolveRepository = (template: string, label: string): string => template.replaceAll('{env}', label);

/** DATA_COPY_NAME for one git destination of a set; the returned strings are the reasons. `labelOf` maps an environment to its `<env>`. */
function nameProblems(purpose: string, repository: string, environments: readonly string[], labelOf: (env: string) => string): string[] {
  const name = repositoryName(repository);
  if (purpose === 'seed-standard') return name.endsWith('-seed-standard') ? [] : [`the repository ${name} of a seed-standard must end -seed-standard`];
  if (!name.includes('{env}')) return [`the repository ${name} of a seed-backup must carry {env}: one repository per environment, ending -seed-backup-<env> (the environment's short name, else its name)`];
  return environments.filter((env) => !resolveRepository(name, labelOf(env)).endsWith(`-seed-backup-${labelOf(env)}`)).map((env) => `the repository ${resolveRepository(name, labelOf(env))} of the seed-backup for ${env} must end -seed-backup-${labelOf(env)}`);
}

/** DATA_COPY_NAME for the `short` names of the environments: each is lowercase kebab of at most 12 characters, and no two environments share a label (their backup repositories would be one). */
function shortProblems(environments: Record<string, Parsed>): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string>();
  for (const env of Object.keys(environments)) {
    const entry = environments[env];
    if (plain(entry) && entry.short !== undefined && !(typeof entry.short === 'string' && SHORT_NAME.test(entry.short))) problems.push(`environments.${env}.short ${JSON.stringify(entry.short)} must be lowercase kebab of at most 12 characters`);
    const label = environmentLabel(environments, env);
    const other = owners.get(label);
    if (other !== undefined) problems.push(`the environments ${other} and ${env} share the backup name ${label}: their seed-backup repositories would be one (declare a distinct short)`);
    else owners.set(label, env);
  }
  return problems;
}

/** DATA_PURPOSE, DATA_DRIVER_KIND, DATA_COPY_NAME, DATA_SEED_UNPINNED, DATA_FORCE_MISPLACED and DATA_EXTENSION_UNDECLARED over a parsed stack declaration. `extensionChecks` are the check ids of ext/manifest.json. Pure. */
export function dataSetFindings(doc: Parsed, extensionChecks: ReadonlySet<string>): Finding[] {
  const data = plain(doc) ? doc.data : undefined;
  if (!plain(data) || data.sets === undefined) return [];
  const findings: Finding[] = [];
  const at = (code: string, where: string, message: string, extra: Record<string, unknown> = {}) => findings.push(found(code, STACK_FILE, `data.${where}: ${message} (PROJECT-STACKS-14)`, extra));
  const stores = new Set(list(data.stores).flatMap((store: Parsed) => (plain(store) && present(store.id) ? [store.id] : [])));
  const environments = new Set(Object.keys(mapping(doc.environments)));
  const ids = new Set<string>();
  for (const problem of shortProblems(mapping(doc.environments))) at('DATA_COPY_NAME', 'environments', problem);
  list(data.sets).forEach((set: Parsed, index: number) => {
    const where = `sets[${String(index)}]`;
    if (!plain(set)) { at('DATA_PURPOSE', where, 'a data set is a mapping {id, purpose, stores, environments, to}'); return; }
    if (!present(set.id)) at('DATA_PURPOSE', where, 'a data set needs an id');
    else if (ids.has(set.id)) at('DATA_PURPOSE', where, `the data set id ${set.id} is declared twice`);
    else ids.add(set.id);
    const purpose = DATA_PURPOSES.includes(set.purpose) ? set.purpose as string : null;
    if (purpose === null) at('DATA_PURPOSE', where, `purpose ${JSON.stringify(set.purpose ?? null)} must be seed-standard or seed-backup`, { set: set.id });
    const named = list(set.stores).filter(present), envs = list(set.environments).filter(present);
    if (named.length === 0) at('DATA_PURPOSE', where, 'stores must name at least one declared store', { set: set.id });
    for (const store of named.filter((id: string) => !stores.has(id))) at('DATA_PURPOSE', where, `stores names ${store}, which data.stores does not declare`, { set: set.id });
    if (envs.length === 0) at('DATA_PURPOSE', where, 'environments must name at least one declared environment', { set: set.id });
    for (const env of envs.filter((name: string) => !environments.has(name))) at('DATA_PURPOSE', where, `environments names ${env}, which the stack does not declare`, { set: set.id });

    const to = list(set.to);
    if (to.length === 0) at('DATA_DRIVER_KIND', where, 'to must name at least one destination {driver, repository}', { set: set.id });
    to.forEach((destination: Parsed, at2: number) => {
      const here = `${where}.to[${String(at2)}]`;
      if (!plain(destination) || !DRIVER_KINDS.includes(destination.driver)) { at('DATA_DRIVER_KIND', here, `driver ${JSON.stringify(plain(destination) ? destination.driver ?? null : null)} is outside the closed list (${DRIVER_KINDS.join(', ')}); a new driver is a harness change`, { set: set.id }); return; }
      if (destination.driver !== 'git') return;
      if (!present(destination.repository)) { at('DATA_DRIVER_KIND', here, 'a git destination names its repository (a URL or a path)', { set: set.id }); return; }
      if (purpose !== null) for (const problem of nameProblems(purpose, destination.repository, envs, (env) => environmentLabel(doc.environments, env))) at('DATA_COPY_NAME', here, problem, { set: set.id });
    });

    if (purpose === 'seed-standard' && !(typeof set.commit === 'string' && COMMIT.test(set.commit))) at('DATA_SEED_UNPINNED', where, 'a seed-standard is pinned by commit: a 40-hex `commit`', { set: set.id });
    if (purpose === 'seed-standard' && set.force !== undefined && typeof set.force !== 'boolean') at('DATA_FORCE_MISPLACED', where, 'force is a boolean', { set: set.id });
    if (purpose === 'seed-standard') for (const key of ['everyMinutes', 'maxAgeMinutes']) if (set[key] !== undefined) at('DATA_FORCE_MISPLACED', where, `${key} belongs to a seed-backup only`, { set: set.id });
    if (purpose === 'seed-backup' && set.maxAgeMinutes !== undefined && !(Number.isInteger(set.maxAgeMinutes) && set.maxAgeMinutes >= 1)) at('DATA_FORCE_MISPLACED', where, 'maxAgeMinutes is a whole number of minutes, at least 1', { set: set.id });
    if (purpose === 'seed-backup') for (const key of ['force', 'commit']) if (set[key] !== undefined) at('DATA_FORCE_MISPLACED', where, `${key} belongs to a seed-standard only`, { set: set.id });

    if (set.completeness !== undefined) {
      const id = typeof set.completeness === 'string' && set.completeness.startsWith('ext:') ? set.completeness.slice(4) : null;
      if (id === null || !extensionChecks.has(id)) at('DATA_EXTENSION_UNDECLARED', where, `completeness ${JSON.stringify(set.completeness)} must be ext:<id> of a check that ext/manifest.json declares`, { set: set.id });
    }
  });
  return findings;
}

const SEED_LEVELS = /^\.starcistacks\/(?:seeds|[^/]+\/seeds)\/seeds\.ya?ml$/u;
const BACKUP_REPOSITORY = /-seed-backup/u;

/** DATA_BACKUP_LOADED over the seed manifests of every level: `all` the tracked tree, `source` a tracked file's text. */
export function backupLoadedFindings(all: readonly string[], source: (file: string) => string | null): Finding[] {
  const findings: Finding[] = [];
  for (const manifest of all.filter((file) => SEED_LEVELS.test(file))) {
    const level = manifest.slice(0, manifest.lastIndexOf('/') + 1);
    let doc: Parsed;
    try { doc = parseYaml(source(manifest) ?? ''); } catch { continue; }
    for (const entry of list(plain(doc) ? doc.entries : undefined)) {
      if (BACKUP_REPOSITORY.test(JSON.stringify(entry ?? null))) findings.push(found('DATA_BACKUP_LOADED', manifest, `${manifest} has an entry that names a -seed-backup repository: a backup is read only by an explicit sync into the same environment, never by a bring-up (PROJECT-STACKS-13)`, { entry: plain(entry) ? entry.id : undefined }));
      const target = plain(entry) && present(entry.path) ? `${level}${entry.path.replace(/^\.?\//u, '').replace(/\/+$/u, '')}` : null;
      if (target === null) continue;
      for (const file of all.filter((name) => name === target || name.startsWith(`${target}/`))) {
        if (BACKUP_REPOSITORY.test(source(file) ?? '')) findings.push(found('DATA_BACKUP_LOADED', file, `${file}, loaded by an entry of ${manifest}, names a -seed-backup repository: a backup is read only by an explicit sync into the same environment, never by a bring-up (PROJECT-STACKS-13)`, { entry: plain(entry) ? entry.id : undefined }));
      }
    }
  }
  return findings;
}

/** Findings of R427 at the app root of an app. */
export function dataSetsFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const stack = findStackDeclaration(repoRoot);
  const checks = list(readJson(repoRoot, 'ext/manifest.json')?.checks).flatMap((check: Parsed) => (plain(check) && present(check.id) ? [check.id] : []));
  return [...(stack.doc ? dataSetFindings(stack.doc, new Set(checks)) : []), ...backupLoadedFindings(all, (file) => readText(repoRoot, file))];
}

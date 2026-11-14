// declaration.mts - the `data:` member of .starcistacks/application-stacks.yaml as `starci app data` reads it (PROJECT-STACKS-13, PROJECT-STACKS-14):
// the stores with the argv of the app command that serves each, the seed-backup sets, and the label (`short` name, else name) of each environment.
// R426 and R427 judge the declaration; this reads what they accepted and refuses what a verb cannot act on.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { environmentLabel, repositoryName, resolveRepository } from '../runtime/scripts/hfs/rules/data-sets.mjs';
import { readDeclaration } from '../release/index.mjs';
import { refusal } from '../stack/errors.mjs';

/** The age, in minutes, a backup may have and still protect a target from a sync (PROJECT-STACKS-6, the reset rule). */
export const DEFAULT_MAX_AGE_MINUTES = 1440;

/** A store of `data.stores` with the argv that serves it (null when it declares none). */
export interface DeclaredStore { id: string; kind: 'database' | 'storage'; level: 'logical' | 'physical'; command: readonly string[] | null }
/** A destination of a set. */
export interface DeclaredDestination { driver: string; repository: string | null }
/** A set of `data.sets`. */
export interface DeclaredSet { id: string; purpose: string; stores: readonly string[]; environments: readonly string[]; to: readonly DeclaredDestination[]; maxAgeMinutes: number }
/** What the verbs read of the stack declaration. */
export interface DataDeclaration {
  /** The project `hfs.json` names. */
  project: string;
  /** Every environment's name and the label its backup repository carries. */
  environments: ReadonlyMap<string, string>;
  stores: readonly DeclaredStore[];
  sets: readonly DeclaredSet[];
}

const words = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []);

/** The declaration of the app at `root`; no `data:` member, no environment or an unreadable hfs.json is a refusal. */
export function loadDataDeclaration(root: string): DataDeclaration {
  const doc = readDeclaration(root);
  const data: Record<string, unknown> = plain(doc.data) ? doc.data : {};
  let project: string;
  try { project = String((JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) as { project?: unknown }).project ?? ''); } catch { project = ''; }
  if (project === '') throw refusal('DATA_DECLARATION_MISSING', 'hfs.json names no project');
  const environments = new Map<string, string>(Object.keys(plain(doc.environments) ? doc.environments : {}).map((env) => [env, environmentLabel(doc.environments, env)]));
  const stores = (Array.isArray(data.stores) ? data.stores : []).flatMap((store: unknown): DeclaredStore[] => {
    if (!plain(store) || typeof store.id !== 'string') return [];
    const command = plain(store.adapter) && Array.isArray(store.adapter.command) ? words(store.adapter.command) : null;
    return [{ id: store.id, kind: store.kind === 'storage' ? 'storage' : 'database', level: store.level === 'physical' ? 'physical' : 'logical', command: command !== null && command.length > 0 ? command : null }];
  });
  const sets = (Array.isArray(data.sets) ? data.sets : []).flatMap((set: unknown): DeclaredSet[] => {
    if (!plain(set) || typeof set.id !== 'string') return [];
    const to = (Array.isArray(set.to) ? set.to : []).flatMap((destination: unknown): DeclaredDestination[] =>
      (plain(destination) && typeof destination.driver === 'string' ? [{ driver: destination.driver, repository: typeof destination.repository === 'string' ? destination.repository : null }] : []));
    const age = set.maxAgeMinutes;
    return [{ id: set.id, purpose: String(set.purpose ?? ''), stores: words(set.stores), environments: words(set.environments), to,
      maxAgeMinutes: typeof age === 'number' && Number.isInteger(age) && age >= 1 ? age : DEFAULT_MAX_AGE_MINUTES }];
  });
  if (sets.length === 0) throw refusal('DATA_DECLARATION_MISSING', 'the stack declaration has no data.sets: there is no copy to read');
  return { project, environments, stores, sets };
}

/** The environment `name`, refused when the stack does not declare it. */
export function requireEnvironment(declaration: DataDeclaration, name: string): string {
  if (!declaration.environments.has(name)) throw refusal('DATA_USAGE', `--env ${name} is not an environment of the stack (${[...declaration.environments.keys()].join(', ')})`);
  return declaration.environments.get(name) as string;
}

/** The first git destination of a set resolved for one environment: its repository (`{env}` replaced by the label) and name; null when the set names no git destination. */
export function gitDestination(declaration: DataDeclaration, set: DeclaredSet, env: string): { repository: string; name: string } | null {
  const label = declaration.environments.get(env) ?? env;
  for (const destination of set.to) {
    if (destination.driver !== 'git' || destination.repository === null) continue;
    const repository = resolveRepository(destination.repository, label);
    return { repository, name: repositoryName(repository) };
  }
  return null;
}

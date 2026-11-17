// standard-load.mts - the seed step's loader of the seed-standards an environment loads (contexts/project/stacks.md PROJECT-STACKS-13, "One
// path in"). After the gate of standard-gate.mts verified every pin (R434), each pin is read at its commit through `pinRepository` and the git
// driver of @starci/seed (the driver's own verify, then its read) and applied through the app's seed door: the `adapter.command` each store
// declares, served with `serveStore` over the line protocol starci/data-entries@1 (`import <options>`, the entry lines on stdin, the
// ImportReport as its last protocol line: a line marked `starci/data-entries@1 `, or its last JSON object line from a door that marks none; log lines the app framework writes around it are left out), run by the seed step's own command runner (the api's environment on a dev stack, the jobs service on a
// deploy). The apply is `restoreFrom` in mode merge: an upsert by natural key that keeps each row's identity and removes nothing. A dry run
// through every door (mode mirror, nothing written) comes first, so a door that refuses a key refuses the pin before any record applies, and
// its `removed` count is what the standard no longer names: reported, and left. One receipt per (standard, commit) in the seed receipts
// (scope `standard`, id `<set>@<commit>`, hash the manifest's export digest), written only once every store of the pin applied: a receipt
// already present skips the pin; a first pin applies; a pin that differs from the one applied is reported DATA_STANDARD_CHANGED and applies
// only when the set declares `force: true`, once per pinned commit. A set a project kind judges (`completeness: ext:<check>`) is the
// project's: standardPins leaves it out, as the gate does, and the loader names it and reads nothing.
import path from 'node:path';
import { commandStore, restoreFrom } from '@starci/seed';
import type { CommandRunner, CopyRef, ExportSource, ImportReport, OpenContext, StoreAdapter } from '@starci/seed';
import { createGitDriver, pinRepository } from '@starci/seed/git';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { readDeclaration } from '../release/index.mjs';
import type { RunResult } from './context.mjs';
import { StackError, failure, refusal } from './errors.mjs';
import { STANDARD_SCOPE, pinRunner } from './standard-gate.mjs';
import type { StandardPin } from './standard-gate.mjs';

/** The receipt id of an applied pin: one receipt per (standard, commit). A verified-only receipt (the gate's) is the set's id alone. */
export const appliedId = (pin: Pick<StandardPin, 'set' | 'commit'>): string => `${pin.set}@${pin.commit}`;

/** A store of `data.stores` as the loader reaches it: its id, kind, level and the argv of the app command that serves it (null: none). */
export interface StandardStore { id: string; kind: 'database' | 'storage'; level: 'logical' | 'physical'; command: readonly string[] | null }

/** Reads a pin at its commit and answers the standard as one export; refuses an unhealthy or foreign copy STACK_SEED_STANDARD_SCHEMA. */
export type StandardReader = (pin: StandardPin) => Promise<ExportSource>;

/** The seed door of one store: the store reached through its app command. */
export type SeedDoor = (store: StandardStore) => StoreAdapter;

/** What the loader writes once a pin applied: its receipt (the seed step runs it as one transaction). */
export type ReceiptWriter = (pin: StandardPin, exportDigest: string, outcome: string) => void;

/** A receipt row the loader reads. */
interface ReceiptRow { scope: string; id: string; hash: string }

/** The stores `data.stores` declares, from the app at `repoRoot`. R426 judges the declaration; this reads what a door needs. */
export function standardStores(repoRoot: string): StandardStore[] {
  const doc = readDeclaration(repoRoot);
  const stores: unknown[] = plain(doc.data) && Array.isArray(doc.data.stores) ? doc.data.stores : [];
  return stores.flatMap((store): StandardStore[] => {
    if (!plain(store) || typeof store.id !== 'string') return [];
    const argv = plain(store.adapter) && Array.isArray(store.adapter.command) ? store.adapter.command.filter((part: unknown): part is string => typeof part === 'string' && part !== '') : [];
    return [{ id: store.id, kind: store.kind === 'storage' ? 'storage' : 'database', level: store.level === 'physical' ? 'physical' : 'logical', command: argv.length > 0 ? argv : null }];
  });
}

/** The seed-standards of `env` a project kind judges (`completeness: ext:<check>`): the loader names them and leaves them to the project. */
export function extensionStandards(repoRoot: string, env: string): Array<{ set: string; completeness: string }> {
  const doc = readDeclaration(repoRoot);
  const sets: unknown[] = plain(doc.data) && Array.isArray(doc.data.sets) ? doc.data.sets : [];
  return sets.flatMap((set) => (plain(set) && set.purpose === 'seed-standard' && typeof set.id === 'string' && typeof set.completeness === 'string'
    && Array.isArray(set.environments) && set.environments.includes(env) ? [{ set: set.id, completeness: set.completeness }] : []));
}

const short = (commit: string): string => commit.slice(0, 12);
const named = (pin: StandardPin): string => `${pin.name}@${short(pin.commit)}`;
/** A standard is plaintext: its read opens nothing, so the handle carries no identity. */
const NO_IDENTITY: OpenContext = { identity: { kind: 'age-identity', env: {} } };

/**
 * The reader of the seed step: the pin through `pinRepository` (the same bare mirror under `cache` the gate fills), then the git driver of
 * @starci/seed over that mirror at the commit: its verify (manifest, sealing, files, cap and every digest) and its read.
 */
export function pinnedStandardReader({ cache }: { cache: string }): StandardReader {
  return async (pin) => {
    pinRepository({ repository: pin.repository, commit: pin.commit, cache, name: pin.name, run: pinRunner });
    const driver = createGitDriver({ id: pin.name, checkout: path.join(cache, `${pin.name}.git`), run: pinRunner });
    const ref: CopyRef = { driver: pin.name, kind: 'git', locator: pin.commit, exportDigest: '', takenAt: '' };
    const verdict = await driver.verify(ref, null);
    const failed = verdict.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
    if (!verdict.healthy || verdict.manifest === null) throw refusal('STACK_SEED_STANDARD_SCHEMA', `${named(pin)} of the set ${pin.set} is no healthy starci/data-manifest@1 copy (${failed.join('; ') || 'no manifest'}): nothing of it was applied`);
    return driver.read(ref, NO_IDENTITY);
  };
}

/** Splits a command's stdout into lines. */
const outputLines = (stdout: string): string[] => stdout.split(/\r?\n/u);

/**
 * The seed door over the seed step's command runner: `commandStore` of @starci/seed, its argv the store's `adapter.command`, the entry lines
 * joined on stdin. A store that declares no command has no door (STACK_SEED_STORE_COMMAND); a command that exits non-zero fails with its store
 * id and exit code only, its output withheld.
 */
export function commandDoor(command: (argv: readonly string[], input: string) => RunResult): SeedDoor {
  return (store) => {
    const argv = store.command;
    if (argv === null) throw refusal('STACK_SEED_STORE_COMMAND', `the store ${store.id} declares no adapter.command: the app command that serves it over starci/data-entries@1 is the seed door a standard is applied through (PROJECT-STACKS-14)`);
    const runner: CommandRunner = (args, input) => (async function* lines(): AsyncGenerator<string> {
      let stdin = '';
      if (input !== undefined) for await (const line of input) stdin += `${line}\n`;
      const run = command([...argv, ...args], stdin);
      if (run.error || run.status !== 0) throw new Error(`the door of the store ${store.id} ${run.error ? 'could not run' : `exited ${String(run.status)}`}; its output is withheld`);
      yield* outputLines(run.stdout);
    })();
    return commandStore({ id: store.id, kind: store.kind, level: store.level }, runner);
  };
}

/** The keys a door refused, by set and code; never a value. */
const refusedOf = (reports: readonly ImportReport[]): string[] =>
  reports.flatMap((report) => report.sets.filter((item) => item.refused.length > 0).map((item) => `${item.set}: ${String(item.refused.length)} key(s) refused (${[...new Set(item.refused.map((key) => key.code))].join(', ')})`));

/** Runs the imports of one pass through the doors; a door that fails or answers no report is a refusal of the pin. */
async function through(pin: StandardPin, source: ExportSource, doors: readonly StoreAdapter[], dryRun: boolean): Promise<readonly ImportReport[]> {
  let reports: readonly ImportReport[];
  try {
    reports = await restoreFrom(source, doors, { dryRun, mode: dryRun ? 'mirror' : 'merge' });
  } catch (error) {
    if (error instanceof StackError) throw error;
    const reason = error instanceof Error && error.message.startsWith('the door of the store') ? error.message : 'a door answered no ImportReport (a line marked starci/data-entries@1, or a JSON object line)';
    throw failure('STACK_SEED_DOOR_REFUSED', `${named(pin)} of the set ${pin.set}: ${reason}; ${dryRun ? 'nothing of the pin was applied' : 'no receipt was written, so the next bring-up applies the pin again (an upsert by natural key)'}`);
  }
  const refused = refusedOf(reports);
  if (refused.length > 0) {
    throw failure('STACK_SEED_DOOR_REFUSED', `${named(pin)} of the set ${pin.set}: the seed door refused ${refused.join('; ')}; ${dryRun ? 'nothing of the pin was applied (the dry run through every door refused it first)' : 'no receipt was written, so the next bring-up applies the pin again'}`);
  }
  return reports;
}

/** The counts of the applied pass, per set; and what the dry run's mirror would have removed, which the standard no longer names and is left. */
function countsLine(applied: readonly ImportReport[], planned: readonly ImportReport[]): string {
  const counts = applied.flatMap((report) => report.sets.map((item) => `${item.set}: ${String(item.created)} created, ${String(item.updated)} updated, ${String(item.unchanged)} unchanged`));
  const left = planned.reduce((sum, report) => sum + report.sets.reduce((total, item) => total + item.removed, 0), 0);
  return `${counts.join('; ') || 'no set'}${left > 0 ? `; ${String(left)} key(s) the standard no longer names left in place` : ''}`;
}

/** The stores a pin's copy fills, each with its door; a store the set does not declare, or that has no door, refuses the pin before any import. */
function doorsOf(pin: StandardPin, source: ExportSource, stores: readonly StandardStore[], door: SeedDoor): StoreAdapter[] {
  const filled = [...new Set(source.manifest.sets.map((set) => set.store))].sort();
  return filled.map((id) => {
    if (!pin.stores.includes(id)) throw refusal('STACK_SEED_STANDARD_SCHEMA', `${named(pin)} carries the store ${id}, which the set ${pin.set} does not list in its stores (${pin.stores.join(', ') || 'none'}): nothing of it was applied`);
    const store = stores.find((item) => item.id === id);
    if (store === undefined) throw refusal('STACK_SEED_STORE_COMMAND', `${named(pin)} fills the store ${id}, which data.stores does not declare: there is no seed door for it`);
    return door(store);
  });
}

/** Reads a pin; a pin that cannot be fetched or read is STACK_SEED_STANDARD_UNREADABLE, a refusal of the reader stands as it is. */
async function readPin(pin: StandardPin, read: StandardReader): Promise<ExportSource> {
  try {
    const source = await read(pin);
    if (source.manifest.purpose !== 'seed-standard') throw refusal('STACK_SEED_STANDARD_SCHEMA', `${named(pin)} of the set ${pin.set} holds a ${source.manifest.purpose} copy, not a seed-standard: nothing of it was applied`);
    return source;
  } catch (error) {
    if (error instanceof StackError) throw error;
    const code = (error as { code?: unknown }).code;
    throw refusal('STACK_SEED_STANDARD_UNREADABLE', `${named(pin)} of the set ${pin.set} cannot be read at its pin${typeof code === 'string' ? ` (${code})` : ''}: nothing of it was applied`);
  }
}

/** What the loader is given by the seed step. */
export interface LoadInput {
  pins: readonly StandardPin[];
  extensions: ReadonlyArray<{ set: string; completeness: string }>;
  /** The receipts of the seed step's table, in the order they were written. */
  receipts: readonly ReceiptRow[];
  execute: boolean;
  stores: readonly StandardStore[];
  read: StandardReader;
  door: SeedDoor;
  record: ReceiptWriter;
}

/** The commit a set was last applied at, from its receipts (`<set>@<commit>`), or null when it never was. */
function lastApplied(receipts: readonly ReceiptRow[], set: string): string | null {
  const ids = receipts.filter((row) => row.scope === STANDARD_SCOPE && row.id.startsWith(`${set}@`)).map((row) => row.id.slice(set.length + 1));
  return ids.at(-1) ?? null;
}

/** Loads one pin: kept, reported, planned or applied with its receipt; answers its line and whether it applied. */
async function loadPin(input: LoadInput, pin: StandardPin): Promise<{ line: string; applied: boolean }> {
  const name = `seed ${STANDARD_SCOPE}/${pin.set}`;
  if (input.receipts.some((row) => row.scope === STANDARD_SCOPE && row.id === appliedId(pin))) return { line: `${name}: kept (${named(pin)} applied before, once per pin)`, applied: false };
  const previous = lastApplied(input.receipts, pin.set);
  if (previous !== null && !pin.force) {
    return { line: `${name}: DATA_STANDARD_CHANGED: pinned ${named(pin)}, applied ${short(previous)}; not re-seeded: a changed pin applies only when the set declares force: true, once per pinned commit (PROJECT-STACKS-13)`, applied: false };
  }
  const forced = previous === null ? '' : `, forced (DATA_STANDARD_CHANGED from ${short(previous)})`;
  if (!input.execute) return { line: `plan ${name}: apply ${named(pin)} through the seed doors of ${pin.stores.join(', ') || 'no store'}${forced}, an upsert by natural key`, applied: false };
  const source = await readPin(pin, input.read);
  const doors = doorsOf(pin, source, input.stores, input.door);
  const planned = await through(pin, source, doors, true);
  const applied = await through(pin, source, doors, false);
  const outcome = applied.some((report) => report.outcome === 'applied') ? 'applied' : 'unchanged';
  input.record(pin, source.manifest.exportDigest, `${previous === null ? '' : 'forced '}${outcome}`);
  return { line: `${name}: ${outcome} ${named(pin)}${forced} (${countsLine(applied, planned)})`, applied: true };
}

/**
 * The loader: per pin, in declaration order, after the gate; the sets a project kind judges are named and left. Answers its lines and the
 * pins it applied (`standard/<set>`). A refusal stops the step: the pins before it keep their receipts, the refused one writes none.
 */
export async function loadStandards(input: LoadInput): Promise<{ lines: string[]; applied: string[] }> {
  const lines: string[] = input.extensions.map((item) => `seed ${STANDARD_SCOPE}/${item.set}: left to the project (completeness ${item.completeness}: its own check judges the copy and it reads it through pinRepository)`);
  const applied: string[] = [];
  for (const pin of input.pins) {
    const done = await loadPin(input, pin);
    lines.push(done.line);
    if (done.applied) applied.push(`${STANDARD_SCOPE}/${pin.set}`);
  }
  return { lines, applied };
}

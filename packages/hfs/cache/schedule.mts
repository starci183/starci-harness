// schedule.mts - the orchestration of `starci app check` (contexts/project/check-cache.md, "Orchestration"): the steps of the run, their order and each step's priority, declared
// once below, and the scheduler that runs them. The steps run one after another, never two at once: the next is the ready step (every step it needs has ended) of the highest
// priority, whatever the verdict of the ones before it, so a red family never stops another and one run reports every finding. `app check` holds no heavy-command slot of its
// own: it is the orchestrator. Each heavy child a step starts (a tsc program, an ESLint chunk, the jest run, a build step, the boot proof, the contract compiler, the Sonar
// scanner) is admitted by the CLI's governor when the step starts it, from the RAM free at that moment, so a step sizes itself on the whole room the host has then: the jest run
// takes the workers that room holds, and the ESLint chunks and tsc programs of a step run together as far as the room and the run's CPU lanes (cores - 1) allow. A
// single-process child holds one lane for its run. The records each step writes stay its family's own folders (one writer each); the fingerprint is taken once before the steps,
// the flush once after.
import type { HeavyAdmission, HeavyNodeRequest, HeavyNodeResult, HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import type { ParityRun } from './parity-family.mjs';

/** A step of the run: a family, or a part of the run that reads the results of others. */
export type StepId = 'test' | 'types' | 'lint' | 'wiring' | 'hfs' | 'format' | 'db' | 'checks' | 'audit' | 'coverage' | 'sonar' | 'ratchet' | 'build' | 'sonar-scan';

/** One step: what must have ended before it starts, and its place in the sequence. */
export interface StepSpec {
  readonly id: StepId;
  readonly after: readonly StepId[];
  /** Of the steps ready to start, the one with the highest priority runs next: the unit run, then lint, the structure pass, tsc, the rest. */
  readonly priority: number;
  /** Where the step's results live, app-relative (the committed cache folders) or the host folder it uses. */
  readonly cache: string;
}

/**
 * The steps of `app check` with what each needs and its priority, declared once. They run in this order, one at a time, a step starting only after every step it needs has ended:
 *   - coverage (CI's coverage step) and sonar (the baselines) read the coverage the test family merged: after test.
 *   - ratchet reads the lint records of this run: after lint.
 *   - checks runs the project checks hfs.json declares (cache/project-checks.mts) whenever the structure family runs; it reads no other step.
 *   - build runs CI's typecheck script (build:modules, then codegen, then tsc), `build:be` and each `build fe`: codegen and build:modules rewrite the
 *     generated code and the root packages' dist that the tsc programs, the typed lint, the unit specs and the boot proof read, so build starts after them.
 *   - sonar-scan uploads the findings and the lint report of every step but the ratchet and runs only when they are green: after all of them.
 */
export const CHECK_GRAPH: readonly StepSpec[] = [
  { id: 'test', after: [], priority: 90, cache: '.starcistacks/cache/test-coverage' },
  { id: 'types', after: [], priority: 60, cache: '.starcistacks/cache/check/types' },
  { id: 'lint', after: [], priority: 80, cache: '.starcistacks/cache/lint' },
  { id: 'wiring', after: [], priority: 50, cache: '.starcistacks/cache/check/wiring' },
  { id: 'hfs', after: [], priority: 70, cache: '.starcistacks/cache/check/hfs, check/secrets' },
  { id: 'format', after: [], priority: 40, cache: '.starcistacks/cache/check/format' },
  { id: 'db', after: [], priority: 35, cache: '.starcistacks/cache/check/db' },
  { id: 'checks', after: [], priority: 33, cache: 'none (never cached: a project check reads what it reads)' },
  { id: 'audit', after: [], priority: 30, cache: 'none (never cached)' },
  { id: 'coverage', after: ['test'], priority: 25, cache: 'none (reads the merged lcov)' },
  { id: 'sonar', after: ['test'], priority: 20, cache: '.starcistacks/cache/sonar-baseline, codecov-baseline' },
  { id: 'ratchet', after: ['lint'], priority: 15, cache: 'none (reads the lint records)' },
  { id: 'build', after: ['types', 'lint', 'test', 'wiring'], priority: 45, cache: 'tool cache build-cache' },
  { id: 'sonar-scan', after: ['test', 'types', 'lint', 'wiring', 'hfs', 'format', 'db', 'checks', 'audit', 'coverage', 'sonar', 'build'], priority: 10, cache: 'tool cache sonar-scan' },
];

/** The time a run reads: real, or a spec's. */
export interface Clock {
  now(): number;
}

/** The wall clock. */
export const realClock: Clock = { now: () => Date.now() };

/** The run's CPU lanes: cores - 1 in all, taken by each single-process heavy child and given back when it ends; a step alone finds them all free at its start. */
export interface Lanes {
  readonly total: number;
  free(): number;
  /** Waits until a lane is free, then takes `want` lanes or as many as are free; resolves to the count taken. */
  take(want: number): Promise<number>;
  give(count: number): void;
}

/** The lane pool of `total` lanes (at least one); waiters are served in order. */
export function createLanes(total: number): Lanes {
  const size = Math.max(1, Math.floor(total));
  let free = size;
  const waiting: { want: number; resolve: (taken: number) => void }[] = [];
  const serve = (): void => {
    while (free > 0 && waiting.length > 0) {
      const next = waiting.shift() as (typeof waiting)[number];
      const taken = Math.min(free, Math.max(1, next.want));
      free -= taken;
      next.resolve(taken);
    }
  };
  return {
    total: size,
    free: () => free,
    take: (want) => new Promise((resolve) => { waiting.push({ want, resolve }); serve(); }),
    give: (count) => { free = Math.min(size, free + Math.max(0, count)); serve(); },
  };
}

/** One heavy child of a step as the meter saw it. */
interface Child {
  readonly start: number;
  end: number | null;
  peakMb: number | undefined;
}

/** What one step measured of its children: when each ran, its measured RAM peak, and the workers a test run was admitted with. */
export interface StepMeter {
  readonly children: readonly Child[];
  /** The most workers a test child of the step was admitted with. */
  workers(): number | undefined;
}

interface MutableMeter extends StepMeter {
  begin(at: number): Child;
  admitted(admission: HeavyAdmission, test: boolean): void;
  close(child: Child, at: number, peakMb: number | undefined): void;
}

function createMeter(): MutableMeter {
  const children: Child[] = [];
  let workers: number | undefined;
  return {
    children,
    workers: () => workers,
    begin(at) { const child: Child = { start: at, end: null, peakMb: undefined }; children.push(child); return child; },
    admitted(admission, test) { if (test && admission.workers !== undefined) workers = Math.max(workers ?? 0, admission.workers); },
    close(child, at, peakMb) { child.end = at; child.peakMb = peakMb; },
  };
}

/** The most RAM the step's children held at once: their measured peaks summed over the children that ran at the same time. Undefined when none was measured. */
export function peakOf(meter: Pick<StepMeter, 'children'>): number | undefined {
  const measured = meter.children.filter((child) => child.peakMb !== undefined);
  if (measured.length === 0) return undefined;
  let best = 0;
  for (const child of measured) {
    const at = child.start;
    const sum = measured.filter((other) => other.start <= at && (other.end ?? Number.POSITIVE_INFINITY) > at).reduce((total, other) => total + (other.peakMb ?? 0), 0);
    best = Math.max(best, sum);
  }
  return Math.round(best);
}

/** The most children of the step that ran at once. */
export function concurrencyOf(meter: Pick<StepMeter, 'children'>): number {
  let best = 0;
  for (const child of meter.children) {
    const at = child.start;
    best = Math.max(best, meter.children.filter((other) => other.start <= at && (other.end ?? Number.POSITIVE_INFINITY) > at).length);
  }
  return best;
}

/**
 * The step's node runner. A test run goes to the governor as it is and holds no lane: the step runs alone, so its workers are what the room at its admission holds, up
 * to the cores less one (`workers` only when its caller names a cap, as the jest discovery does). Any other child takes its lanes first (`workers` when it names them,
 * else one), then goes to the governor. The step's meter is told when it is admitted and when it ends with its measured peak.
 */
function meteredNode(run: HeavyNodeRun | undefined, meter: MutableMeter, lanes: Lanes, clock: Clock): HeavyNodeRun | undefined {
  if (run === undefined) return undefined;
  return async (request: HeavyNodeRequest): Promise<HeavyNodeResult> => {
    const test = request.kind === 'test';
    const held = test ? 0 : await lanes.take(request.workers ?? 1);
    const child = meter.begin(clock.now());
    const onAdmit = (admission: HeavyAdmission): void => {
      meter.admitted(admission, test);
      request.onAdmit?.(admission);
    };
    try {
      const result = await run({ ...request, onAdmit });
      meter.close(child, clock.now(), result.peakMb);
      return result;
    } catch (error) {
      meter.close(child, clock.now(), undefined);
      throw error;
    } finally {
      lanes.give(held);
    }
  };
}

/** The step's parity runner (a CI build or audit step, the Sonar scanner): one lane per command, metered as a node child is. */
function meteredParity(run: ParityRun, meter: MutableMeter, lanes: Lanes, clock: Clock): ParityRun {
  return async (request) => {
    const held = await lanes.take(1);
    const child = meter.begin(clock.now());
    try {
      const result = await run({ ...request, onAdmit: (admission) => { meter.admitted(admission, false); request.onAdmit?.(admission); } });
      meter.close(child, clock.now(), result.peakMb);
      return result;
    } catch (error) {
      meter.close(child, clock.now(), undefined);
      throw error;
    } finally {
      lanes.give(held);
    }
  };
}

/** What a step's body is handed: the metered ports its heavy children go through, and the run's lanes (an ESLint or tsc step sizes its children by the free ones). */
export interface StepContext {
  readonly execute: HeavyNodeRun | undefined;
  readonly parity: ParityRun;
  readonly lanes: Lanes;
}

/** A step's body: it judges and keeps its own answer; a throw is its failure, never the run's. */
export type StepBody = (context: StepContext) => Promise<void>;

/** One step as it ran. */
export interface StepRun {
  readonly id: StepId;
  readonly startedAt: number;
  readonly endedAt: number;
  /** `done` whatever the verdict of its findings; `failed` when its body threw (`error`). */
  readonly status: 'done' | 'failed';
  readonly error?: unknown;
  /** Its place among the steps in the order they ran (0 first). */
  readonly order: number;
  readonly meter: StepMeter;
}

/** What runs the steps: the bodies of the selected steps (a step with no body is not selected and counts as ended), the ports, the lanes and the clock. */
export interface GraphInput {
  readonly bodies: ReadonlyMap<StepId, StepBody>;
  readonly execute: HeavyNodeRun | undefined;
  readonly parity: ParityRun;
  readonly lanes: Lanes;
  readonly clock?: Clock | undefined;
  readonly graph?: readonly StepSpec[] | undefined;
}

/**
 * Runs the steps one after another: each time, of the steps whose `after` steps have all ended, the one of the highest priority, its body on its own metered ports; none
 * is cancelled by another's failure. A step starts when the one before it ended, so its children are sized on the RAM free then. Resolves when every selected step has
 * ended, with how each ran, in graph order.
 */
export async function runGraph(input: GraphInput): Promise<StepRun[]> {
  const clock = input.clock ?? realClock;
  const graph = (input.graph ?? CHECK_GRAPH).filter((spec) => input.bodies.has(spec.id));
  const byPriority = [...graph].sort((a, b) => b.priority - a.priority);
  const selected = new Set(graph.map((spec) => spec.id));
  const ended = new Map<StepId, StepRun>();
  while (ended.size < graph.length) {
    const spec = byPriority.find((one) => !ended.has(one.id) && one.after.every((id) => !selected.has(id) || ended.has(id)));
    if (spec === undefined) throw new Error(`the steps ${byPriority.filter((one) => !ended.has(one.id)).map((one) => one.id).join(', ')} wait on each other`);
    const meter = createMeter();
    const context: StepContext = { execute: meteredNode(input.execute, meter, input.lanes, clock), parity: meteredParity(input.parity, meter, input.lanes, clock), lanes: input.lanes };
    const startedAt = clock.now();
    try {
      await (input.bodies.get(spec.id) as StepBody)(context);
      ended.set(spec.id, { id: spec.id, startedAt, endedAt: clock.now(), status: 'done', order: ended.size, meter });
    } catch (error) {
      ended.set(spec.id, { id: spec.id, startedAt, endedAt: clock.now(), status: 'failed', error, order: ended.size, meter });
    }
  }
  return graph.map((spec) => ended.get(spec.id) as StepRun);
}

/** One row of the steps table: what a step took and where its results live. */
export interface StepRow {
  readonly step: StepId;
  readonly status: 'done' | 'failed';
  readonly seconds: number;
  /** The measured RAM peak of its children at once, MB; null when it ran no child or none was measured. */
  readonly peakMb: number | null;
  /** Its parallelism: a test run's workers, else the children it ran at once (0: in-process only). */
  readonly workers: number | null;
  readonly children: number;
  readonly reused: number | null;
  readonly checked: number | null;
  readonly cache: string;
}

/** The table row of a step that ran, with the counts its family reported (`counts`, undefined for a step that reports none). */
export function stepRow(run: StepRun, counts: { reused: number; checked: number } | undefined, graph: readonly StepSpec[] = CHECK_GRAPH): StepRow {
  return {
    step: run.id,
    status: run.status,
    seconds: Math.round((run.endedAt - run.startedAt) / 100) / 10,
    peakMb: peakOf(run.meter) ?? null,
    workers: run.meter.workers() ?? null,
    children: concurrencyOf(run.meter),
    reused: counts?.reused ?? null,
    checked: counts?.checked ?? null,
    cache: graph.find((spec) => spec.id === run.id)?.cache ?? '',
  };
}

const gbOf = (mb: number): string => `${(mb / 1024).toFixed(1)} GB`;

/** The steps table of the human report: one line per step with its wall time, RAM peak, parallelism, reused and checked counts and its cache. */
export function formatStepRows(rows: readonly StepRow[], elapsed: (ms: number) => string): string[] {
  if (rows.length === 0) return [];
  const cells = rows.map((row) => [
    row.step,
    `${elapsed(row.seconds * 1000)}${row.status === 'failed' ? ' (failed)' : ''}`,
    row.peakMb === null ? '-' : gbOf(row.peakMb),
    row.workers !== null ? `${String(row.workers)} workers` : row.children === 0 ? 'in-process' : `${String(row.children)} at once`,
    row.reused === null ? '-' : `${String(row.reused)}/${String(row.checked ?? 0)}`,
    row.cache,
  ]);
  const head = ['step', 'wall', 'RAM peak', 'parallel', 'reused/checked', 'cache'];
  const widths = head.map((title, at) => Math.max(title.length, ...cells.map((cell) => (cell[at] ?? '').length)));
  const line = (cell: readonly string[]): string => `    ${cell.map((text, at) => (at === cell.length - 1 ? text : text.padEnd(widths[at] ?? 0))).join('  ')}`.trimEnd();
  return ['  steps:', line(head), ...cells.map(line)];
}

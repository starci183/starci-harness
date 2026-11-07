// schedule.mts - the orchestration of `starci app check` (contexts/project/check-cache.md, "Orchestration"): the dependency graph of its steps and each step's
// priority, declared once below, and the scheduler that runs it. `app check` holds no heavy-command slot of its own: it is the orchestrator. Every step starts the moment the
// steps it needs have ended, whatever their verdict, so a red family never stops another and one run reports every finding. Each heavy child a step starts
// (a tsc program, an ESLint chunk, the jest run, a build step, the boot proof, the contract compiler, the Sonar scanner) is admitted by the CLI's governor on
// its own when it starts, from the live RAM, and takes CPU lanes from the run's one pool of cores - 1: a single-process child one lane, a jest run the lanes
// it holds as its most workers (the governor's room may give fewer, and the rest go back at its admission). So one step never takes the whole machine while
// another waits for nothing. Steps whose work is in-process (`inline`: the structure rules, the lint graphs, Prettier, the baselines) block this process's
// one thread while they compute, so one starts only once every running child step has its child admitted (or LAUNCH_WAIT_MS passed): the children then run
// beside it. A child asks the governor for its admission only once every higher-priority step that is ready or running has had a child admitted (or ended, or
// LAUNCH_WAIT_MS passed), so the critical path (the unit run) is sized on the full room and takes its lanes first; the rest take what is left, first come, first
// served. The records each step writes stay its family's own folders (one writer each); the fingerprint is taken once before the graph, the flush once after.
import type { HeavyAdmission, HeavyNodeRequest, HeavyNodeResult, HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import type { ParityRun } from './parity-family.mjs';

/** A step of the graph: a family, or a part of the run that reads the results of others. */
export type StepId = 'test' | 'types' | 'lint' | 'wiring' | 'hfs' | 'format' | 'db' | 'audit' | 'coverage' | 'sonar' | 'ratchet' | 'build' | 'sonar-scan';

/** One node of the graph: what must have ended before it starts, and whether its work runs in this process (`inline`) rather than in children. */
export interface StepSpec {
  readonly id: StepId;
  readonly after: readonly StepId[];
  readonly inline: boolean;
  /** The step's expected weight on the run's critical path: a ready step with a higher priority asks the governor, and takes lanes, before a lower one. */
  readonly priority: number;
  /** Where the step's results live, app-relative (the committed cache folders) or the host folder it uses. */
  readonly cache: string;
}

/**
 * The dependency graph of `app check` with each step's priority (the expected critical-path weight: the unit run, then lint, the structure pass, tsc, the rest).
 * Ready steps start, and their children ask the governor, in priority order. Everything not ordered here is independent and runs in parallel.
 *   - coverage (CI's coverage step) and sonar (the baselines) read the coverage the test family merged: after test.
 *   - ratchet reads the lint records of this run: after lint.
 *   - build runs CI's typecheck script (build:modules, then codegen, then tsc), `build:be` and each `build fe`: codegen and build:modules rewrite the
 *     generated code and the root packages' dist that the tsc programs, the typed lint, the unit specs and the boot proof read, so build starts after them.
 *   - sonar-scan uploads the findings and the lint report of every step but the ratchet and runs only when they are green: after all of them.
 */
export const CHECK_GRAPH: readonly StepSpec[] = [
  { id: 'test', after: [], inline: false, priority: 90, cache: '.starcistacks/cache/test-coverage' },
  { id: 'types', after: [], inline: false, priority: 60, cache: '.starcistacks/cache/check/types' },
  { id: 'lint', after: [], inline: true, priority: 80, cache: '.starcistacks/cache/lint' },
  { id: 'wiring', after: [], inline: false, priority: 50, cache: '.starcistacks/cache/check/wiring' },
  { id: 'hfs', after: [], inline: true, priority: 70, cache: '.starcistacks/cache/check/hfs, check/secrets' },
  { id: 'format', after: [], inline: true, priority: 40, cache: '.starcistacks/cache/check/format' },
  { id: 'db', after: [], inline: true, priority: 35, cache: '.starcistacks/cache/check/db' },
  { id: 'audit', after: [], inline: false, priority: 30, cache: 'none (never cached)' },
  { id: 'coverage', after: ['test'], inline: true, priority: 25, cache: 'none (reads the merged lcov)' },
  { id: 'sonar', after: ['test'], inline: true, priority: 20, cache: '.starcistacks/cache/sonar-baseline, codecov-baseline' },
  { id: 'ratchet', after: ['lint'], inline: true, priority: 15, cache: 'none (reads the lint records)' },
  { id: 'build', after: ['types', 'lint', 'test', 'wiring'], inline: false, priority: 45, cache: 'tool cache build-cache' },
  { id: 'sonar-scan', after: ['test', 'types', 'lint', 'wiring', 'hfs', 'format', 'db', 'audit', 'coverage', 'sonar', 'build'], inline: false, priority: 10, cache: 'tool cache sonar-scan' },
];

/** How long an inline step waits for the child steps running beside it to have their children admitted before it takes the thread anyway. */
export const LAUNCH_WAIT_MS = 30_000;
const POLL_MS = 250;

/** The time a run reads: real, or a spec's. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The wall clock. */
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) };

/** The run's CPU lanes: cores - 1 in all, taken by each heavy child and given back when it ends. */
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
  /** Children admitted and not ended. */
  running(): number;
  /** The most workers a test child of the step was admitted with. */
  workers(): number | undefined;
  /** Whether a child of the step has been admitted yet. */
  launched(): boolean;
}

interface MutableMeter extends StepMeter {
  begin(at: number): Child;
  admitted(child: Child, admission: HeavyAdmission, test: boolean): void;
  close(child: Child, at: number, peakMb: number | undefined): void;
}

function createMeter(): MutableMeter {
  const children: Child[] = [];
  const admitted = new Set<Child>();
  let workers: number | undefined;
  let launched = false;
  return {
    children,
    running: () => admitted.size,
    workers: () => workers,
    launched: () => launched,
    begin(at) { const child: Child = { start: at, end: null, peakMb: undefined }; children.push(child); return child; },
    admitted(child, admission, test) {
      launched = true;
      if (child.end === null) admitted.add(child);
      if (test && admission.workers !== undefined) workers = Math.max(workers ?? 0, admission.workers);
    },
    close(child, at, peakMb) { child.end = at; child.peakMb = peakMb; admitted.delete(child); },
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
 * The step's node runner: every child waits for its turn (`turn`: the higher-priority steps asked first), then takes its lanes (a test run as many as are free, as its most workers; a child that names `workers` that many;
 * any other one)), then goes to the governor as it is (`run`), the step's meter told when it is admitted and when it ends with its measured peak.
 */
function meteredNode(run: HeavyNodeRun | undefined, meter: MutableMeter, lanes: Lanes, clock: Clock, turn: () => Promise<void>): HeavyNodeRun | undefined {
  if (run === undefined) return undefined;
  return async (request: HeavyNodeRequest): Promise<HeavyNodeResult> => {
    const test = request.kind === 'test';
    await turn();
    let held = await lanes.take(request.workers ?? (test ? lanes.free() : 1));
    const child = meter.begin(clock.now());
    const onAdmit = (admission: HeavyAdmission): void => {
      meter.admitted(child, admission, test);
      // A test run got fewer workers than the lanes it held: the rest go back to the run now.
      if (test && admission.workers !== undefined && admission.workers < held) { lanes.give(held - admission.workers); held = admission.workers; }
      request.onAdmit?.(admission);
    };
    try {
      const result = await run({ ...request, ...(test ? { workers: held } : {}), onAdmit });
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
function meteredParity(run: ParityRun, meter: MutableMeter, lanes: Lanes, clock: Clock, turn: () => Promise<void>): ParityRun {
  return async (request) => {
    await turn();
    const held = await lanes.take(1);
    const child = meter.begin(clock.now());
    try {
      const result = await run({ ...request, onAdmit: (admission) => { meter.admitted(child, admission, false); request.onAdmit?.(admission); } });
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

/** What a step's body is handed: the metered ports its heavy children go through, and the run's lanes (an ESLint step sizes its chunks by the free ones). */
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
  /** Its place among the steps in the order they ended (0 first). */
  readonly order: number;
  readonly meter: StepMeter;
}

/** What runs the graph: the bodies of the selected steps (a step with no body is not selected and counts as ended), the ports, the lanes and the clock. */
export interface GraphInput {
  readonly bodies: ReadonlyMap<StepId, StepBody>;
  readonly execute: HeavyNodeRun | undefined;
  readonly parity: ParityRun;
  readonly lanes: Lanes;
  readonly clock?: Clock | undefined;
  readonly graph?: readonly StepSpec[] | undefined;
  readonly launchWaitMs?: number | undefined;
}

/**
 * Runs the graph: every step whose `after` steps have all ended starts (highest priority first), each body on its own metered ports, and none is cancelled by
 * another's failure. A child asks the governor only once each higher-priority step ready or running has a child admitted, has ended, or LAUNCH_WAIT_MS passed. An inline step starts only once each running child step of a higher priority has a child admitted, has ended, or LAUNCH_WAIT_MS passed. Resolves when
 * every selected step has ended, with how each ran, in graph order.
 */
export async function runGraph(input: GraphInput): Promise<StepRun[]> {
  const clock = input.clock ?? realClock;
  const graph = (input.graph ?? CHECK_GRAPH).filter((spec) => input.bodies.has(spec.id));
  const byPriority = [...graph].sort((a, b) => b.priority - a.priority);
  const wait = input.launchWaitMs ?? LAUNCH_WAIT_MS;
  const ended = new Map<StepId, StepRun>();
  const running = new Map<StepId, { readonly spec: StepSpec; readonly meter: MutableMeter; readonly promise: Promise<void> }>();
  const selected = new Set(graph.map((spec) => spec.id));
  const ready = (spec: StepSpec): boolean => spec.after.every((id) => !selected.has(id) || ended.has(id));
  /** The steps of a higher priority than `priority` that have not asked yet: ready or running, with no child admitted, and not ended. */
  const ahead = (priority: number): StepId[] => graph
    .filter((spec) => spec.priority > priority && !ended.has(spec.id) && (running.has(spec.id) ? running.get(spec.id)?.meter.launched() === false : ready(spec)))
    .map((spec) => spec.id);
  /** A step's turn to ask the governor: waits while a higher-priority step is ahead of it, giving up on those steps after `wait`. */
  const turnOf = (spec: StepSpec): (() => Promise<void>) => {
    const released = new Set<StepId>();
    let since: number | null = null;
    return async () => {
      for (;;) {
        const blockers = ahead(spec.priority).filter((id) => !released.has(id));
        if (blockers.length === 0) return;
        since ??= clock.now();
        if (clock.now() - since >= wait) { for (const id of blockers) released.add(id); return; }
        await clock.sleep(POLL_MS);
      }
    };
  };
  /** Whether no running child step of a higher priority than `priority` is still before its first admitted child (a lower one waits for this step's turn). */
  const launched = (priority: number): boolean => [...running.values()].every((entry) => entry.spec.inline || entry.spec.priority <= priority || entry.meter.running() > 0);
  // Resolved when a step ends; replaced after the loop has looked at the state it announced, so no end is ever missed.
  let wake: () => void = () => undefined;
  let changedSignal = new Promise<void>((resolve) => { wake = resolve; });
  const start = (spec: StepSpec): void => {
    const meter = createMeter();
    const turn = turnOf(spec);
    const context: StepContext = { execute: meteredNode(input.execute, meter, input.lanes, clock, turn), parity: meteredParity(input.parity, meter, input.lanes, clock, turn), lanes: input.lanes };
    const startedAt = clock.now();
    const body = input.bodies.get(spec.id) as StepBody;
    const promise = Promise.resolve().then(() => body(context)).then(
      () => { ended.set(spec.id, { id: spec.id, startedAt, endedAt: clock.now(), status: 'done', order: ended.size, meter }); },
      (error: unknown) => { ended.set(spec.id, { id: spec.id, startedAt, endedAt: clock.now(), status: 'failed', error, order: ended.size, meter }); },
    ).finally(() => { running.delete(spec.id); wake(); });
    running.set(spec.id, { spec, meter, promise });
  };
  // Since when an inline step has waited on unlaunched child steps; once that wait ran out, inline steps go on until the children are launched again.
  let inlineSince: number | null = null;
  while (ended.size < graph.length) {
    const pending = byPriority.filter((spec) => !ended.has(spec.id) && !running.has(spec.id) && ready(spec));
    let blocked = false;
    for (const spec of pending) {
      if (!spec.inline) { start(spec); continue; }
      if (launched(spec.priority)) inlineSince = null;
      else {
        inlineSince ??= clock.now();
        if (clock.now() - inlineSince < wait) { blocked = true; break; }
      }
      start(spec);
      // An inline step takes the thread at its first await at the latest; the next one is judged again after it yields.
      break;
    }
    if (ended.size === graph.length) break;
    const next = changedSignal;
    if (blocked || pending.length > 0) await Promise.race([next, clock.sleep(POLL_MS)]);
    else await next;
    changedSignal = new Promise<void>((resolve) => { wake = resolve; });
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

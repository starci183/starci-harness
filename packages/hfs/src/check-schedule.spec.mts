// The orchestration of `app check` (cache/schedule.mts) on a fake governor and a fake clock: independent steps overlap in time, the declared order
// holds, a side's ESLint chunks run at once up to the room, a red step cancels no other, and no step takes more CPU lanes than it can use.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_GRAPH, createLanes, peakOf, runGraph, stepRow, type Clock, type StepBody, type StepId, type StepRun } from '../cache/schedule.mjs';
import { eslintParts } from '../lint/run.mjs';
import type { HeavyNodeRequest, HeavyNodeResult, HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';

/** A clock whose time moves only when every task waits: the driver jumps to the next timer. */
function fakeClock(): Clock & { drive<T>(work: Promise<T>): Promise<T> } {
  let now = 0;
  const timers: { at: number; resolve: () => void }[] = [];
  const settle = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });
  return {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => { timers.push({ at: now + ms, resolve }); }),
    async drive(work) {
      let done = false;
      const result = work.finally(() => { done = true; });
      while (!done) {
        for (let turn = 0; turn < 5; turn += 1) await settle();
        if (done) break;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        if (next === undefined) continue;
        now = Math.max(now, next.at);
        next.resolve();
      }
      return result;
    },
  };
}

/** The need of each kind on the fake host, MB: the heap caps of a governor, and a test run's parent and one worker. */
const NEED = { tsc: 8000, eslint: 8000, test: 9000, build: 4000 } as const;
const WORKER_MB = 1500;

interface Ran { readonly label: string; readonly start: number; end: number; readonly workers: number | undefined }

/**
 * A governor over `roomMb` of RAM: first come, first served; the head starts when the room less what runs covers its need, or when nothing runs; a test
 * run takes the workers the rest of its room holds, at most what it asked for. Each child runs `durations[label]` of fake time.
 */
function fakeGovernor(clock: Clock, roomMb: number, durations: Readonly<Record<string, number>>): { run: HeavyNodeRun; parity: ParityRun; ran: Ran[] } {
  const ran: Ran[] = [];
  const queue: { need: number; go: () => void }[] = [];
  let used = 0;
  let running = 0;
  const serve = (): void => {
    while (queue.length > 0) {
      const head = queue[0] as (typeof queue)[number];
      if (running > 0 && used + head.need > roomMb) return;
      queue.shift();
      head.go();
    }
  };
  const admitted = (need: number): Promise<void> => new Promise((resolve) => { queue.push({ need, go: () => { used += need; running += 1; resolve(); } }); serve(); });
  const release = (need: number): void => { used -= need; running -= 1; serve(); };
  const one = async (kind: keyof typeof NEED, label: string, workers: number | undefined, onAdmit: ((admitted: { workers?: number }) => void) | undefined): Promise<HeavyNodeResult> => {
    const base = NEED[kind];
    await admitted(base);
    const free = roomMb - used;
    const sized = kind === 'test' ? Math.max(1, Math.min(workers ?? 1, Math.floor(free / WORKER_MB) + 1)) : undefined;
    const extra = sized === undefined ? 0 : (sized - 1) * WORKER_MB;
    used += extra;
    onAdmit?.({ ...(sized === undefined ? {} : { workers: sized }) });
    const entry: Ran = { label, start: clock.now(), end: -1, workers: sized };
    ran.push(entry);
    await clock.sleep(durations[label] ?? 1000);
    entry.end = clock.now();
    used -= extra;
    release(base);
    return { status: 0, signal: null, stdout: '', stderr: '', peakMb: base + extra };
  };
  return {
    ran,
    run: (request: HeavyNodeRequest) => one(request.kind, request.label, request.workers, request.onAdmit),
    parity: async (request) => one('build', request.label, undefined, request.onAdmit),
  };
}

/** A step that runs one child of `kind` labelled with the step's id. */
const child = (kind: HeavyNodeRequest['kind'], label: string): StepBody => async ({ execute }) => {
  await (execute as HeavyNodeRun)({ kind, label, args: [], cwd: '.', maxBuffer: 1 });
};

const byId = (runs: readonly StepRun[], id: StepId): StepRun => runs.find((run) => run.id === id) as StepRun;

void test('independent steps overlap in time, and the declared order holds', async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 40_000, { test: 60_000, types: 5_000, lint: 20_000, wiring: 3_000, build: 4_000, 'sonar-scan': 2_000 });
  const bodies = new Map<StepId, StepBody>([
    ['test', child('test', 'test')], ['types', child('tsc', 'types')], ['lint', child('eslint', 'lint')], ['wiring', child('test', 'wiring')],
    ['build', async ({ parity }) => { await parity({ kind: 'build', label: 'build', cwd: '.', argv: [], env: {} }); }],
    ['sonar-scan', async ({ parity }) => { await parity({ kind: 'build', label: 'sonar-scan', cwd: '.', argv: [], env: {} }); }],
    ['coverage', async () => undefined], ['hfs', async () => undefined],
  ]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(27), clock, launchWaitMs: 1_000 }));
  const test_ = byId(runs, 'test');
  for (const id of ['types', 'lint', 'wiring'] as const) assert.ok(byId(runs, id).startedAt < test_.endedAt, `${id} ran while the unit run ran`);
  assert.ok(byId(runs, 'lint').startedAt < byId(runs, 'types').endedAt, 'lint and types overlap');
  const build = byId(runs, 'build');
  for (const id of ['types', 'lint', 'test', 'wiring'] as const) assert.ok(build.startedAt >= byId(runs, id).endedAt, `build starts after ${id}, whose inputs its codegen rewrites`);
  assert.ok(byId(runs, 'coverage').startedAt >= test_.endedAt, 'coverage reads the merged coverage: after test');
  const scan = byId(runs, 'sonar-scan');
  for (const run of runs) if (run.id !== 'sonar-scan') assert.ok(scan.startedAt >= run.endedAt, `the scan starts after ${run.id}`);
  assert.equal(runs.map((run) => run.id).join(' '), CHECK_GRAPH.filter((spec) => bodies.has(spec.id)).map((spec) => spec.id).join(' '), 'the runs come back in graph order');
  const wall = Math.max(...runs.map((run) => run.endedAt));
  assert.ok(wall < 60_000 + 5_000 + 20_000 + 3_000 + 4_000 + 2_000, 'the run is shorter than its steps one after another');
});

void test("an inline step waits until the child steps beside it have their children admitted, so they run while it holds the thread", async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 40_000, { test: 10_000 });
  const order: string[] = [];
  const bodies = new Map<StepId, StepBody>([
    ['test', async (step) => { await clock.sleep(500); order.push('test asks'); await child('test', 'test')(step); }],
    ['hfs', async () => { order.push('hfs starts'); }],
  ]);
  await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(7), clock, launchWaitMs: 60_000 }));
  assert.deepEqual(order, ['test asks', 'hfs starts']);
  assert.ok(governor.ran[0] !== undefined && governor.ran[0].start <= clock.now());
});

void test("a side's ESLint chunks run at once up to the room the governor holds, never more than its chunks", async () => {
  const files = Array.from({ length: 6000 }, (_unused, index) => `src/${String(index).padStart(5, '0')}.ts`);
  assert.equal(eslintParts(files, 600, () => 3).length, 3, 'three children fit the room');
  assert.equal(eslintParts(files, 600, () => 50).length, 10, 'never more children than chunks');
  assert.equal(eslintParts(files, 600, () => 0).length, 1, 'one child at least');
  assert.equal(eslintParts(files.slice(0, 500), 600, () => 4).length, 1, 'a side within one chunk is one child');
  assert.deepEqual(eslintParts(files, 600, () => 4).flat(), files, 'every file is judged once, in order');
  const clock = fakeClock();
  const room = 3 * NEED.eslint + 500;
  const governor = fakeGovernor(clock, room, {});
  const lanes = createLanes(27);
  const bodies = new Map<StepId, StepBody>([['lint', async ({ execute }) => {
    const parts = eslintParts(files, 600, (chunks) => Math.min(chunks, lanes.free(), Math.floor(room / NEED.eslint)));
    await Promise.all(parts.map((_part, index) => (execute as HeavyNodeRun)({ kind: 'eslint', label: `chunk ${String(index)}`, args: [], cwd: '.', maxBuffer: 1 })));
  }]]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes, clock }));
  assert.equal(governor.ran.length, 3);
  assert.ok(governor.ran.every((entry) => entry.start === governor.ran[0]?.start), 'the three chunks started together');
  assert.equal(stepRow(byId(runs, 'lint'), undefined).children, 3);
  assert.equal(peakOf(byId(runs, 'lint').meter), 3 * NEED.eslint, 'the peak is the chunks that ran at once');
});

void test('a red or failing step cancels no other: every step ends, and its dependents still run', async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 40_000, { test: 5_000 });
  let built = false;
  const bodies = new Map<StepId, StepBody>([
    ['types', async () => { throw new Error('tsc did not complete'); }],
    ['test', child('test', 'test')],
    ['lint', async () => undefined],
    ['build', async () => { built = true; }],
  ]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(7), clock }));
  assert.equal(byId(runs, 'types').status, 'failed');
  assert.match(String((byId(runs, 'types').error as Error).message), /tsc did not complete/u);
  assert.equal(byId(runs, 'test').status, 'done', 'the unit run ran to its end');
  assert.equal(built, true, 'build, after the failed step, still ran');
});

void test('no step takes more lanes than it can use: a test run gives back what the room did not size, and the lanes cap every child', async () => {
  const clock = fakeClock();
  // Room for the parent and three workers: the run asks with every free lane and gets three.
  const governor = fakeGovernor(clock, NEED.test + 2 * WORKER_MB + 100, { test: 10_000, 'tsc a': 1_000 });
  const lanes = createLanes(9);
  const seen: number[] = [];
  const bodies = new Map<StepId, StepBody>([
    ['test', async ({ execute }) => {
      await (execute as HeavyNodeRun)({ kind: 'test', label: 'test', args: [], cwd: '.', maxBuffer: 1, onAdmit: () => { seen.push(lanes.free()); } });
    }],
    ['types', async ({ execute }) => { await clock.sleep(100); seen.push(lanes.free()); await (execute as HeavyNodeRun)({ kind: 'tsc', label: 'tsc a', args: [], cwd: '.', maxBuffer: 1 }); }],
  ]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes, clock }));
  assert.equal(governor.ran.find((entry) => entry.label === 'test')?.workers, 3, 'the room sized three workers of the nine lanes asked');
  assert.equal(seen[0], 9 - 3, 'the six lanes the run could not use went back at its admission');
  assert.equal(stepRow(byId(runs, 'test'), { reused: 1, checked: 2 }).workers, 3);
  assert.equal(lanes.free(), 9, 'every lane is back once the steps ended');
  const one = createLanes(2);
  assert.equal(await one.take(5), 2, 'a child takes at most the free lanes');
  const waiting = one.take(1);
  one.give(1);
  assert.equal(await waiting, 1, 'and waits for one when none is free');
});

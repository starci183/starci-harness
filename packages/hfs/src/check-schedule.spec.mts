// The orchestration of `app check` (cache/schedule.mts) on a fake governor and a fake clock: the steps run one after another in priority order and never overlap, each step
// sizes its children on the RAM free at its own start (the unit run holds no lane and takes more than one worker when the room holds them), a side's ESLint chunks run at once
// up to the room, and a red step cancels no other.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_GRAPH, createLanes, peakOf, runGraph, stepRow, type Clock, type StepBody, type StepId, type StepRun } from '../cache/schedule.mjs';
import { eslintParts } from '../lint/run.mjs';
import type { HeavyNodeRequest, HeavyNodeResult, HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';

type FakeClock = Clock & { sleep(ms: number): Promise<void>; drive<T>(work: Promise<T>): Promise<T> };

/** A clock whose time moves only when every task waits: the driver jumps to the next timer. */
function fakeClock(): FakeClock {
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
 * A governor over `roomMb` of RAM on `cores` cores: first come, first served; the head starts when the room less what runs covers its need, or when nothing runs; a test
 * run takes the workers the rest of its room holds, at most the cores less one and what its caller capped. Each child runs `durations[label]` of fake time.
 */
function fakeGovernor(clock: FakeClock, roomMb: number, durations: Readonly<Record<string, number>>, cores = 28): { run: HeavyNodeRun; parity: ParityRun; ran: Ran[] } {
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
    const sized = kind === 'test' ? Math.max(1, Math.min(workers ?? cores - 1, Math.floor(free / WORKER_MB) + 1)) : undefined;
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

void test('the steps run one after another in priority order, none overlaps another, and each starts only after the steps it needs', async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 40_000, { test: 60_000, types: 5_000, lint: 20_000, wiring: 3_000, build: 4_000, 'sonar-scan': 2_000 });
  const bodies = new Map<StepId, StepBody>([
    ['test', child('test', 'test')], ['types', child('tsc', 'types')], ['lint', child('eslint', 'lint')], ['wiring', child('test', 'wiring')],
    ['build', async ({ parity }) => { await parity({ kind: 'build', label: 'build', cwd: '.', argv: [], env: {} }); }],
    ['sonar-scan', async ({ parity }) => { await parity({ kind: 'build', label: 'sonar-scan', cwd: '.', argv: [], env: {} }); }],
    ['coverage', async () => undefined], ['hfs', async () => undefined],
  ]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(27), clock }));
  const sequence = [...runs].sort((a, b) => a.order - b.order);
  assert.equal(sequence.map((run) => run.id).join(' '), 'test lint hfs types wiring build coverage sonar-scan', 'the priority order of the graph, each step after the steps it needs');
  for (let at = 1; at < sequence.length; at += 1) {
    const step = sequence[at] as StepRun;
    const before = sequence[at - 1] as StepRun;
    assert.ok(step.startedAt >= before.endedAt, `${step.id} starts after ${before.id} ended`);
  }
  assert.equal(runs.map((run) => run.id).join(' '), CHECK_GRAPH.filter((spec) => bodies.has(spec.id)).map((spec) => spec.id).join(' '), 'the runs come back in graph order');
  assert.equal(Math.max(...runs.map((run) => run.endedAt)), 60_000 + 5_000 + 20_000 + 3_000 + 4_000 + 2_000, 'the run lasts the sum of its steps');
  for (const [at, entry] of governor.ran.entries()) for (const other of governor.ran.slice(at + 1)) assert.ok(other.start >= entry.end, `${other.label} was admitted after ${entry.label} ended: no two heavy steps overlap`);
});

void test('a step never starts before the one before it ended, even when the room would hold both', async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 200_000, { test: 10_000, lint: 4_000 });
  const bodies = new Map<StepId, StepBody>([['test', child('test', 'test')], ['lint', child('eslint', 'lint')]]);
  await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(27), clock }));
  assert.deepEqual(governor.ran.map((entry) => [entry.label, entry.start, entry.end]), [['test', 0, 10_000], ['lint', 10_000, 14_000]]);
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

void test('the unit run is sized on the RAM free at its own start and holds no lane: 38 GB and 12 cores give it more than one worker after other steps ran', async () => {
  const room = 38_000;
  const lanes = createLanes(11);
  const seen: number[] = [];
  const clock = fakeClock();
  const governor = fakeGovernor(clock, room, { lint: 2_000, types: 2_000, test: 10_000 }, 12);
  const bodies = new Map<StepId, StepBody>([
    ['lint', child('eslint', 'lint')],
    ['types', child('tsc', 'types')],
    ['test', async ({ execute }) => { await (execute as HeavyNodeRun)({ kind: 'test', label: 'test', args: [], cwd: '.', maxBuffer: 1, onAdmit: () => { seen.push(lanes.free()); } }); }],
  ]);
  // A graph where the unit run comes after lint and tsc: it is sized on its own start, whatever ran before it.
  const graph = CHECK_GRAPH.map((spec) => (spec.id === 'test' ? { ...spec, priority: 1 } : spec));
  const runs = await clock.drive(runGraph({ bodies, graph, execute: governor.run, parity: governor.parity, lanes, clock }));
  assert.deepEqual([...runs].sort((a, b) => a.order - b.order).map((run) => run.id), ['lint', 'types', 'test'], 'the unit run came after the other steps');
  const jest = governor.ran.find((entry) => entry.label === 'test') as Ran;
  assert.equal(jest.workers, Math.min(11, Math.floor((room - NEED.test) / WORKER_MB) + 1), 'the workers are what the room holds, up to the cores less one');
  assert.ok((jest.workers ?? 0) > 1, 'more than one worker');
  assert.deepEqual(seen, [11], 'the unit run holds no lane: every lane is free at its admission');
  assert.equal(stepRow(byId(runs, 'test'), { reused: 1, checked: 2 }).workers, jest.workers);
  assert.equal(lanes.free(), 11, 'every lane is back once the steps ended');
});

void test('a child that names its workers keeps that cap (the jest discovery), and the lanes cap the single-process children', async () => {
  const clock = fakeClock();
  const governor = fakeGovernor(clock, 40_000, {});
  const bodies = new Map<StepId, StepBody>([['test', async ({ execute }) => { await (execute as HeavyNodeRun)({ kind: 'test', label: 'discovery', args: [], cwd: '.', maxBuffer: 1, workers: 1 }); }]]);
  await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(9), clock }));
  assert.equal(governor.ran[0]?.workers, 1);
  const one = createLanes(2);
  assert.equal(await one.take(5), 2, 'a child takes at most the free lanes');
  const waiting = one.take(1);
  one.give(1);
  assert.equal(await waiting, 1, 'and waits for one when none is free');
});

void test('the unit run is the first step and is sized on the whole room, the lint and tsc children follow on what it left', async () => {
  const clock = fakeClock();
  const room = 40_000;
  const governor = fakeGovernor(clock, room, { test: 30_000, types: 5_000, 'lint be': 5_000, 'lint fe': 5_000 });
  const lanes = createLanes(27);
  // The low-priority steps are listed first: the graph's priorities, not the order of the bodies, decide the sequence.
  const bodies = new Map<StepId, StepBody>([
    ['types', child('tsc', 'types')],
    ['lint', async ({ execute }) => { await Promise.all([child('eslint', 'lint be'), child('eslint', 'lint fe')].map((body) => body({ execute, parity: governor.parity, lanes }))); }],
    ['test', child('test', 'test')],
  ]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes, clock }));
  assert.equal(governor.ran[0]?.label, 'test', 'the unit run is admitted first');
  const jest = governor.ran[0] as Ran;
  assert.equal(jest.workers, Math.floor((room - NEED.test) / WORKER_MB) + 1, 'sized on the whole room, none of it taken by a lint child');
  assert.equal(stepRow(byId(runs, 'test'), undefined).workers, jest.workers);
  const lint = governor.ran.filter((entry) => entry.label.startsWith('lint'));
  assert.equal(lint.length, 2);
  for (const entry of lint) assert.ok(entry.start >= jest.end, `${entry.label} was admitted after the unit run, on what it left`);
  assert.ok(CHECK_GRAPH.find((spec) => spec.id === 'test')?.priority as number > (CHECK_GRAPH.find((spec) => spec.id === 'lint')?.priority as number), 'the graph ranks the unit run above lint');
  assert.ok((CHECK_GRAPH.find((spec) => spec.id === 'lint')?.priority as number) > (CHECK_GRAPH.find((spec) => spec.id === 'types')?.priority as number), 'and lint above tsc');
  assert.equal(lanes.free(), 27, 'every lane is back once the steps ended');
});

void test('a step whose work is wholly reused asks no slot and costs no time, so the unit run keeps the whole room', async () => {
  const clock = fakeClock();
  const room = 40_000;
  const governor = fakeGovernor(clock, room, { test: 10_000 });
  const bodies = new Map<StepId, StepBody>([['lint', async () => undefined], ['types', async () => undefined], ['test', child('test', 'test')]]);
  const runs = await clock.drive(runGraph({ bodies, execute: governor.run, parity: governor.parity, lanes: createLanes(27), clock }));
  assert.deepEqual(governor.ran.map((entry) => entry.label), ['test'], 'only the unit run was admitted');
  assert.equal(governor.ran[0]?.workers, Math.floor((room - NEED.test) / WORKER_MB) + 1);
  for (const id of ['lint', 'types'] as const) assert.equal(byId(runs, id).endedAt - byId(runs, id).startedAt, 0, `${id}, wholly reused, took no time`);
});

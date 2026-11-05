// run-node.mjs — `node <args>` with this process's node binary, waited for: a runtime script (or `-e`/`--test`) as a child
// whose output the caller reads. Returns the spawnSync result {status, stdout, stderr, error, signal} (utf8 text).
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import { nodeSpawn } from './lib.mjs';
import { assertMutationFence } from '../../lib/mutation-fence.mjs';
import { withTempEnv } from '../../../engine/temp-root.mjs';
import { planClause } from './memory-plan.mjs';

/** A concrete Node child whose admission belongs to the CLI's machine-wide governor. */
export interface HeavyNodeRequest {
  readonly kind: 'tsc' | 'eslint' | 'test';
  readonly label: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** When supplied, this is the entire child environment, not an overlay. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs?: number | undefined;
  /**
   * The number of source files the child judges, when it is a whole-program lint of them. The CLI scales the liveness budget of the kind with it
   * (ops/liveness.yaml heavy.timeoutMinutesPer1000Files): a larger side legitimately runs longer, and the budget still ends a hung child.
   */
  readonly files?: number | undefined;
  readonly maxBuffer: number;
}

/** Normal red exits are measurements; an interrupted child is not one. */
export interface HeavyNodeResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException | undefined;
}

/** The CLI admits and captures each actual child, never the composite app command. */
export type HeavyNodeRun = (request: HeavyNodeRequest) => Promise<HeavyNodeResult>;

/** A real governor hold reached no verdict; transports preserve its CLI exit instead of treating it as linter output. */
export const isHostHeld = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'HOST_HELD' && 'exitCode' in error && error.exitCode === 75;

/** Execution infrastructure reached no complete measurement; the contract finder cannot turn it into a cacheable source finding. */
export const isNodeExecutionRefusal = (error: unknown): boolean => error instanceof Error && 'code' in error && typeof error.code === 'string' && ['HOST_HELD', 'HEAVY_DEFERRED', 'CLI_TOOL_INCOMPLETE', 'CLI_TOOL_MISSING', 'CLI_TOOL_NOT_STARTED', 'HFS_NODE_GOVERNOR_MISSING', 'HFS_NODE_INCOMPLETE'].includes(error.code);

/** Keeps the runtime's mutation fence and temporary-directory custody before crossing the CLI execution port. */
export async function runHeavyNode(run: HeavyNodeRun | undefined, request: HeavyNodeRequest): Promise<HeavyNodeResult> {
  if (run === undefined) throw Object.assign(new Error('HFS_NODE_GOVERNOR_MISSING: run this check through starci-harness'), { code: 'HFS_NODE_GOVERNOR_MISSING' });
  assertMutationFence({ kind: 'node-effect', args: request.args });
  return run({ ...request, env: withTempEnv({ env: request.env ?? process.env }).env });
}

/** A partial compiler/test report cannot be interpreted or stored as a completed measurement. */
export function completedNode(result: HeavyNodeResult, label: string): HeavyNodeResult {
  if (result.error !== undefined || result.signal !== null || result.status === null) throw Object.assign(new Error(`${label} did not complete: ${incompleteReason(result)}`), { code: 'HFS_NODE_INCOMPLETE' });
  return result;
}

const HEAP_EXHAUSTED = /JavaScript heap out of memory|Reached heap limit|Allocation failed - JavaScript heap|ERR_WORKER_OUT_OF_MEMORY/u;

/**
 * Why a child ended without a measurement, in one line: the V8 heap it ran out of, the signal that killed it (SIGKILL with no message of its own is
 * most often the kernel's out-of-memory killer or a runner's deadline), its spawn error, else no exit status; then the last lines it wrote to stderr.
 */
export function incompleteReason(result: Pick<HeavyNodeResult, 'status' | 'signal' | 'stderr' | 'error'>): string {
  const stderr = String(result.stderr ?? '');
  const tail = stderr.split('\n').map((line) => line.trim()).filter(Boolean).slice(-3).join(' | ').slice(0, 400);
  const cause = HEAP_EXHAUSTED.test(stderr)
    ? `it ran out of JavaScript heap (${/--max-old-space-size=(\d+)/u.exec(String(process.env.NODE_OPTIONS ?? ''))?.[1] ?? 'the default'} MiB in NODE_OPTIONS of this process; the child's own limit is in its arguments)${result.signal === null ? '' : `, ${result.signal}`}`
    : result.signal === 'SIGKILL'
      ? 'killed by SIGKILL with no message of its own: most often the out-of-memory killer of the host or a deadline of the runner'
      : result.signal !== null
        ? `killed by ${result.signal}`
        : result.error !== undefined
          ? `${result.error.code ?? 'error'}: ${result.error.message}`
          : 'it ended without an exit status';
  // A heap the memory plan sized is named with its plan, so the out-of-memory says what was in force, not only that it ran out.
  const plan = HEAP_EXHAUSTED.test(stderr) ? planClause() : '';
  const named = plan === '' ? cause : `${cause}; ${plan}`;
  return tail === '' ? named : `${named}; stderr: ${tail}`;
}

/** Runs `node <args>`; options (cwd, env, timeout, input, maxBuffer, stdio) pass through. */
export const runNode = (args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> => nodeSpawn(args, options);

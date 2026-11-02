// Real tool proofs run inside the package wave's test slot; this transport keeps the native child's completion evidence.
import { runNode, type HeavyNodeRun } from '../../runtime/scripts/api/node/run-node.mjs';

export const nativeTestNode: HeavyNodeRun = async (request) => {
  const jest = request.args.some((arg) => /(?:^|[/\\])jest(?:\.[cm]?js)?$/u.test(arg));
  const args = jest && !request.args.some((arg) => arg === '--runInBand' || arg.startsWith('--maxWorkers')) ? [...request.args, '--maxWorkers=1'] : request.args;
  const run = runNode(args, { cwd: request.cwd, env: request.env ?? process.env, maxBuffer: request.maxBuffer, ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }) });
  return { status: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr, error: run.error };
};

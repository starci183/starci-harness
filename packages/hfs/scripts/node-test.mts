// node-test.mts - the package's spec run: `node --test` over the patterns it is given, as many spec processes at once as the harness's heavy governor
// admitted the run with (STARCI_TEST_WORKERS, cli/src/harness/heavy.ts testRunEnv), each under the worker heap cap (STARCI_WORKER_HEAP_MB). Unbounded,
// `node --test` starts the cores less one at once whatever the slot planned, and on a busy host the run outgrows its plan: a spec's git or sh child then
// fails to commit memory (STATUS_COMMITMENT_LIMIT) and an unrelated spec goes red. With neither variable set (CI, a plain run) node's own defaults hold.
import { spawnSync } from 'node:child_process';

const workers = Number(process.env.STARCI_TEST_WORKERS);
const heapMb = Number(process.env.STARCI_WORKER_HEAP_MB);
const inherited = process.env.NODE_OPTIONS ?? '';
const env = heapMb > 0 ? { ...process.env, NODE_OPTIONS: `${inherited.replaceAll(/--max-old-space-size=\d+/gu, '').trim()} --max-old-space-size=${String(heapMb)}`.trim() } : process.env;
const concurrency = Number.isInteger(workers) && workers > 0 ? [`--test-concurrency=${String(workers)}`] : [];
const run = spawnSync(process.execPath, ['--test', ...concurrency, ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(run.status ?? 1);

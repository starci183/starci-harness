// node-test.mts - the package's spec run: `node --test` over the patterns it is given, as many spec processes at once as the harness's heavy governor
// admitted the run with (STARCI_TEST_WORKERS, cli/src/harness/heavy.ts testRunEnv), each under the worker heap cap (STARCI_WORKER_HEAP_MB). Unbounded,
// `node --test` starts the cores less one at once whatever the slot planned, and on a busy host the run outgrows its plan: a spec's git or sh child then
// fails to commit memory (STATUS_COMMITMENT_LIMIT) and an unrelated spec goes red. With neither variable set (CI, a plain run) node's own defaults hold.
// The specs run without the caller's repository-local git variables (withoutGitLocalEnv): a fixture repository is judged by its own config, never by a
// GIT_DIR a hook exported or the GIT_CONFIG_PARAMETERS a terminal set (`safe.bareRepository=explicit` there makes every git run inside a fixture's
// bare remote die with exit 128).
import { spawnSync } from 'node:child_process';
import { withoutGitLocalEnv } from '../runtime/scripts/lib/git.mjs';

const workers = Number(process.env.STARCI_TEST_WORKERS);
const heapMb = Number(process.env.STARCI_WORKER_HEAP_MB);
const inherited = process.env.NODE_OPTIONS ?? '';
const base = withoutGitLocalEnv(process.env);
const env = heapMb > 0 ? { ...base, NODE_OPTIONS: `${inherited.replaceAll(/--max-old-space-size=\d+/gu, '').trim()} --max-old-space-size=${String(heapMb)}`.trim() } : base;
const concurrency = Number.isInteger(workers) && workers > 0 ? [`--test-concurrency=${String(workers)}`] : [];
const run = spawnSync(process.execPath, ['--test', ...concurrency, ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(run.status ?? 1);

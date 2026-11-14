// stores.mts - how `starci app data` reaches the stores of an environment: the app's own command per store, served with `serveStore` of
// @starci/seed over the line protocol `starci/data-entries@1`, run in the app root with the environment's custody. A store command's stderr
// and its error text are never relayed (they may quote a value): a failure is its store id and exit code.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { commandStore } from '@starci/seed';
import type { CommandRunner, StoreAdapter } from '@starci/seed';
import { isLocalEnvironment, loadLocalConfig } from '../stack/local-config.mjs';
import { openCustody } from '../stack/local-custody.mjs';
import { expand, runEnvironment } from '../stack/local-run.mjs';
import { launch } from '../stack/local-host.mjs';
import { refusal } from '../stack/errors.mjs';
import type { VerbContext } from '../release/index.mjs';
import type { DeclaredStore } from './declaration.mjs';

/** The spawn of one store command: `argv` and its extra arguments run in `cwd` under `env`, stdin fed from `input` when given, stdout read by line. */
export interface StoreLaunch { argv: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform }

/** A CommandRunner over a spawned child; a non-zero exit (or a child that did not start) fails with the store id and the code only. */
export function spawnRunner(store: string, { argv, cwd, env, platform }: StoreLaunch): CommandRunner {
  return (args, input) => (async function* lines(): AsyncGenerator<string> {
    const [program, rest] = launch(platform, argv[0] ?? '', [...argv.slice(1), ...args]);
    const child = spawn(program, rest, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], windowsHide: true });
    const exit = new Promise<number | null>((done) => { child.once('error', () => { done(null); }); child.once('close', (code) => { done(code); }); });
    if (input !== undefined) {
      child.stdin?.on('error', () => undefined);
      void (async () => {
        try { for await (const line of input) if (!child.stdin?.write(`${line}\n`)) await new Promise<void>((drain) => child.stdin?.once('drain', drain)); } finally { child.stdin?.end(); }
      })();
    }
    let finished = false;
    try {
      for await (const line of createInterface({ input: child.stdout!, crlfDelay: Infinity })) yield line;
      finished = true;
    } finally {
      if (!finished) child.kill();
    }
    const code = await exit;
    if (code !== 0) throw new Error(`store ${store} command exited ${String(code)}`);
  })();
}

/** Where a verb gets the stores of an environment: the target of a sync. A spec replaces it; the default reaches a dev environment. */
export type StoreOpener = (ctx: VerbContext, env: string, stores: readonly DeclaredStore[]) => readonly StoreAdapter[];

/**
 * The default: the stores of a dev (docker-compose) environment, each through its `adapter.command`, run from the app root in the environment
 * the environment's first native process (the api) gets: ports expanded, custody files, the app role's database URL. A deployed environment's
 * stores are reached from its own host, not from here.
 */
export const openLocalStores: StoreOpener = (ctx, env, stores) => {
  if (!isLocalEnvironment(ctx.cwd, env)) throw refusal('DATA_SYNC_UNREACHABLE', `the stores of ${env} are not reachable from this machine: only a dev (docker-compose) environment is synced from here; a deployed environment is synced on its own host`);
  const local = loadLocalConfig({ repoRoot: ctx.cwd, env });
  const custody = openCustody(ctx, local);
  const [api] = local.processes;
  const runEnv = runEnvironment(ctx, local, api ?? { name: 'data', argv: [], cwd: '.', heavy: 'none', skipIfExists: null, env: {}, files: [], after: 'migrate' }, custody, 'app');
  return stores.map((store) => {
    if (store.command === null) throw refusal('DATA_SYNC_STORE_COMMAND', `the store ${store.id} declares no adapter.command: the app command that serves it over starci/data-entries@1`);
    const argv = store.command.map((part) => expand(ctx, local, part));
    return commandStore({ id: store.id, kind: store.kind, level: store.level }, spawnRunner(store.id, { argv, cwd: local.repoRoot, env: runEnv, platform: ctx.platform }));
  });
};

// cutover.mts - the deploy guard of an environment pending its cutover (contexts/project/stacks.md PROJECT-STACKS-19). While
// `environments.<env>.cutover` is in .starcistacks/application-stacks.yaml (sound, expired or malformed alike), `stack deploy` in every form
// (the image form, `--ci-run` from the managed stack-deploy.yml, the one-command `--urgent`, `--adopt`) and `stack prepare --execute` refuse that
// environment with STACK_CUTOVER_PENDING before anything is read from the server, so nothing half-migrated can reach it. The cutover runbook
// removes the block as its last step; only then does the environment deploy again. Rollback, which redeploys a release the environment already
// accepted, and the read-only verbs stay open.
import { declaredCutovers, todayOf } from '../runtime/scripts/lib/stack-cutover.mjs';
import { refusal } from './errors.mjs';

/** The refusal code of a deploy to an environment pending its cutover. */
export const CUTOVER_PENDING = 'STACK_CUTOVER_PENDING';

/** True when `action` with `argv` would change what runs on the environment: any deploy, an executed prepare. */
export const deploysTo = (action: string | undefined, argv: readonly string[]): boolean => action === 'deploy' || (action === 'prepare' && argv.includes('--execute'));

/** The `--env` value of an argv (`--env <v>`), or undefined. */
function envOf(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--env');
  return at < 0 ? undefined : argv[at + 1];
}

/** Refuses a deploying verb on an environment that declares a cutover; returns nothing otherwise. */
export function refuseCutoverPending(repoRoot: string, action: string | undefined, argv: readonly string[], today: string = todayOf()): void {
  if (!deploysTo(action, argv)) return;
  const env = envOf(argv);
  if (env === undefined) return;
  const read = declaredCutovers(repoRoot, today);
  if (!read.present.includes(env)) return;
  const declared = read.declared[env];
  const state = declared === undefined
    ? 'its cutover block is not sound (starci app check names the problem)'
    : `it is pending its cutover until ${declared.until}${declared.expired ? ' (expired)' : ''}: ${declared.reason.replace(/\.$/u, '')}`;
  throw refusal(CUTOVER_PENDING, `stack ${String(action)} --env ${env}: ${state}. Nothing was changed. Run the environment's cutover runbook; its last step removes environments.${env}.cutover from .starcistacks/application-stacks.yaml, and only then does ${env} deploy (PROJECT-STACKS-19)`);
}

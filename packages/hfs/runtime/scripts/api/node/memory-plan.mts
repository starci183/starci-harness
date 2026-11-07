// memory-plan.mts - the memory plan an app check runs under, as starci-harness hands it (STARCI_MEMORY_PLAN, cli/src/harness/memory-plan.ts): the
// heaps the CLI sized from the app's scope. The CLI applies them to the children it runs; this side reads two parts of it: the files one ESLint
// child of the lint ratchet takes, and the plan an out-of-memory message names. Without a plan (an older CLI) neither changes.

/** The environment variable that carries the plan. */
export const MEMORY_PLAN_ENV = 'STARCI_MEMORY_PLAN';

/** The parts of the plan this package reads. */
export interface PlanInForce {
  readonly parentMb: number;
  readonly lintChunk: number;
}

/** The plan in force for this process; undefined without one or when it does not read as one. */
export function planInForce(env: NodeJS.ProcessEnv = process.env): PlanInForce | undefined {
  const text = env[MEMORY_PLAN_ENV];
  if (text === undefined || text === '') return undefined;
  try {
    const plan = JSON.parse(text) as Partial<PlanInForce>;
    if (typeof plan.parentMb !== 'number' || typeof plan.lintChunk !== 'number') return undefined;
    return plan as PlanInForce;
  } catch {
    return undefined;
  }
}

/** The texts one ESLint child takes: the plan's lint chunk, else `fallback`. */
export function lintChunkOf(fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const chunk = planInForce(env)?.lintChunk;
  return chunk !== undefined && Number.isInteger(chunk) && chunk > 0 ? chunk : fallback;
}

/** The plan in one clause for an out-of-memory message (`the memory plan in force: parent 5632 MB`); empty without one. */
export function planClause(env: NodeJS.ProcessEnv = process.env): string {
  const plan = planInForce(env);
  if (plan === undefined) return '';
  return `the memory plan in force: parent ${String(plan.parentMb)} MB (starci app check --explain prints the test run the free RAM gives)`;
}

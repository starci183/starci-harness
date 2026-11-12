// project-checks.mts - the `checks` step of `starci app check` (R402, PROJECT-LINT-3): the project checks hfs.json `checks` declares, each a file of
// slot app.checks (`scripts/checks/*.mjs`) that the step runs with the Node that runs the check, from the app root, through the heavy governor (a
// `build` child of the step's parity port), one after another in declaration order. A check is green when it exits 0 and red otherwise: its
// finding HFS_PROJECT_CHECK_FAILED names the check, its file, its exit and the last lines it printed. A check reads what it reads (the tree, a
// generated file, the network), so no cache key could hold its verdict: it runs on every run that selects hfs, never reused.
import fs from 'node:fs';
import path from 'node:path';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { ParityRun } from './parity-family.mjs';

/** The finding of a project check that failed or could not run. */
export const PROJECT_CHECK_FAILED = 'HFS_PROJECT_CHECK_FAILED';
/** The most lines of a red check's output its finding carries. */
const TAIL_LINES = 20;

/** One check hfs.json declares: its id, the file it runs and why the project keeps it. */
export interface ProjectCheck { readonly id: string; readonly run: string; readonly why: string }

/** The checks hfs.json `checks` declares at `repoRoot`, in order; none when it declares none or cannot be read (the declaration check judges its shape). */
export function declaredChecks(repoRoot: string): ProjectCheck[] {
  let declaration: { checks?: unknown };
  try { declaration = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')) as typeof declaration; } catch { return []; }
  if (!Array.isArray(declaration.checks)) return [];
  return declaration.checks.filter((check): check is ProjectCheck => typeof check === 'object' && check !== null && typeof (check as ProjectCheck).id === 'string' && typeof (check as ProjectCheck).run === 'string')
    .map((check) => ({ id: check.id, run: check.run, why: typeof check.why === 'string' ? check.why : '' }));
}

/** The last TAIL_LINES non-empty lines of a check's output, joined. */
const tailOf = (text: string): string => text.split(/\r?\n/u).map((line) => line.trimEnd()).filter((line) => line.trim() !== '').slice(-TAIL_LINES).join('\n');

/** Runs every declared check: its findings (one per red check) and one line per check, `project check <id> (<file>): green|red (exit n)`. */
export async function runProjectChecks({ repoRoot, run, env }: { repoRoot: string; run: ParityRun; env: NodeJS.ProcessEnv }): Promise<{ findings: CheckFinding[]; lines: string[] }> {
  const findings: CheckFinding[] = [];
  const lines: string[] = [];
  const checks = declaredChecks(repoRoot);
  if (checks.length === 0) return { findings, lines: ['  project checks: none declared (hfs.json checks)'] };
  for (const check of checks) {
    if (!fs.existsSync(path.join(repoRoot, check.run))) {
      findings.push({ code: PROJECT_CHECK_FAILED, level: 'error', path: check.run, message: `project check ${check.id} runs ${check.run}, which the app does not hold: restore the file or remove the check from hfs.json checks` });
      lines.push(`  project check ${check.id} (${check.run}): red, the file is missing`);
      continue;
    }
    const result = await run({ kind: 'build', label: `app check project check ${check.id}`, cwd: repoRoot, argv: [process.execPath, check.run], env });
    const output = tailOf(`${result.stdout}\n${result.stderr}`);
    const exit = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
    if (result.status === 0 && result.error === undefined) {
      lines.push(`  project check ${check.id} (${check.run}): green (exit 0)${output === '' ? '' : `: ${output.split('\n').at(-1) ?? ''}`}`);
      continue;
    }
    findings.push({ code: PROJECT_CHECK_FAILED, level: 'error', path: check.run, message: `project check ${check.id} (${check.run}) failed (${exit}); it guards: ${check.why}${output === '' ? '' : `\n${output}`}` });
    lines.push(`  project check ${check.id} (${check.run}): red (${exit})`);
  }
  return { findings, lines };
}

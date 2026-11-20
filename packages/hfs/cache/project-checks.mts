// project-checks.mts - the `checks` step of `starci app check` (R402, PROJECT-LINT-3): the project checks the project's extension manifest declares
// (`ext/manifest.json` `checks`, each { id, run, why } with `run` a file `ext/checks/<name>.mjs`), which the step runs with the Node that runs the
// check, from the app root, through the heavy governor (a `build` child of the step's parity port), one after another in declaration order. A check
// is green when it exits 0 and red otherwise: its finding HFS_PROJECT_CHECK_FAILED names the check, its file, its exit and the last lines it
// printed. A check reads what it reads (the tree, a generated file, the network), so by default no cache key could hold its verdict: it runs on every run that
// selects hfs, never reused. A check that DECLARES what it reads (`reads`: tracked files or folders; `refs`: git revisions `<ref>:<path>` whose object it compares the tree with) is scoped: its verdict
// is a record of check/build (cache/check-verdicts.mts) keyed on the content of those tracked paths, the objects the refs name, its own file, the Node major, the harness and the lockfile, and an
// unchanged key reuses it (a check that reads anything else, a generated file or the network, must not declare reads). The shape of the declaration is judged with the rest of the manifest (scripts/lib/project-ext.mts, R381).
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_EXT_MANIFEST } from '../runtime/scripts/lib/project-ext.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { revisionSha, VerdictBook, verdictKey, type VerdictKey } from './check-verdicts.mjs';
import type { CheckSession } from './types.mjs';
import type { ParityRun } from './parity-family.mjs';

/** The finding of a project check that failed or could not run. */
export const PROJECT_CHECK_FAILED = 'HFS_PROJECT_CHECK_FAILED';
/** The most lines of a red check's output its finding carries. */
const TAIL_LINES = 20;

/** One check the manifest declares: its id, the file it runs and why the project keeps it. */
export interface ProjectCheck { readonly id: string; readonly run: string; readonly why: string; readonly reads?: readonly string[]; readonly refs?: readonly string[] }

/** The step of a project check's verdict in the records of check/build. */
export const PROJECT_CHECK_STEP = 'project-check';

/** `{ [name]: list }` when `list` is a non-empty list of strings, else nothing. */
const strings = (name: 'reads' | 'refs', list: unknown): { reads?: readonly string[]; refs?: readonly string[] } => (Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === 'string') ? (name === 'reads' ? { reads: list as string[] } : { refs: list as string[] }) : {});

/** The checks ext/manifest.json `checks` declares at `repoRoot`, in order; none when it declares none or cannot be read (R381 judges the manifest's shape). */
export function declaredChecks(repoRoot: string): ProjectCheck[] {
  let declaration: { checks?: unknown };
  try { declaration = JSON.parse(fs.readFileSync(path.join(repoRoot, PROJECT_EXT_MANIFEST), 'utf8')) as typeof declaration; } catch { return []; }
  if (!Array.isArray(declaration.checks)) return [];
  return declaration.checks.filter((check): check is ProjectCheck => typeof check === 'object' && check !== null && typeof (check as ProjectCheck).id === 'string' && typeof (check as ProjectCheck).run === 'string')
    .map((check) => ({ id: check.id, run: check.run, why: typeof check.why === 'string' ? check.why : '', ...strings('reads', check.reads), ...strings('refs', check.refs) }));
}

/** The last TAIL_LINES non-empty lines of a check's output, joined. */
const tailOf = (text: string): string => text.split(/\r?\n/u).map((line) => line.trimEnd()).filter((line) => line.trim() !== '').slice(-TAIL_LINES).join('\n');

/** The key of a check that declares what it reads, and whether its verdict may be stored (every ref it names resolved); undefined for a check that declares no reads. */
function keyOfCheck(session: CheckSession, repoRoot: string, check: ProjectCheck): { key: VerdictKey; complete: boolean } | undefined {
  if (check.reads === undefined) return undefined;
  const extra: Record<string, string> = { '#run': session.index.hashOf(check.run) ?? 'absent' };
  let complete = true;
  for (const revision of check.refs ?? []) {
    const sha = revisionSha(repoRoot, revision);
    if (sha === null) complete = false;
    extra[`ref:${revision}`] = sha ?? 'unresolved';
  }
  return { key: verdictKey(session, [...check.reads, check.run], extra), complete };
}

/**
 * Runs every declared check: its findings (one per red check) and one line per check, `project check <id> (<file>): green|red (exit n)`. With a `session`, a check that declares `reads`
 * takes the verdict recorded for an unchanged key (`green (reused)`) and records the one it ran to its own exit; a refs revision git cannot name (a ref not fetched) runs the check and stores nothing.
 */
export async function runProjectChecks({ repoRoot, run, env, session }: { repoRoot: string; run: ParityRun; env: NodeJS.ProcessEnv; session?: CheckSession | undefined }): Promise<{ findings: CheckFinding[]; lines: string[] }> {
  const findings: CheckFinding[] = [];
  const lines: string[] = [];
  const checks = declaredChecks(repoRoot);
  if (checks.length === 0) return { findings, lines: ['  project checks: none declared (ext/manifest.json checks)'] };
  const book = session === undefined ? undefined : new VerdictBook(session, PROJECT_CHECK_STEP, session.decide('hfs').mode === 'diff');
  for (const check of checks) {
    if (!fs.existsSync(path.join(repoRoot, check.run))) {
      findings.push({ code: PROJECT_CHECK_FAILED, level: 'error', path: check.run, message: `project check ${check.id} runs ${check.run}, which the app does not hold: restore the file or remove the check from ext/manifest.json checks` });
      lines.push(`  project check ${check.id} (${check.run}): red, the file is missing`);
      continue;
    }
    const keyed = session === undefined ? undefined : keyOfCheck(session, repoRoot, check);
    const recordId = `${PROJECT_CHECK_STEP}/${check.id}`;
    // A check that names refs is keyed on what this checkout fetched, not on what its commit carries: its verdict is machine-local (CheckSession.localRecords).
    const local = (check.refs ?? []).length > 0;
    if (local) book?.dropCommitted(recordId);
    const held = keyed === undefined || !keyed.complete ? undefined : book?.held(recordId, keyed.key, local);
    if (held !== undefined) {
      if (!held.red) lines.push(`  project check ${check.id} (${check.run}): green (reused, nothing it reads changed)`);
      else {
        findings.push({ code: PROJECT_CHECK_FAILED, level: 'error', path: check.run, message: `${held.message} (the verdict recorded for this tree)` });
        lines.push(`  project check ${check.id} (${check.run}): red (reused, nothing it reads changed)`);
      }
      continue;
    }
    const result = await run({ kind: 'build', label: `app check project check ${check.id}`, cwd: repoRoot, argv: [process.execPath, check.run], env });
    const output = tailOf(`${result.stdout}\n${result.stderr}`);
    const exit = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
    const green = result.status === 0 && result.error === undefined;
    const settled = result.error === undefined && result.status !== null && result.status >= 0 && result.status < 128;
    const message = `project check ${check.id} (${check.run}) failed (${exit}); it guards: ${check.why}${output === '' ? '' : `\n${output}`}`;
    if (keyed?.complete === true && settled) book?.put(recordId, keyed.key, { red: !green, message }, local);
    if (green) {
      lines.push(`  project check ${check.id} (${check.run}): green (exit 0)${output === '' ? '' : `: ${output.split('\n').at(-1) ?? ''}`}`);
      continue;
    }
    findings.push({ code: PROJECT_CHECK_FAILED, level: 'error', path: check.run, message });
    lines.push(`  project check ${check.id} (${check.run}): red (${exit})`);
  }
  book?.finish();
  return { findings, lines };
}

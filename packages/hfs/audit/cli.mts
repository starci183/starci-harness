// cli.mts - `starci app audit [--omit-dev] [--level <info|low|moderate|high|critical>] [--from <report.json>] [--cwd <dir>]`: the production dependency
// audit of the managed CI (the fast job's `production dependency audit` step) and of the pre-push CI parity (which runs that same step's command), judged
// against the app's time-boxed exceptions (.starcistacks/security/audit-exceptions.yaml, contexts/project/lint.md PROJECT-LINT-5).
// It runs `npm audit [--omit=dev] --json` itself (npm exits non-zero on a vulnerability; the report on stdout is what is judged, and a run that printed no
// report fails AUDIT_REPORT_UNREADABLE), then audit/judge.mts judges the report with package-lock.json and the exceptions file. `--from` judges a saved
// report instead of running npm (a spec, a proof). Exit 0 passed (active exceptions are still printed: AUDIT_EXCEPTION_ACTIVE), 1 a finding failed, 2 bad usage.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXCEPTIONS_FILE, isAuditLevel, judge, readReport, AUDIT_REPORT_UNREADABLE } from './judge.mjs';
import type { AuditLevel, Lockfile } from './judge.mjs';

export const USAGE = 'usage: starci app audit [--omit-dev] [--level <info|low|moderate|high|critical>] [--from <report.json>] [--cwd <dir>]';

/** What runs `npm audit --json` in `cwd`: its stdout (the report, whatever the exit status). */
export type RunNpmAudit = (cwd: string, args: readonly string[]) => { stdout: string; error?: string };

/** The real run: `npm` (a `.cmd` shim on Windows, which needs the shell), the report on stdout, a spawn failure as its message. */
const runNpmAudit: RunNpmAudit = (cwd, args) => {
  const result = spawnSync('npm', [...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  const error = result.error ? result.error.message : undefined;
  return error === undefined ? { stdout: result.stdout } : { stdout: result.stdout ?? '', error };
};

interface Options { omitDev: boolean; level: AuditLevel; from?: string; cwd?: string }

function parse(argv: readonly string[]): Options {
  const opts: Options = { omitDev: false, level: 'high' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--omit-dev') { opts.omitDev = true; continue; }
    if (flag !== '--level' && flag !== '--from' && flag !== '--cwd') throw new Error(`unknown argument ${arg}; ${USAGE}`);
    const value = inline ?? argv[index + 1];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Error(`${flag} needs a value; ${USAGE}`);
    if (inline === undefined) index += 1;
    if (flag === '--level') { if (!isAuditLevel(value)) throw new Error(`--level must be one of info, low, moderate, high, critical; ${USAGE}`); opts.level = value; }
    else opts[flag.slice(2) as 'from' | 'cwd'] = value;
  }
  return opts;
}

const readText = (file: string): string | undefined => { try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; } };

/** Exit 0 passed, 1 a finding failed, 2 bad usage or no report. `run` replaces the `npm audit` child and `now` the clock in a spec. */
export function auditMain(argv: string[], { cwd: baseCwd = process.cwd(), stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), run = runNpmAudit, now = () => new Date() }: {
  cwd?: string; stdout?: (text: string) => unknown; stderr?: (text: string) => unknown; run?: RunNpmAudit; now?: () => Date;
} = {}): number {
  let opts: Options;
  try { opts = parse(argv); } catch (error) { stderr(`starci app audit: ${(error as Error).message}\n`); return 2; }
  const cwd = path.resolve(baseCwd, opts.cwd ?? '.');
  let text: string | undefined;
  if (opts.from !== undefined) text = readText(path.resolve(cwd, opts.from));
  else {
    const result = run(cwd, ['audit', ...(opts.omitDev ? ['--omit=dev'] : []), '--json']);
    text = result.stdout;
    if (result.error !== undefined && !text) { stderr(`${AUDIT_REPORT_UNREADABLE}: npm audit did not run: ${result.error}\n`); return 1; }
  }
  const read = readReport(text ?? '');
  if (read.report === undefined) { stderr(`${AUDIT_REPORT_UNREADABLE}: ${read.error ?? 'no report'}\n`); return 1; }
  let lock: Lockfile | undefined;
  try { lock = JSON.parse(readText(path.join(cwd, 'package-lock.json')) ?? 'null') as Lockfile | undefined; } catch { lock = undefined; }
  const findings = judge({ report: read.report, lock, exceptionsText: readText(path.join(cwd, EXCEPTIONS_FILE)), level: opts.level, omitDev: opts.omitDev, now: now() });
  for (const finding of findings) (finding.level === 'error' ? stderr : stdout)(`${finding.code}: ${finding.message}\n`);
  const errors = findings.filter((finding) => finding.level === 'error').length;
  stdout(errors === 0 ? `starci app audit: passed (level ${opts.level}${opts.omitDev ? ', production dependencies' : ''}; ${String(findings.length)} active exception(s) reported)\n` : `starci app audit: ${String(errors)} finding(s) failed\n`);
  return errors === 0 ? 0 : 1;
}

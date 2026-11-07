// sonar-scan-family.mts - the Sonar scan of `starci app check`: the app's own CI sonar job run locally, so a scanner crash or a red quality
// gate is found before the push and not first by CI. Everything comes from the app: the project key, sources, exclusions, coverage and lint-report paths from its
// `sonar-project.properties` (the file the CI job reads), the server and the token's custody from its stack declaration (the release gate's connection, `sonarGate`),
// the quality gate from the server (the one the project is bound to). Nothing is stated here.
// The scan never touches the project's own analysis: a server with branch support receives it as the branch `local/<user>`; a server without (Community) receives it
// as the derived project `<projectKey>-local`, created with the main project's visibility and bound to the main project's quality gate when the token may, else the
// step is skipped with a warning. The verdict of a green scan is kept in the untracked tool cache keyed by the scanned content, so an unchanged tree is not scanned again.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launch, sonarGate } from '../release/gate.mjs';
import { loadReleaseConfig, contextOf, type VerbIo } from '../release/index.mjs';
import { sonarQualityGate } from '../release/sonar-quality-gate.mjs';
import { inCacheDir } from './content-index.mjs';
import { toolCacheDir } from './run-log.mjs';
import type { ParityRun } from './parity-family.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { ContentIndex } from './types.mjs';

/** The scanner crashed or exited non-zero: a failure CI's sonar job would report. */
export const SCAN_FAILED = 'CI_PARITY_SONAR_SCAN_FAILED';
/** The server's quality gate of the local analysis is ERROR, or its compute-engine task failed. */
export const GATE_FAILED = 'CI_PARITY_SONAR_GATE_FAILED';
/** The scan could not run here (no token, no network, no permission, no verdict readable): a warning, never a green. */
export const SCAN_SKIPPED = 'CI_PARITY_SONAR_SKIPPED';

/** The properties file of the app: the one the CI sonar job reads. */
export const PROPERTIES = 'sonar-project.properties';
/** The merged lint report the properties import (`sonar.externalIssuesReportPaths`), written from this run's linter results before the scan. */
export const LINT_REPORT = 'reports/lint.sonar.json';
const VERDICT_FILE = 'sonar-scan.json';

/** The `key=value` lines of a properties file; comments and blank lines are left out, the last value of a key wins. */
export function propertiesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const at = trimmed.indexOf('=');
    if (at > 0) out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}

/** The branch name of a local scan: `local/<user>` with the user cut to characters a branch name keeps. */
export function localBranchOf(user: string | undefined): string {
  const name = (user ?? '').replace(/[^A-Za-z0-9._-]/gu, '-').replace(/^-+|-+$/gu, '');
  return `local/${name === '' ? 'developer' : name}`;
}

/** The project key of a scan on a server without branch support: the app's key with the `-local` suffix. */
export const localKeyOf = (projectKey: string): string => `${projectKey}-local`;

/** What the step reports: findings, the lines of the run's diagnosis and the family report numbers. */
export interface SonarScanResult { readonly findings: CheckFinding[]; readonly lines: string[] }

/** What the step needs from the check run. */
export interface SonarScanInput {
  readonly repoRoot: string;
  readonly env: NodeJS.ProcessEnv;
  /** The app IO the release gate's connection reads (cwd, env, sops, host identity, the injectable fetch and clock). */
  readonly io: VerbIo;
  /** The heavy command port the scanner runs through. */
  readonly run: ParityRun;
  readonly index: ContentIndex;
  /** Writes `reports/lint.sonar.json` from this run's linter results; called only once the scan is going to run. */
  readonly writeLintReport: () => void;
  /** `--fresh`: the kept verdict is ignored. */
  readonly fresh: boolean;
  readonly platform?: NodeJS.Platform;
}

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const fileDigest = (file: string): string => { try { return sha256(fs.readFileSync(file)); } catch { return 'absent'; } };
const tailOf = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-6).join(' | ').slice(0, 800);
const skipped = (message: string): CheckFinding => ({ code: SCAN_SKIPPED, level: 'warning', engine: 'sonar', path: PROPERTIES, message: `the Sonar scan was not run here (${message}); CI runs it, and this run is not reported green for it` });

/** The digest of the scanned content: every tracked file outside the cache folder, the properties, the coverage and lint reports they name. */
export function scanKey(input: { index: ContentIndex; repoRoot: string; properties: Record<string, string>; propertiesText: string; target: string; gateDigest: string; scanner: string }): string {
  const tree = sha256(input.index.paths.filter((file) => !inCacheDir(file)).slice().sort().map((file) => `${file}\0${input.index.hashOf(file) ?? 'absent'}`).join('\n'));
  const reports = [...(input.properties['sonar.javascript.lcov.reportPaths'] ?? '').split(','), ...(input.properties['sonar.externalIssuesReportPaths'] ?? '').split(',')]
    .map((file) => file.trim()).filter(Boolean).sort().map((file) => `${file}\0${fileDigest(path.join(input.repoRoot, file))}`);
  return sha256(JSON.stringify({ v: 1, tree, properties: sha256(input.propertiesText), reports, target: input.target, gate: input.gateDigest, scanner: input.scanner }));
}

interface Answer { readonly status: number; readonly body: any } // reason: SonarQube web API answers are JSON read over HTTP; each reader names the fields it uses

/** One authenticated call of the server's web API; a network error is `status` 0. */
async function api(fetcher: typeof fetch, host: string, token: string, request: string, method: 'GET' | 'POST' = 'GET'): Promise<Answer> {
  try {
    const response = await fetcher(`${host.replace(/\/$/u, '')}/${request}`, { method, headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` }, signal: AbortSignal.timeout(30_000) });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* an answer with no JSON body */ }
    return { status: response.status, body };
  } catch { return { status: 0, body: null }; }
}

const q = encodeURIComponent;

/** The edition the server reports to an authenticated user, or null when it does not say. */
async function editionOf(fetcher: typeof fetch, host: string, token: string): Promise<string | null> {
  const answer = await api(fetcher, host, token, 'api/navigation/global');
  return answer.status === 200 && typeof answer.body?.edition === 'string' ? answer.body.edition.toLowerCase() : null;
}

/**
 * Makes the derived project exist with the main project's visibility and bound to the main project's quality gate, or says why it cannot (the token may
 * not read the main project, create projects or select a gate): the caller skips the scan with that reason. A project that exists is kept as it is,
 * only its gate binding is made equal.
 */
async function ensureLocalProject(fetcher: typeof fetch, host: string, token: string, mainKey: string, localKey: string): Promise<string | null> {
  const main = await api(fetcher, host, token, `api/components/show?component=${q(mainKey)}`);
  if (main.status !== 200) return `the token cannot read project ${mainKey} (HTTP ${String(main.status)})`;
  const here = await api(fetcher, host, token, `api/components/show?component=${q(localKey)}`);
  if (here.status === 404) {
    const name = `${String(main.body?.component?.name ?? mainKey)} (local)`;
    const visibility = main.body?.component?.visibility === 'public' ? 'public' : 'private';
    const made = await api(fetcher, host, token, `api/projects/create?project=${q(localKey)}&name=${q(name)}&visibility=${visibility}`, 'POST');
    if (made.status !== 200) return `the token may not create project ${localKey} (HTTP ${String(made.status)})`;
  } else if (here.status !== 200) return `the token cannot read project ${localKey} (HTTP ${String(here.status)})`;
  const wanted = await api(fetcher, host, token, `api/qualitygates/get_by_project?project=${q(mainKey)}`);
  const gate = wanted.body?.qualityGate?.name;
  if (wanted.status !== 200 || typeof gate !== 'string') return `the quality gate of ${mainKey} is not readable (HTTP ${String(wanted.status)})`;
  const have = await api(fetcher, host, token, `api/qualitygates/get_by_project?project=${q(localKey)}`);
  if (have.status === 200 && have.body?.qualityGate?.name === gate) return null;
  const bound = await api(fetcher, host, token, `api/qualitygates/select?gateName=${q(gate)}&projectKey=${q(localKey)}`, 'POST');
  return bound.status === 204 || bound.status === 200 ? null : `the token may not bind ${localKey} to the quality gate ${gate} (HTTP ${String(bound.status)})`;
}

/** The digest of the project's quality gate conditions as the server holds them now; null when they cannot be read. */
async function gateDigestOf(fetcher: typeof fetch, host: string, token: string, projectKey: string): Promise<string | null> {
  const bound = await api(fetcher, host, token, `api/qualitygates/get_by_project?project=${q(projectKey)}`);
  const name = bound.body?.qualityGate?.name;
  if (bound.status !== 200 || typeof name !== 'string') return null;
  const shown = await api(fetcher, host, token, `api/qualitygates/show?name=${q(name)}`);
  return shown.status === 200 ? sha256(JSON.stringify([name, shown.body?.conditions ?? null])) : null;
}

interface Verdict { readonly key: string; readonly detail: string }
const verdictFile = (repoRoot: string, env: NodeJS.ProcessEnv): string => path.join(toolCacheDir(repoRoot, env), VERDICT_FILE);
function keptVerdict(repoRoot: string, env: NodeJS.ProcessEnv): Verdict | null {
  try { return JSON.parse(fs.readFileSync(verdictFile(repoRoot, env), 'utf8')) as Verdict; } catch { return null; }
}
function keepVerdict(repoRoot: string, env: NodeJS.ProcessEnv, verdict: Verdict): void {
  try { fs.mkdirSync(path.dirname(verdictFile(repoRoot, env)), { recursive: true }); fs.writeFileSync(verdictFile(repoRoot, env), `${JSON.stringify(verdict)}\n`); } catch { /* host state only */ }
}

/**
 * The Sonar scan of the app: not run (an info line) when the app has no `sonar-project.properties` or declares no Sonar; skipped with a warning when the
 * token, the server or the permission it needs is missing; otherwise the scanner runs against the local target, the server's quality gate of that analysis is
 * read, and a scanner failure or a red gate is an error. A green verdict is reused while the scanned content is the same.
 */
export async function runSonarScan(input: SonarScanInput): Promise<SonarScanResult> {
  const { repoRoot, env, io } = input;
  const note = (line: string): SonarScanResult => ({ findings: [], lines: [`  sonar scan: ${line}`] });
  let propertiesText: string;
  try { propertiesText = fs.readFileSync(path.join(repoRoot, PROPERTIES), 'utf8'); } catch { return note(`not run, the app has no ${PROPERTIES}`); }
  const properties = propertiesOf(propertiesText);
  let services: ReturnType<typeof loadReleaseConfig>['services'];
  try { services = loadReleaseConfig(repoRoot).services; } catch { return note('not run, the app declares no readable stack declaration'); }
  if (!services?.sonar) return note('not run, the app declares no Sonar service');
  const ctx = contextOf({ ...io, cwd: repoRoot, env });
  let gate: ReturnType<typeof sonarGate>;
  try { gate = sonarGate(services, ctx, true); } catch (error) { return { findings: [skipped(String((error as Error).message))], lines: ['  sonar scan: skipped, no token or host (warning)'] }; }
  const token = gate.env['SONAR_TOKEN'];
  const host = String(gate.provider.host ?? '');
  const redact = (text: string): string => [token, ...(gate.provider.privateHost === true ? [host] : [])].filter((value): value is string => Boolean(value)).reduce((out, value) => out.replaceAll(value, '[REDACTED]'), text);
  if (token === undefined || token === '' || host === '') return { findings: [skipped('the Sonar token or server URL is not available')], lines: ['  sonar scan: skipped, no token or host (warning)'] };
  const status = await api(ctx.fetch, host, token, 'api/system/status');
  if (status.status !== 200 || status.body?.status !== 'UP') return { findings: [skipped(`${gate.provider.privateHost === true ? 'the declared server' : host} did not report UP`)], lines: ['  sonar scan: skipped, server unreachable (warning)'] };
  const mainKey = properties['sonar.projectKey'] ?? String(gate.provider.projectKey ?? '');
  if (mainKey === '') return { findings: [skipped(`${PROPERTIES} sets no sonar.projectKey`)], lines: ['  sonar scan: skipped, no project key (warning)'] };
  const edition = await editionOf(ctx.fetch, host, token);
  const branches = edition !== null && edition !== 'community';
  const target = branches ? { key: mainKey, branch: localBranchOf(env['USERNAME'] ?? env['USER']) } : { key: localKeyOf(mainKey), branch: null };
  if (!branches) {
    const problem = await ensureLocalProject(ctx.fetch, host, token, mainKey, target.key);
    if (problem !== null) return { findings: [skipped(redact(problem))], lines: ['  sonar scan: skipped, the local project is not available (warning)'] };
  }
  const gateDigest = await gateDigestOf(ctx.fetch, host, token, target.key);
  input.writeLintReport();
  const scanner = gate.command.find((word) => word.startsWith('@sonar/')) ?? 'scanner';
  const key = gateDigest === null ? null : scanKey({ index: input.index, repoRoot, properties, propertiesText, target: `${target.key}@${target.branch ?? ''}@${host}`, gateDigest, scanner });
  const kept = input.fresh || key === null ? null : keptVerdict(repoRoot, env);
  if (key !== null && kept?.key === key) return note(`reused, the scanned content and the quality gate are those of the last green scan (${kept.detail})`);
  const where = target.branch === null ? `project ${target.key}` : `branch ${target.branch} of ${target.key}`;
  const command = [...gate.command.filter((word) => !word.startsWith('-Dsonar.projectKey=')), `-Dsonar.projectKey=${target.key}`, ...(target.branch === null ? [] : [`-Dsonar.branch.name=${target.branch}`])];
  fs.rmSync(path.join(repoRoot, '.scannerwork', 'report-task.txt'), { force: true });
  const [program, args] = launch(command, input.platform ?? process.platform);
  const ran = await input.run({ kind: 'build', label: 'app check sonar scan', cwd: repoRoot, argv: [program, ...args], env: { ...env, ...gate.env } });
  if (ran.status !== 0 || ran.error !== undefined) {
    const why = ran.error === undefined ? `exit ${String(ran.status)}` : ran.error.message;
    return { findings: [{ code: SCAN_FAILED, level: 'error', engine: 'sonar', path: PROPERTIES, message: `the Sonar scanner failed locally as the CI sonar job would (${redact(why)}) against ${where}: ${redact(tailOf(`${ran.stdout}\n${ran.stderr}`))}` }], lines: [`  sonar scan: scanner failed against ${where}`] };
  }
  const verdict = await sonarQualityGate(ctx, { cwd: repoRoot, host, token });
  const detail = redact(verdict.detail);
  if (verdict.pass) {
    if (key !== null) keepVerdict(repoRoot, env, { key, detail });
    return note(`quality gate OK against ${where}`);
  }
  if (/^RELEASE_SONAR_GATE_(UNREADABLE|TIMEOUT)/u.test(detail)) return { findings: [skipped(detail)], lines: [`  sonar scan: no verdict readable from ${where} (warning)`] };
  return { findings: [{ code: GATE_FAILED, level: 'error', engine: 'sonar', path: PROPERTIES, message: `the Sonar quality gate of ${where} is red: ${detail}` }], lines: [`  sonar scan: quality gate ERROR against ${where}`] };
}

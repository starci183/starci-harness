// app-families.mts - the adapters that run the heavy families (`--types`, `--test`, `--sonar`) on a real app: its tsconfigs for the programs, its own Jest and
// jest-preset for the specs, its owners' files for the baselines. The families themselves (types-family, test-family, quality-baselines) take their tools as seams;
// this module is where the real ones are chosen. The integration, e2e and contract specs are not run here: they need a world (`npm run test:integration`, ...) and
// always run in full wherever they run, so no cache key could hold them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { skillRoot } from '../runtime/engine/runtime-root.mjs';
import { coverageFrom } from '../runtime/scripts/hfs/coverage-from.mjs';
import { readWhy, type CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { git as runGitText } from './git.mjs';
import { toolCacheDir } from './run-log.mjs';
import { untrackedProgramInputs } from './side-key.mjs';
import { createJestEnvironment, installedSpecMerge, runTestFamily, shardArgs, type TestFamilyResult } from './test-family.mjs';
import { createTscRunner, runTypesFamily, type TypesFamilyResult, type TypesProgram } from './types-family.mjs';
import { changedLinesFromDiff, gitRunner, lineCoverageOf, recordsAtCommit, runQualityFamily, type QualityFamilyResult } from './quality-baselines.mjs';
import type { CheckSession, Finding } from './types.mjs';

const asFinding = (found: Finding, code: string, level: string, engine: string): CheckFinding => ({ code, level, engine, path: found.path, line: found.line || undefined, column: found.column || undefined, message: `${found.path}${found.line ? `:${found.line}` : ''}: ${found.message}` });

/** The tsc programs of the app: the back end and each front-end workspace, from the tracked tsconfigs. */
export function programsOf(tracked: readonly string[]): TypesProgram[] {
  const programs: TypesProgram[] = [];
  for (const file of tracked) {
    if (file === 'be/tsconfig.json') programs.push({ name: 'be', tsconfig: file, reads: ['be'] });
    const match = /^(fe\/(?:apps|packages)\/[^/]+)\/tsconfig\.json$/.exec(file);
    if (match?.[1] !== undefined) programs.push({ name: match[1], tsconfig: file, reads: [match[1]] });
  }
  return programs.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** `--types`: `tsc --noEmit` per workspace program through the app's TypeScript, reused by program key. */
export function runTypesForApp(session: CheckSession, { repoRoot, tracked, env }: { repoRoot: string; tracked: readonly string[]; env: NodeJS.ProcessEnv }): { result: TypesFamilyResult; findings: CheckFinding[] } {
  const programs = programsOf(tracked);
  const trackedSet = new Set(tracked);
  const result = runTypesFamily({
    session, programs, run: createTscRunner({ appRoot: repoRoot }), toolCacheDir: toolCacheDir(repoRoot, env),
    inputsOf: (program) => {
      const side = program.name.startsWith('be') ? 'be' : 'fe';
      const prefix = `${program.reads?.[0] ?? side}/`;
      const staged = runGitText(repoRoot, ['ls-files', '-s', '-z', '--', prefix]).stdout.split('\0').filter(Boolean).map((line) => line.replace(/^\d+ ([0-9a-f]+) (\d)\t(.*)$/u, '$3:$1:$2'));
      return { staged, untracked: untrackedProgramInputs(repoRoot, side, trackedSet).filter((file) => file.startsWith(prefix)) };
    },
  });
  return { result, findings: result.findings.map((found) => asFinding(found, 'TS_DIAGNOSTIC', 'error', 'tsc')) };
}

/** `--test`: the unit specs of the back end through the app's own Jest, reused by closure key; the merged total is judged by `@starci/hfs` (the coverage proof). */
export async function runTestForApp(session: CheckSession, { repoRoot, tracked }: { repoRoot: string; tracked: readonly string[] }): Promise<{ result: TestFamilyResult | null; findings: CheckFinding[] }> {
  if (!tracked.includes('be/package.json') && !tracked.some((file) => file.startsWith('be/'))) return { result: null, findings: [] };
  const jest = await createJestEnvironment({ appRoot: repoRoot, side: 'be' });
  let judged: CheckFinding[] = [];
  const result = runTestFamily({
    session, jest, side: 'be', merge: installedSpecMerge(repoRoot),
    judge: (lcovPath) => {
      const report = coverageFrom({ repoRoot, lcov: fs.readFileSync(lcovPath, 'utf8'), files: [...tracked] }) as { ok: boolean; findings: CheckFinding[] };
      judged = report.findings.length === 0 ? [] : withWhy(report.findings, readWhy(skillRoot, [...new Set(report.findings.map((found) => found.code))])) as CheckFinding[];
      return { ok: report.ok, findings: report.findings.map((found) => ({ code: found.code, message: String(found.message ?? '') })) };
    },
  });
  const findings: CheckFinding[] = [...judged];
  for (const spec of result.failed) findings.push({ code: 'JEST_SPEC_FAILED', level: 'error', engine: 'jest', path: spec, message: `${spec} failed or reported no coverage; run npm test for its output` });
  return { result, findings };
}

/** `--test --full --shard i/n`: one shard of the full unit run in the shape the shard merge reads; nothing is recorded. */
export function runTestShard(repoRoot: string, index: number, total: number): number {
  const shard = shardArgs(index, total);
  const jestBin = createRequire(path.join(repoRoot, 'be', 'package.json')).resolve('jest/bin/jest');
  const run = spawnSync(process.execPath, [jestBin, ...shard.args], { cwd: path.join(repoRoot, 'be'), stdio: 'inherit', env: { ...process.env, ...shard.env } });
  return run.status ?? 1;
}

/** `--sonar`: the Sonar and Codecov baselines and the predictions from the merged coverage records; they never pass or fail a run. */
export function runSonarForApp(session: CheckSession, { repoRoot }: { repoRoot: string }): QualityFamilyResult | null {
  const read = (file: string): string | undefined => { try { return fs.readFileSync(path.join(repoRoot, file), 'utf8'); } catch { return undefined; } };
  const properties = read('sonar-project.properties');
  const codecov = read('codecov.yml');
  if (properties === undefined || codecov === undefined) return null;
  const gateYaml = fs.readFileSync(path.join(skillRoot, 'knowledge', 'sonar-gate.yaml'), 'utf8');
  const git = gitRunner(repoRoot);
  const base = ['origin/main', 'main'].map((ref) => git(['merge-base', 'HEAD', ref])?.trim()).find((sha) => sha !== undefined && sha !== '') ?? git(['rev-parse', 'HEAD'])?.trim() ?? 'none';
  const diff = git(['diff', '-U0', '--no-color', base]) ?? '';
  const baseRecords = recordsAtCommit(base, git);
  return runQualityFamily({
    session, sources: { baseCommit: base, sonarGateYaml: gateYaml, sonarProperties: properties, codecovYaml: codecov },
    changed: changedLinesFromDiff(diff), clones: [], baseCoverage: baseRecords.length > 0 ? lineCoverageOf(baseRecords) : undefined,
  });
}

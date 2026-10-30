// cli.mjs - `starci app coverage merge --out <lcov> <report-or-dir>...`: the coverage of the sharded unit run (one coverage-final.json per
// `STARCI_COVERAGE_SHARD=1 npm test -- --shard=i/N`, downloaded into a directory by the coverage job of the managed CI) merged into the one lcov the
// coverage proof, the Codecov upload and the Sonar import read. The merge is the app's installed @starci/jest-preset (`@starci/jest-preset/merge`):
// istanbul-lib-coverage merges the shard maps by source location, and the preset's own lcov reporter writes the result exactly as an unsharded run
// would. A path is a coverage-final.json or a directory searched for every one below it; no report found refuses (exit 2), never an empty report.
// `--records <dir>` merges instead the committed per-spec records of the check cache (`.starcistacks/cache/test-coverage`): the union of what every spec covers,
// which is the total of a full unit run, written as the same lcov.
// `starci app coverage verify <lcov>`: the coverage proof alone (scripts/hfs/coverage-from.mjs, the judgement `starci app check --coverage-from`
// adds to the whole check): every measured logic file is in the merged lcov at 100 per file. The managed CI's coverage job runs it after the merge,
// so the job re-runs none of the rules the fast and lint jobs already judged. Exit 0 proved, 1 refused (the report lists every finding), 2 bad usage.
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { coverageFrom, formatCoverageReport } from '../runtime/scripts/hfs/coverage-from.mjs';
import { parseRecords } from '../cache/jsonl.mjs';
import { SPEC_STEP, installedSpecMerge, sourcesOf } from '../cache/test-family.mjs';
import type { MergeSpecRecords } from '../cache/test-family.mjs';

/** The preset's merge: shard coverage maps in, one lcov out. */
type MergeCoverage = (args: { inputs: string[]; outDir: string }) => { reports: number; files: number };
/** The coverage proof (runtime/scripts/hfs/coverage-from.mjs). */
type Prove = (args: { repoRoot: string; coverageFrom: string }) => { ok: boolean };

export const USAGE = 'usage: starci app coverage merge --out <lcov> (<coverage-final.json-or-dir>... | --records <test-coverage-dir>) [--cwd <dir>] | starci app coverage verify <lcov> [--cwd <dir>]';

/** The parsed arguments of `starci app coverage`. */
interface CoverageOptions { action: 'merge' | 'verify'; inputs: string[]; out?: string; cwd?: string; records?: string }

function parse(argv: readonly string[]): CoverageOptions {
  const [action, ...rest] = argv;
  if (action !== 'merge' && action !== 'verify') throw new Error(USAGE);
  const opts: CoverageOptions = { action, inputs: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === '--out' || arg === '--cwd' || arg === '--records') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value; ${USAGE}`);
      opts[arg.slice(2) as 'out' | 'cwd'] = value;
      index += 1;
    } else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}; ${USAGE}`);
    else opts.inputs.push(arg);
  }
  if (action === 'verify') {
    if (opts.out !== undefined || opts.records !== undefined || opts.inputs.length !== 1) throw new Error(USAGE);
    return opts;
  }
  if (!opts.out || (opts.records === undefined) === (opts.inputs.length === 0)) throw new Error(USAGE);
  if (path.basename(opts.out) !== 'lcov.info') throw new Error(`--out names the lcov.info the coverage proof reads; ${USAGE}`);
  return opts;
}

/** The app's installed preset merge (resolved from the app root, like the presets `starci app sync` loads). */
function installedMerge(cwd: string): MergeCoverage {
  try { return createRequire(path.join(cwd, 'package.json'))('@starci/jest-preset/merge').mergeCoverage as MergeCoverage; } catch (error) {
    throw new Error(`@starci/jest-preset/merge is not installed under ${cwd} (${(error as { code?: string; message: string }).code ?? (error as Error).message}); install the canon @starci/jest-preset`);
  }
}

/** Every `*.jsonl` file below `dir`, sorted: the area files of the check cache's `test-coverage` folder. */
function recordFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * The committed per-spec coverage records of `dir` (`.starcistacks/cache/test-coverage`) merged into the lcov at `out`: the union of what every spec covers, the total
 * a full unit run reports. The lcov lists sources relative to the folder that holds `coverage/` (the side), the records carry them relative to the app.
 */
function mergeRecords(cwd: string, dir: string, out: string, merge: MergeSpecRecords): { specs: number } {
  const absolute = path.resolve(cwd, dir);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw new Error(`no ${dir} folder: the check cache holds no unit coverage yet (run starci app check --test)`);
  const records = recordFilesUnder(absolute).flatMap((file) => parseRecords(fs.readFileSync(file, 'utf8')).records).filter((record) => record.step === SPEC_STEP);
  if (records.length === 0) throw new Error(`no unit-spec record under ${dir}: the check cache holds no unit coverage yet (run starci app check --test)`);
  const outDir = path.dirname(path.resolve(cwd, out));
  merge(records.map(sourcesOf), { outDir, reportRoot: path.dirname(outDir), recordRoot: cwd });
  return { specs: records.length };
}

/** The coverage proof of the app at `cwd` over the lcov `report`: exit 0 proved, 1 refused, 2 when the proof cannot run. */
function verifyCoverage(cwd: string, report: string, { stdout, stderr, prove }: { stdout: (text: string) => unknown; stderr: (text: string) => unknown; prove: Prove }): number {
  try {
    const result = prove({ repoRoot: cwd, coverageFrom: report });
    stdout(formatCoverageReport(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    stderr(`starci app coverage verify: ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}\n`);
    return 2;
  }
}

/**
 * Exit 0 merged or proved, 1 a refused proof, 2 bad usage, no preset or no report found. `merge` replaces the installed preset merge and
 * `prove` the coverage proof in a spec.
 */
export async function coverageMain(argv: string[], { cwd: baseCwd = process.cwd(), stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), merge, mergeSpecs, prove = coverageFrom as Prove }: {
  cwd?: string; stdout?: (text: string) => unknown; stderr?: (text: string) => unknown; merge?: MergeCoverage; mergeSpecs?: MergeSpecRecords; prove?: Prove;
} = {}): Promise<number> {
  let opts: CoverageOptions;
  try { opts = parse(argv); } catch (error) { stderr(`starci app coverage: ${(error as Error).message}\n`); return 2; }
  const cwd = path.resolve(baseCwd, opts.cwd ?? '.');
  if (opts.action === 'verify') return verifyCoverage(cwd, opts.inputs[0] as string, { stdout, stderr, prove });
  if (opts.records !== undefined) {
    try {
      const result = mergeRecords(cwd, opts.records, opts.out as string, mergeSpecs ?? installedSpecMerge(cwd));
      stdout(`starci app coverage merge: ${result.specs} spec record(s) -> ${path.relative(cwd, path.resolve(cwd, opts.out as string)).replaceAll('\\', '/')}\n`);
      return 0;
    } catch (error) {
      stderr(`starci app coverage: ${(error as Error).message}
`);
      return 2;
    }
  }
  try {
    const run = merge ?? installedMerge(cwd);
    const outDir = path.dirname(path.resolve(cwd, opts.out as string));
    const result = run({ inputs: opts.inputs.map((input) => path.resolve(cwd, input)), outDir });
    stdout(`starci app coverage merge: ${result.reports} shard report(s), ${result.files} source file(s) -> ${path.relative(cwd, path.join(outDir, 'lcov.info')).replaceAll('\\', '/')}\n`);
    return 0;
  } catch (error) {
    stderr(`starci app coverage: ${(error as Error).message}\n`);
    return 2;
  }
}

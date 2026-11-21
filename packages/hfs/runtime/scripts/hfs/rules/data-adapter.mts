// data-adapter.mts - R434: a seed-standard that keeps its authored material in raw/ and an adapter/ is, byte for byte, what the adapter writes
// from raw/ (contexts/project/stacks.md PROJECT-STACKS-13, "A standard may carry raw/ and an adapter"). One format for every project: the
// committed output stays manifest.json, data/, blobs/ and index/; raw/ is what people author, adapter/ converts it through the git driver of
// @starci/seed (renderStandard, runStandardAdapter). Judged in the copy repository's commit hook and CI (`starci app check --staged`,
// sync/hygiene.mts) over what the index holds, and by the bring-up's seed step over a pinned commit (stack/standard-gate.mts):
//   HFS_DATA_ADAPTER_DRIFT  the one code of R434; its message names which of these it is:
//     - the adapter did not run, two runs over the same raw/ differ (a non-deterministic adapter), or its output and
//       the committed manifest.json, data/, blobs/ or index/ differ: a hand edit of data/ in an adapter repository,
//       or a raw/ change committed without re-running the adapter;
//     - an adapter repository lacks what runs the drift check: its entry adapter/main.ts and adapter/package.json,
//       the commit hook .githooks/pre-commit and the CI workflow .github/workflows/seed-standard.yml, each of the
//       last two running `starci app check --staged` (`starci data standard init` writes all four).
// The sealing, size and manifest judgements of R400 (data-copies.mts) cover raw/ too. Findings name files, never a value.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { found } from './read.mjs';
import type { Finding } from './rule-types.mjs';

/** The folder of an adapter repository's converter, and its entry, run as `node adapter/main.ts --raw <dir> --out <dir>`. */
export const ADAPTER_DIR = 'adapter/';
export const ADAPTER_ENTRY = 'adapter/main.ts';
export const ADAPTER_PACKAGE = 'adapter/package.json';
/** What people author in an adapter repository: plain, never sealed, never written by the adapter. */
export const RAW_DIR = 'raw/';
/** The commit hook and the CI workflow of a standard, and the guard each runs. */
export const STANDARD_HOOK = '.githooks/pre-commit';
export const STANDARD_WORKFLOW = '.github/workflows/seed-standard.yml';
export const STANDARD_GUARD = 'starci app check --staged';
/** What an adapter run writes, and all the drift check compares: the standard layout, unchanged. */
export const ADAPTER_OUTPUTS: readonly string[] = ['manifest.json', 'data/', 'blobs/', 'index/'];
/** How long one adapter run may take before it counts as not run. */
export const ADAPTER_TIMEOUT_MS = 5 * 60 * 1000;

/** True for a file the adapter writes (the four outputs). */
export const isAdapterOutput = (file: string): boolean => ADAPTER_OUTPUTS.some((output) => (output.endsWith('/') ? file.startsWith(output) : file === output));

/** True when the tracked tree holds an adapter/: the repository's standard is the adapter's output. */
export const isAdapterRepository = (files: readonly string[]): boolean => files.some((file) => file.startsWith(ADAPTER_DIR));

/** The git blob id of `bytes` (sha1 of `blob <size>\0<bytes>`): what `git ls-files -s` lists, so a rendered file compares to the index without a read. */
export const blobId = (bytes: Buffer): string => crypto.createHash('sha1').update(`blob ${String(bytes.length)}\0`).update(bytes).digest('hex');

/** One adapter run: every output file it wrote with its blob id, or why it did not run. */
export type Rendered = { ok: true; files: ReadonlyMap<string, string> } | { ok: false; reason: string };

const unguarded = (file: string, message: string): Finding => found('HFS_DATA_ADAPTER_DRIFT', file, `${message}; \`starci data standard init --adapter\` writes it (PROJECT-STACKS-13)`);

/** HFS_DATA_ADAPTER_DRIFT: the entry, the package, the hook and the workflow an adapter repository cannot be without. `read` answers a tracked file's text (null: absent). */
export function adapterGuardFindings({ files, read }: { files: readonly string[]; read: (file: string) => string | null }): Finding[] {
  if (!isAdapterRepository(files)) return [];
  const tracked = new Set(files);
  const findings: Finding[] = [];
  if (!tracked.has(ADAPTER_ENTRY)) findings.push(unguarded(ADAPTER_ENTRY, `${ADAPTER_ENTRY} is not tracked: the drift check runs it as \`node ${ADAPTER_ENTRY} --raw <dir> --out <dir>\``));
  if (!tracked.has(ADAPTER_PACKAGE)) findings.push(unguarded(ADAPTER_PACKAGE, `${ADAPTER_PACKAGE} is not tracked: it pins @starci/seed, whose git driver writes the standard`));
  for (const [file, what] of [[STANDARD_HOOK, 'the commit hook'], [STANDARD_WORKFLOW, 'the CI workflow']] as const) {
    const text = tracked.has(file) ? read(file) : null;
    if (text === null) findings.push(unguarded(file, `${file}, ${what} of an adapter repository, is not tracked: nothing would re-run the adapter before a commit lands`));
    else if (!text.includes(STANDARD_GUARD)) findings.push(unguarded(file, `${file}, ${what}, does not run \`${STANDARD_GUARD}\`, the guard that re-runs the adapter`));
  }
  return findings;
}

const drift = (file: string, message: string): Finding => found('HFS_DATA_ADAPTER_DRIFT', file, `${message} (R434, PROJECT-STACKS-13)`);

/**
 * HFS_DATA_ADAPTER_DRIFT from two runs of the adapter over the same raw/ and the committed outputs (`committed`: output file -> blob id).
 * A run that failed names its reason; two runs that differ name the first file they differ in (the adapter is not deterministic); else every
 * output file whose committed bytes are not what the adapter writes, is not written by it, or is written but not committed.
 */
export function adapterDriftFindings({ committed, first, second }: { committed: ReadonlyMap<string, string>; first: Rendered; second: Rendered }): Finding[] {
  for (const run of [first, second]) if (!run.ok) return [drift(ADAPTER_ENTRY, `the adapter did not run over raw/: ${run.reason}`)];
  const one = (first as { files: ReadonlyMap<string, string> }).files;
  const two = (second as { files: ReadonlyMap<string, string> }).files;
  const differs = [...new Set([...one.keys(), ...two.keys()])].sort().find((file) => one.get(file) !== two.get(file));
  if (differs !== undefined) return [drift(differs, `two runs of the adapter over the same raw/ wrote different ${differs}: the adapter is not deterministic (a clock, a random id or a file-system order reaches its output); fix ${ADAPTER_DIR}`)];
  const findings: Finding[] = [];
  for (const [file, id] of [...committed].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!one.has(file)) findings.push(drift(file, `${file} is committed but the adapter does not write it from raw/: an adapter repository's ${file.split('/')[0]} is the adapter's output, never edited by hand; remove it or change raw/ and re-run \`node ${ADAPTER_ENTRY}\``));
    else if (one.get(file) !== id) findings.push(drift(file, `${file} differs from what the adapter writes from raw/: an adapter repository's ${file.split('/')[0]} is never edited by hand; change raw/ (or ${ADAPTER_DIR}) and re-run \`node ${ADAPTER_ENTRY}\``));
  }
  for (const file of [...one.keys()].sort()) if (!committed.has(file)) findings.push(drift(file, `the adapter writes ${file} from raw/ but it is not committed: re-run \`node ${ADAPTER_ENTRY}\` and stage its output`));
  return findings;
}

/** Every output file under `dir` with its blob id; only the four outputs are walked, never raw/, adapter/ or .git. */
function outputsOf(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else files.set(child, blobId(fs.readFileSync(path.join(dir, child))));
    }
  };
  for (const output of ADAPTER_OUTPUTS) {
    const name = output.replace(/\/$/u, '');
    if (!fs.existsSync(path.join(dir, name))) continue;
    if (output.endsWith('/')) walk(name);
    else files.set(name, blobId(fs.readFileSync(path.join(dir, name))));
  }
  return files;
}

/** How one program runs: spawnSync's shape, so a spec can stand in for node. */
export type AdapterSpawn = (program: string, args: readonly string[], options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }) => { status: number | null; stderr?: Buffer | string | null; error?: Error | undefined };

const defaultSpawn: AdapterSpawn = (program, args, options) => spawnSync(program, [...args], { ...options, encoding: 'utf8', windowsHide: true });

/**
 * The environment of every child the guard and the bring-up gate spawn (the adapter, and git or npm in a scratch checkout): the caller's, minus
 * every `GIT_*` variable. A commit hook runs with GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and their kin set; inherited, they point the git the
 * adapter's renderStandard runs in its scratch copy at the user's repository, which then gains a commit and a rewritten index.
 */
export const withoutGitEnvironment = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/iu.test(key)));

/** The node flags that let `node` run a .ts entry: none where type stripping is on (Node 23.6 and later), `--experimental-strip-types` before. */
export const stripTypesFlags = (features: { typescript?: unknown } = process.features as { typescript?: unknown }): string[] => (features.typescript ? [] : ['--experimental-strip-types']);

/** Runs the adapter of the repository at `root` once over `rawDir` into the empty `outDir` and answers what it wrote. */
export function renderAdapter(root: string, rawDir: string, outDir: string, spawn: AdapterSpawn = defaultSpawn): Rendered {
  if (!fs.existsSync(path.join(root, ADAPTER_ENTRY))) return { ok: false, reason: `${ADAPTER_ENTRY} is missing` };
  fs.mkdirSync(outDir, { recursive: true });
  const run = spawn(process.execPath, [...stripTypesFlags(), path.join(root, ADAPTER_ENTRY), '--raw', rawDir, '--out', outDir], { cwd: root, timeout: ADAPTER_TIMEOUT_MS, env: withoutGitEnvironment() });
  if (run.error !== undefined || run.status !== 0) {
    const stderr = String(run.stderr ?? '');
    const last = stderr.trim().split('\n').filter((line) => line.startsWith('the adapter failed') || /Error/u.test(line)).at(-1);
    const hint = stderr.includes('ERR_MODULE_NOT_FOUND') ? `; install its dependencies first: \`npm ci --prefix ${ADAPTER_DIR.replace(/\/$/u, '')}\`` : '';
    return { ok: false, reason: `node ${ADAPTER_ENTRY} ${run.error === undefined ? `exited ${String(run.status)}` : 'could not run'}${last === undefined ? '' : `: ${last.trim().slice(0, 300)}`}${hint}` };
  }
  return { ok: true, files: outputsOf(outDir) };
}

/**
 * The drift of the adapter repository at `root` (its adapter/ with node_modules installed) over `rawDir`: two runs into fresh folders under
 * `scratch`, compared with each other and with `committed` (output file -> blob id). The scratch folders are removed.
 */
export function adapterDriftOf({ root, rawDir, committed, scratch, spawn = defaultSpawn }: { root: string; rawDir: string; committed: ReadonlyMap<string, string>; scratch: string; spawn?: AdapterSpawn }): Finding[] {
  const outs = [path.join(scratch, 'first'), path.join(scratch, 'second')];
  try {
    const [first, second] = outs.map((out) => renderAdapter(root, rawDir, out, spawn)) as [Rendered, Rendered];
    return adapterDriftFindings({ committed, first, second });
  } finally {
    for (const out of outs) fs.rmSync(out, { recursive: true, force: true });
  }
}

/** The output files of a checkout on disk (a pinned commit's), each with its blob id: what the bring-up compares the adapter's output with. */
export const committedOnDisk = (root: string): Map<string, string> => outputsOf(root);

// app-extension-findings.mts - the one way a project extends the harness's law (PROJECT-LINT-3): its `ext/` folder, judged by `starci app check`
// at the app root on every run:
//   R381 HFS_EXT_INVALID, HFS_EXT_API_MISMATCH   the extension manifest (scripts/lib/project-ext.mts): a refused extension, a rule that throws or
//                                                answers no path; and the findings of every sound hfs rule and command check, under the rule's own
//                                                code and severity
//   R382 HFS_PACKAGE_SLOT_*                      the slots the manifest declares for a root workspace package (scripts/hfs/package-slots.mts)
// An extension only adds: its codes never reuse a code of modules/kernel/failure-codes.yaml, so no finding of it stands in for, or hides, a harness one.
import { spawnSync } from 'node:child_process';
import { rootPackageFoldersOf } from '../coverage-scope.mjs';
import { PACKAGE_SLOTS_FILE, PACKAGE_SLOTS_INVALID, PACKAGE_SLOTS_MOVED, judgePackageSlots, packageSlotProblems, readPackageSlots } from '../package-slots.mjs';
import { PROJECT_EXT_MANIFEST, hasProjectExt, loadProjectExt, projectExtFindings, reservedCodes } from '../../lib/project-ext.mjs';
import type { CommandResult } from '../../lib/project-ext.mjs';
import { found, readText } from './read.mjs';
import type { Repo } from './rule-types.mjs';

export { reservedCodes };

type Context = { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; isRoot: boolean; inScope?: (file: string) => boolean; run?: (command: readonly string[]) => CommandResult };

/** The budget of one command check: a generator's `--check` is a comparison, never a build. */
const COMMAND_TIMEOUT_MS = 300_000;

/** Runs a command check from the app root without a shell: `node` is this process's own binary, so no shim and no PATH lookup decides what runs. */
const runCommand = (repoRoot: string) => (command: readonly string[]): CommandResult => {
  const result = spawnSync(process.execPath, command.slice(1), { cwd: repoRoot, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 });
  return { status: result.error === undefined ? result.status : null, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error === undefined ? '' : `\n${result.error.message}`}` };
};

/** R381: the findings of the project's extension (its hfs rules and command checks) and every problem of the extension itself. */
export function projectExtCheckFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true, run = runCommand(repoRoot) }: Context) {
  if (repo?.kind !== 'app' || isRoot === false || !hasProjectExt(repoRoot)) return [];
  const tracked = [...new Set(all)];
  return projectExtFindings({ repoRoot, files: tracked, reserved: reservedCodes(), read: (file) => readText(repoRoot, file), run })
    .filter((finding) => finding.always === true || inScope(finding.path))
    .map((finding) => ({ ...found(finding.code, finding.path, finding.message, { ...(finding.line === undefined ? {} : { line: finding.line }), ...(finding.column === undefined ? {} : { column: finding.column }) }), level: finding.level }));
}

/**
 * R382: every root package the project's manifest declares slots for, judged against them. A package the manifest does not declare and that still
 * carries its own slots.yaml is judged against that file, with a warning that the declaration moves into the manifest.
 */
export function packageSlotFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true }: Context) {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const tracked = [...new Set(all)];
  const folders = rootPackageFoldersOf(tracked);
  const ext = loadProjectExt(repoRoot);
  const declared = ext.problems.length > 0 ? {} : ext.packages;
  const out = Object.keys(declared).filter((folder) => !folders.includes(folder))
    .map((folder) => found(PACKAGE_SLOTS_INVALID, PROJECT_EXT_MANIFEST, `${PROJECT_EXT_MANIFEST} packages names ${folder}, which is no root package of this app (a folder of packages/ with a package.json and a src/) (R382, PROJECT-LINT-3)`));
  for (const folder of folders) {
    const own = tracked.filter((file) => file.startsWith(`${folder}/`)).map((file) => file.slice(folder.length + 1));
    const legacy = `${folder}/${PACKAGE_SLOTS_FILE}`;
    const inManifest = Object.hasOwn(declared, folder);
    if (tracked.includes(legacy)) {
      const moved = inManifest
        ? found(PACKAGE_SLOTS_INVALID, legacy, `${legacy} and ${PROJECT_EXT_MANIFEST} both declare the slots of ${folder}; the manifest holds them, delete ${legacy} (R382)`)
        : { ...found(PACKAGE_SLOTS_MOVED, legacy, `${legacy} is read for this minor only: declare the slots of ${folder} in ${PROJECT_EXT_MANIFEST} under packages["${folder}"] and delete the file (R382, PROJECT-LINT-3)`), level: 'warning' };
      if (inScope(legacy)) out.push(moved);
    }
    const manifest = inManifest ? judgePackageSlots(declared[folder]) : tracked.includes(legacy) ? readPackageSlots(readText(repoRoot, legacy) ?? '') : null;
    if (manifest === null) continue;
    const at = inManifest ? `${PROJECT_EXT_MANIFEST} packages["${folder}"]` : legacy;
    const anchor = inManifest ? PROJECT_EXT_MANIFEST : legacy;
    out.push(...packageSlotProblems(folder, manifest, own, at).map((problem) => (problem.code === PACKAGE_SLOTS_INVALID ? { ...problem, path: anchor } : problem)).filter((problem) => problem.code === PACKAGE_SLOTS_INVALID || inScope(problem.path)).map((problem) => found(problem.code, problem.path, problem.message)));
  }
  return out;
}

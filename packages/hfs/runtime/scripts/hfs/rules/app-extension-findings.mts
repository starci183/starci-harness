// app-extension-findings.mts - the two ways an app extends the harness's law (PROJECT-LINT-3), judged by `starci app check` at the app root:
//   R381 HFS_RULE_PACK_INVALID   the rule packs hfs.json `rulePacks` names (scripts/lib/rule-packs.mts): a refused pack, a rule that throws or answers
//                                no path; and the findings of every sound machine rule of a pack, under the pack rule's own code and severity
//   R382 HFS_PACKAGE_SLOT_*      the slot manifest a root workspace package declares for its own tree (scripts/hfs/package-slots.mts)
// A pack only adds: its codes never reuse a code of modules/kernel/failure-codes.yaml, so no pack finding stands in for, or hides, a harness one.
import { rootPackageFoldersOf } from '../coverage-scope.mjs';
import { PACKAGE_SLOTS_FILE, packageSlotProblems, readPackageSlots } from '../package-slots.mjs';
import { RULE_PACK_INVALID, declaredRulePacks, reservedCodes, rulePackFindings } from '../../lib/rule-packs.mjs';
import { found, readText } from './read.mjs';
import type { Repo } from './rule-types.mjs';

export { reservedCodes };

type Context = { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; isRoot: boolean; inScope?: (file: string) => boolean };

/** R381: the findings of the app's rule packs (their machine rules) and every problem of a pack. */
export function rulePackCheckFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true }: Context) {
  if (repo?.kind !== 'app' || isRoot === false || declaredRulePacks(repoRoot).length === 0) return [];
  const tracked = [...new Set(all)];
  return rulePackFindings({ repoRoot, files: tracked, reserved: reservedCodes(), read: (file) => readText(repoRoot, file) })
    .filter((finding) => finding.code === RULE_PACK_INVALID || inScope(finding.path))
    .map((finding) => ({ ...found(finding.code, finding.path, finding.message, { ...(finding.line === undefined ? {} : { line: finding.line }), ...(finding.column === undefined ? {} : { column: finding.column }) }), level: finding.level }));
}

/** R382: every root package that declares packages/<name>/slots.yaml, judged against it. */
export function packageSlotFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true }: Context) {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const tracked = [...new Set(all)];
  return rootPackageFoldersOf(tracked).flatMap((folder) => {
    const manifest = `${folder}/${PACKAGE_SLOTS_FILE}`;
    if (!tracked.includes(manifest)) return [];
    const text = readText(repoRoot, manifest) ?? '';
    const own = tracked.filter((file) => file.startsWith(`${folder}/`)).map((file) => file.slice(folder.length + 1));
    return packageSlotProblems(folder, readPackageSlots(text), own).filter((problem) => inScope(problem.path)).map((problem) => found(problem.code, problem.path, problem.message));
  });
}

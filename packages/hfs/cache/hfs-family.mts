// hfs-family.mts - the families that read the structure of the app: `--hfs` (slots, tree, pins, managed files against their templates, the content
// rules of the app pass, the architecture machine's check surface, the contract emit) and `--secrets` (plaintext secrets, sealed custody, untracked
// secret files, which the same pass finds). The cheap rules always run: they read untracked entries and git state the index does not hold. The
// costly whole-program parts are scoped steps keyed on the side: the architecture machine per side, the contract emit on the back-end side.
import path from 'node:path';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { checkRepo, checkRepository, trackedFiles, type CheckFinding, type MachineFn, type MachineReport, type RepositoryResult } from '../runtime/scripts/hfs/check.mjs';
import { checkArchitecture } from '../runtime/scripts/hfs/architecture/index.mjs';
import { withoutBootProof } from '../runtime/scripts/hfs/rules/boot-proof.mjs';
import { withUnusedSymbolMemo, type UnusedSymbolMemo } from '../runtime/scripts/hfs/rules/unused-symbol.mjs';
import { contractEmitFindingsAsync } from '../runtime/scripts/hfs/rules/contract.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { emitContractsAsync } from '../emit/contracts.mjs';
import { summarize } from '../runtime/scripts/hfs/check-results.mjs';
import { managedFindings } from '../sync/managed.mjs';
import type { Presets } from '../sync/index.mjs';
import { withRuleMemo } from '../runtime/scripts/hfs/rule-memo.mjs';
import { RecordSet, hostData, portableData, scopedStep } from './records.mjs';
import { FILE_RULES_STEP, RULE_STEP_PREFIX, UNIT_STEP_PREFIX, createStructureMemo } from './structure-memo.mjs';
import { makeReport } from './report.mjs';
import { SECRETS_FOLDER, SECRET_CODES, safeSecretFinding, safeSecretRecords } from './secret-records.mjs';
import { sideKey } from './side-key.mjs';
import type { CacheRecord, CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

export const HFS_FOLDER = 'check/hfs';
export { SECRETS_FOLDER, SECRET_CODES };

/** What the structure pass answers. */
export interface PassResult {
  /** The whole-app check result of the pass (the shape `printCheck` reads), or the slot result when only secrets were asked for. */
  readonly result: RepositoryResult;
  readonly contracts: { status: string; reason?: string; apps?: unknown[] } | null;
  readonly machineReused: Record<string, boolean>;
  readonly report: FamilyReport | null;
  readonly secretsReport: FamilyReport | null;
}

export interface PassInput {
  readonly repoRoot: string;
  readonly execute?: HeavyNodeRun | undefined;
  readonly harness?: { version?: string } | undefined;
  readonly presets?: Presets | undefined;
  readonly tracked?: readonly string[] | undefined;
  /** Which families the run selected: the pass runs whole for hfs, light (slots and rules, no machine) for secrets alone. */
  readonly hfs: boolean;
  readonly secrets: boolean;
  /** A seam for specs. */
  readonly machine?: MachineFn | undefined;
}

const compact = (finding: CheckFinding): Finding => ({
  path: finding.path ?? '.', line: finding.line ?? 0, column: finding.column ?? 0, rule: finding.code, message: String(finding.message ?? ''),
});

/** The findings of a pass as records grouped by path, one per path, sparse. */
function findingRecords(findings: readonly CheckFinding[], hashOf: (path: string) => string | undefined, step: string): CacheRecord[] {
  const byPath = new Map<string, Finding[]>();
  for (const finding of findings) byPath.set(finding.path ?? '.', [...(byPath.get(finding.path ?? '.') ?? []), compact(finding)]);
  return [...byPath].map(([file, list]) => ({ path: file, step, hash: hashOf(file) ?? 'absent', findings: list }));
}

const beDeclaration = (repoRoot: string): unknown => {
  try { return readRepoDeclaration(loadSlotManifest(), repoRoot).sides?.be ?? null; } catch { return null; }
};

/** The structure pass of `starci app check`, with the architecture machine and the contract emit reused by side key. */
export async function runStructurePass(session: CheckSession, input: PassInput): Promise<PassResult> {
  const { repoRoot, harness, presets } = input;
  const tracked = [...(input.tracked ?? trackedFiles(repoRoot))];
  const decision = session.decide(input.hfs ? 'hfs' : 'secrets');
  const records = new RecordSet(session.records(HFS_FOLDER));
  const previous = records.toArray();
  const reuse = decision.mode === 'diff';
  // The per-file and cross-file content rules are shared by both families: a record is read only when every selected family runs diff.
  const structure = createStructureMemo({ session, records, reuse: reuse && (!input.hfs || !input.secrets || session.decide('secrets').mode === 'diff'), root: repoRoot, tracked });
  const sideOf = (side: string) => sideKey(repoRoot, session.index, side);
  const keys = new Map(['be', 'fe'].map((side) => [side, sideOf(side)] as const));
  const extra: CheckFinding[] = [...await managedFindings({ repoRoot, tracked, presets })] as CheckFinding[];
  let checked = 0;
  let reused = 0;
  let contracts: PassResult['contracts'] = null;
  const be = beDeclaration(repoRoot);
  if (input.hfs && be !== null) {
    const bePrefix = 'be/';
    const key = keys.get('be');
    const emit = await scopedStep(session, records, {
      path: 'be', step: 'contract-emit', key: key?.key ?? 'none', reuse, inputs: key?.inputs ?? [], captured: key?.hashes ?? {},
      compute: async () => {
        const files = tracked.filter((file) => file.startsWith(bePrefix)).map((file) => file.slice(bePrefix.length));
        const emitted = await contractEmitFindingsAsync({ repoRoot: path.join(repoRoot, 'be'), files, repo: be as never, emit: (request: Parameters<typeof emitContractsAsync>[0]) => emitContractsAsync({ ...request, execute: input.execute }) });
        return JSON.parse(JSON.stringify({ findings: emitted.findings, apps: emitted.apps })) as JsonValue;
      },
      compact: (value) => ((value as { findings: CheckFinding[] }).findings).map(compact),
    });
    if (emit.reused) reused += 1; else checked += 1;
    const value = emit.value as { findings: CheckFinding[]; apps: unknown[] };
    extra.push(...value.findings.map((finding) => ({ ...finding, side: 'be', path: `be/${finding.path}` })));
    contracts = { status: 'checked', apps: value.apps };
  }
  const reasons: Record<string, boolean> = {};
  const baseMachine: MachineFn = input.machine ?? checkArchitecture;
  const cachedMachine: MachineFn = (call) => {
    const side = path.basename(call.repositoryRoot);
    const key = keys.get(side);
    if (key === undefined || call.fast === true || call.paths !== undefined) return baseMachine(call);
    const held = reuse ? records.matching(side, 'machine', key.key) : undefined;
    if (held?.data !== undefined) { reasons[side] = true; reused += 1; return hostData(held.data, session.root, path.sep) as unknown as MachineReport; }
    const report = baseMachine(call);
    checked += 1;
    if (session.unchanged(key.inputs, key.hashes)) {
      records.put({ path: side, step: 'machine', hash: key.key, findings: [...report.violations, ...report.errors].map((item) => ({ path: item.path ?? side, line: item.line ?? 0, column: item.column ?? 0, rule: item.ruleId, message: item.message })), data: portableData(JSON.parse(JSON.stringify(report)) as JsonValue, session.root) });
    }
    return report;
  };
  // The whole-program unused-symbol analysis is the costliest rule of the pass (92 of 141 seconds on a 13.7k-file app): a scoped step keyed on the side.
  const unusedMemo: UnusedSymbolMemo = {
    run: (root, compute) => {
      const side = path.basename(root);
      const key = keys.get(side);
      if (key === undefined) return compute();
      const held = reuse ? records.matching(side, 'unused-symbol', key.key) : undefined;
      if (held?.data !== undefined) { reused += 1; return hostData(held.data, session.root, path.sep) as unknown as ReturnType<typeof compute>; }
      const found = compute();
      checked += 1;
      if (session.unchanged(key.inputs, key.hashes)) {
        const list = found as unknown as CheckFinding[];
        records.put({ path: side, step: 'unused-symbol', hash: key.key, findings: list.map(compact), data: portableData(JSON.parse(JSON.stringify(found)) as JsonValue, session.root) });
      }
      return found;
    },
  };
  const step = session.progress.step('hfs', 'structure', tracked.length);
  const result = withRuleMemo(structure.memo, () => (input.hfs
    ? withUnusedSymbolMemo(unusedMemo, () => withoutBootProof(() => checkRepository({ repoRoot, harness, extraFindings: extra, machine: cachedMachine })))
    : (() => {
      const slot = withUnusedSymbolMemo(unusedMemo, () => withoutBootProof(() => checkRepo({ repoRoot, harness, extraFindings: [], surface: 'check' })));
      return { ...slot, machine: { status: 'skipped', reason: '--secrets alone runs the rules, not the machine' } } as RepositoryResult;
    })()));
  const filesChecked = structure.counts.filesChecked, filesReused = structure.counts.filesReused;
  const keyedChecked = structure.counts.keyedChecked + structure.counts.unitsChecked, keyedReused = structure.counts.keyedReused + structure.counts.unitsReused;
  step.tick(tracked.length, reused + filesReused + keyedReused, checked + filesChecked + keyedChecked);
  step.end();
  if (contracts) result.contracts = contracts;
  if (!input.hfs) {
    result.findings = result.findings.filter((finding) => SECRET_CODES.has(finding.code));
    result.counts = summarize(result.findings);
    result.ok = result.counts.error === 0;
  }
  records.retain(FILE_RULES_STEP, structure.files);
  records.retainPrefix(RULE_STEP_PREFIX, new Set(['.', 'be', 'fe']));
  for (const [step, paths] of structure.units) records.retain(step, paths);
  records.dropPrefixExcept(UNIT_STEP_PREFIX, new Set(structure.units.keys()));
  if (!input.hfs) session.replace(HFS_FOLDER, records.toArray());
  if (input.hfs) {
    const live = new Set(['be', 'fe']);
    records.retain('machine', live);
    records.retain('unused-symbol', live);
    records.retain('contract-emit', new Set(['be']));
    // The always-run rules still record their findings, so the next run can say what is new and what is known.
    for (const record of findingRecords(result.findings.filter((finding) => !SECRET_CODES.has(finding.code)), session.index.hashOf.bind(session.index), 'hfs')) records.put(record);
    const seen = new Set(result.findings.map((finding) => finding.path ?? '.'));
    records.retain('hfs', seen);
    session.replace(HFS_FOLDER, records.toArray());
  }
  const hfsFindings = result.findings.filter((finding) => !SECRET_CODES.has(finding.code));
  const report = input.hfs
    ? makeReport({ family: 'hfs', mode: decision.mode, reason: decision.reason, checked: checked + filesChecked + keyedChecked, reused: reused + filesReused + keyedReused, previous: previous.flatMap((record) => record.step === 'hfs' ? record.findings : []), current: hfsFindings.map(compact) })
    : null;
  if (report) session.report(report);
  let secretsReport: FamilyReport | null = null;
  if (input.secrets) {
    const secretDecision = session.decide('secrets');
    const prior = session.records(SECRETS_FOLDER);
    const secretFindings = result.findings.filter((finding) => SECRET_CODES.has(finding.code));
    session.replace(SECRETS_FOLDER, safeSecretRecords(findingRecords(secretFindings, session.index.hashOf.bind(session.index), 'secrets')));
    secretsReport = makeReport({ family: 'secrets', mode: secretDecision.mode, reason: secretDecision.reason, checked: filesChecked, reused: filesReused, previous: prior.flatMap((record) => record.findings.map(safeSecretFinding)), current: secretFindings.map((finding) => safeSecretFinding(compact(finding))) });
    session.report(secretsReport);
  }
  return { result, contracts, machineReused: reasons, report, secretsReport };
}

// wiring-family.mts - `app check --wiring`: the boot proof of every app, a lite back end's composition with doubles. Scoped: reused when the
// back-end side key is unchanged. A timeout reached no verdict and is never stored.
import fs from 'node:fs';
import path from 'node:path';
import { appWiring, BOOT_PROOF_TIMEOUT, type WiringFinding, type WiringResult } from '../runtime/scripts/hfs/app-wiring.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { RecordSet, scopedStep } from './records.mjs';
import { makeReport } from './report.mjs';
import { sideKey } from './side-key.mjs';
import type { CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

export const WIRING_FOLDER = 'check/wiring';

const compact = (finding: WiringFinding): Finding => ({ path: finding.path, line: 0, column: 0, rule: finding.code, message: finding.message });

export interface WiringFamilyResult {
  readonly wiring: WiringResult;
  readonly report: FamilyReport;
}

/** The boot proof family. `explicit` is the whole-tree proof of `--wiring`; without it a missing install leaves the compile unjudged, as the content finder does. */
export async function runWiringFamily(session: CheckSession, { repoRoot, edition, files, run }: { repoRoot: string; edition?: string | undefined; files?: readonly string[] | undefined; run?: ((repoRoot: string) => WiringResult) | undefined }): Promise<WiringFamilyResult> {
  const decision = session.decide('wiring');
  const records = new RecordSet(session.records(WIRING_FOLDER));
  const key = sideKey(repoRoot, session.index, 'be');
  const prove = (): WiringResult => {
    if (run) return run(repoRoot);
    const declared = readRepoDeclaration(loadSlotManifest(), repoRoot);
    const repo = { ...declared, edition: edition ?? declared.edition };
    const proof = appWiring({ repoRoot, repo: repo as never, files: [...(files ?? trackedFiles(repoRoot))] });
    const installed = fs.existsSync(path.join(repoRoot, 'node_modules')) || fs.existsSync(path.join(repoRoot, 'be', 'node_modules'));
    const findings = proof.findings.filter((finding) => installed || finding.reason !== 'module or proof could not be compiled');
    return { ...proof, findings, ok: findings.length === 0 };
  };
  const step = session.progress.step('wiring', 'boot proof', Math.max(1, key.inputs.length));
  const { value, reused } = await scopedStep(session, records, {
    path: 'be', step: 'boot-proof', key: key.key, reuse: decision.mode === 'diff', inputs: key.inputs,
    compute: () => JSON.parse(JSON.stringify(prove())) as JsonValue,
    compact: (found) => (found as unknown as WiringResult).findings.map(compact),
    store: (found) => !(found as unknown as WiringResult).findings.some((finding) => finding.code === BOOT_PROOF_TIMEOUT),
  });
  step.tick(key.inputs.length, reused ? key.inputs.length : 0, reused ? 0 : key.inputs.length);
  step.end();
  const wiring = value as unknown as WiringResult;
  const previousRecords = session.records(WIRING_FOLDER).flatMap((record) => record.findings);
  session.replace(WIRING_FOLDER, records.toArray());
  const report = makeReport({ family: 'wiring', mode: decision.mode, reason: decision.reason, checked: reused ? 0 : 1, reused: reused ? 1 : 0, previous: previousRecords, current: wiring.findings.map(compact) });
  session.report(report);
  return { wiring, report };
}

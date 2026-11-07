// wiring-family.mts - `app check --wiring`: the boot proof of every app, a lite back end's composition with doubles. Scoped: the record is keyed on the back-end
// side key and on what the proof loaded (its workers' module cache, package-closure.mts): each installed package by its lockfile digest and each app file outside
// the back end by its hash, so a package bump re-runs the proof only when the boot loaded the package. A proof whose workers reported no list (one timed out or did
// not answer) is keyed on everything the app installs and tracks. A timeout reached no verdict and is never stored.
import fs from 'node:fs';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import path from 'node:path';
import { appWiringAsync, BOOT_PROOF_TIMEOUT, type WiringFinding, type WiringResult } from '../runtime/scripts/hfs/app-wiring.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { inCacheDir } from './content-index.mjs';
import { lockEntries } from './fingerprint.mjs';
import { keyWithReads, readsContext, readsJson, readsOfData, readsOfPaths, sessionReadsContext, type ToolReads } from './package-closure.mjs';
import { RecordSet, hostData, portableData } from './records.mjs';
import { makeReport } from './report.mjs';
import { sideKey } from './side-key.mjs';
import type { CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

export const WIRING_FOLDER = 'check/wiring';
const STEP = 'boot-proof';

const compact = (finding: WiringFinding): Finding => ({ path: finding.path, line: 0, column: 0, rule: finding.code, message: finding.message });

export interface WiringFamilyResult {
  readonly wiring: WiringResult;
  readonly report: FamilyReport;
}

/** What a proof read beyond the back-end side: its workers' list, or, when one reported none, every install of the lockfile and every tracked file outside the side. */
function proofReads(session: CheckSession, wiring: WiringResult, side: ReadonlySet<string>): ToolReads {
  if (wiring.loaded !== null) return readsOfPaths(session.root, wiring.loaded, (file) => side.has(file));
  return {
    packages: Object.keys(lockEntries(session.root)).filter((key) => key.includes('node_modules/')).sort(),
    files: session.index.paths.filter((file) => !side.has(file) && !inCacheDir(file)),
  };
}

/** The boot proof family. `explicit` is the whole-tree proof of `--wiring`; without it a missing install leaves the compile unjudged, as the content finder does. */
export async function runWiringFamily(session: CheckSession, { repoRoot, edition, files, run, execute }: { repoRoot: string; edition?: string | undefined; files?: readonly string[] | undefined; run?: ((repoRoot: string) => WiringResult | Promise<WiringResult>) | undefined; execute?: HeavyNodeRun | undefined }): Promise<WiringFamilyResult> {
  const decision = session.decide('wiring');
  const records = new RecordSet(session.records(WIRING_FOLDER));
  const key = sideKey(repoRoot, session.index, 'be');
  const side = new Set(key.inputs);
  const context = sessionReadsContext(session);
  const prove = async (): Promise<WiringResult> => {
    if (run) return run(repoRoot);
    const declared = readRepoDeclaration(loadSlotManifest(), repoRoot);
    const repo = { ...declared, edition: edition ?? declared.edition };
    const proof = await appWiringAsync({ repoRoot, repo: repo as never, files: [...(files ?? trackedFiles(repoRoot))], execute });
    const installed = fs.existsSync(path.join(repoRoot, 'node_modules')) || fs.existsSync(path.join(repoRoot, 'be', 'node_modules'));
    const findings = proof.findings.filter((finding) => installed || finding.reason !== 'module or proof could not be compiled');
    return { ...proof, findings, ok: findings.length === 0 };
  };
  const step = session.progress.step('wiring', 'boot proof', Math.max(1, key.inputs.length));
  const held = records.get('be', STEP);
  const heldReads = held === undefined ? null : readsOfData(held.data);
  const heldResult = held?.data !== null && typeof held?.data === 'object' && !Array.isArray(held.data) ? (held.data as { readonly [name: string]: JsonValue })['result'] : undefined;
  let wiring: WiringResult;
  let reused = false;
  if (decision.mode === 'diff' && held !== undefined && heldReads !== null && heldResult !== undefined && held.hash === keyWithReads(key.key, heldReads, context)) {
    wiring = hostData(heldResult, session.root, path.sep) as unknown as WiringResult;
    reused = true;
  } else {
    wiring = await prove();
    const reads = proofReads(session, wiring, side);
    const unchanged = session.unchanged(key.inputs, key.hashes) && keyWithReads(key.key, reads, readsContext(session.root, () => undefined)) === keyWithReads(key.key, reads, context);
    if (unchanged && !wiring.findings.some((finding) => finding.code === BOOT_PROOF_TIMEOUT)) {
      records.put({ path: 'be', step: STEP, hash: keyWithReads(key.key, reads, context), findings: wiring.findings.map(compact), data: { reads: readsJson(reads), result: portableData(JSON.parse(JSON.stringify(wiring)) as JsonValue, session.root) } });
    }
  }
  step.tick(key.inputs.length, reused ? key.inputs.length : 0, reused ? 0 : key.inputs.length);
  step.end();
  const previousRecords = session.records(WIRING_FOLDER).flatMap((record) => record.findings);
  session.replace(WIRING_FOLDER, records.toArray());
  const report = makeReport({ family: 'wiring', mode: decision.mode, reason: decision.reason, checked: reused ? 0 : 1, reused: reused ? 1 : 0, previous: previousRecords, current: wiring.findings.map(compact) });
  session.report(report);
  return { wiring, report };
}

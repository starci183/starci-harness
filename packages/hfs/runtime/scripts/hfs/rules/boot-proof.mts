// R272: lite proves each app's real Nest composition with doubles; full keeps its e2e proof.
import fs from 'node:fs';
import path from 'node:path';
import { appWiring } from '../app-wiring.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

export const BE_APP_BOOT_PROOF_MISSING = 'BE_APP_BOOT_PROOF_MISSING';

let suppressed = 0;
/**
 * Runs `work` with the ordinary content finder's boot proof off. The app check cache runs the proof as its own scoped step (`--wiring`,
 * keyed on the back-end side), so the always-run app pass must not compile the Nest graph a second time.
 */
export function withoutBootProof<T>(work: () => T): T {
  suppressed += 1;
  try { return work(); } finally { suppressed -= 1; }
}

/** Root scopes delegate to the be side, so each app is compiled once. */
export function bootProofFindings({ repoRoot, files, all = files, repo, isRoot = Boolean(repo?.sides), inScope = () => true }: { repoRoot: string; files: string[]; all?: string[]; repo: Repo; isRoot?: boolean; inScope?: (file: string) => boolean }) {
  if (suppressed > 0 || repo?.edition !== 'lite' || isRoot || repo?.profile === 'fe' || repo?.kind === 'fe') return [];
  // Dependencies not installed (a fresh scaffold, a lint-only checkout): the Nest graph cannot be compiled, so the proof is unavailable here; CI and every installed app judge it.
  const installed = [repoRoot, path.dirname(repoRoot ?? '.')].some((dir) => dir && fs.existsSync(path.join(dir, 'node_modules')));
  return appWiring({ repoRoot, files: all, repo }).findings
    .filter((finding: Parsed) => installed || finding.reason !== 'module or proof could not be compiled')
    .filter((finding: Parsed) => inScope(finding.path));
}

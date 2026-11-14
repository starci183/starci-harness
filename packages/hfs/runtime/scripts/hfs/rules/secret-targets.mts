// secret-targets.mts - R429: a secret target the project's ext/manifest.json declares (`secretTargets`, PROJECT-STACKS-5) holds sealed files and nothing else:
//   HFS_SECRET_TARGET_MISSING    the checkout of the target is here, and the file of a declared environment is not in it, or the target's .sops.yaml is not;
//   HFS_SECRET_TARGET_UNSEALED   a file of the target is not a sops envelope (no `sops` block: its values are plain text);
//   HFS_SECRET_TARGET_PLAIN      a file of the target carries its `sops` block and still holds a value that is not an ENC[...] value.
// A checkout that is not on this machine (CI has none of a sibling repository) is no finding: the rule judges what it can read, and never a value (only
// whether each leaf is an encrypted one). The shape of the declaration itself is HFS_EXT_INVALID (R381). Pure judge: `judgeTargetFile`.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../../engine/yaml.mjs';
import { isSopsEnvelope } from '../../lib/sops-envelope.mjs';
import { PROJECT_EXT_MANIFEST, hasProjectExt, loadProjectExt, secretTargetPaths } from '../../lib/project-ext.mjs';
import { found } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

/** How a sealed target file reads without decrypting it: sealed, never sealed (no sops block), or sealed with a plain value in it. */
export function judgeTargetFile(text: string): 'sealed' | 'unsealed' | 'plain' {
  if (isSopsEnvelope(text)) return 'sealed';
  let doc: unknown;
  try { doc = parseYaml(text); } catch { return 'unsealed'; }
  const hasSops = doc !== null && typeof doc === 'object' && !Array.isArray(doc) && typeof (doc as Record<string, unknown>)['sops'] === 'object' && (doc as Record<string, unknown>)['sops'] !== null;
  return hasSops ? 'plain' : 'unsealed';
}

/** R429 at the app root: the declared targets whose checkout is on this machine. */
export function secretTargetFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Repo; isRoot: boolean }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false || !hasProjectExt(repoRoot)) return [];
  const ext = loadProjectExt(repoRoot);
  if (ext.problems.length > 0) return [];
  const out: Finding[] = [];
  for (const target of ext.secretTargets) {
    const base = secretTargetPaths(repoRoot, target, Object.keys(target.environments)[0] as string);
    if (!fs.existsSync(base.root)) continue;
    const at = (code: string, message: string): number => out.push(found(code, PROJECT_EXT_MANIFEST, `${PROJECT_EXT_MANIFEST} secretTargets ${target.id}: ${message} (R429, PROJECT-STACKS-5)`, { target: target.id }));
    if (!fs.existsSync(base.sopsFile)) at('HFS_SECRET_TARGET_MISSING', `${target.recipients} is not in the checkout ${target.root}: the files are sealed to its creation rule`);
    for (const [env, name] of Object.entries(target.environments)) {
      const file = path.join(base.root, name);
      if (!fs.existsSync(file)) { at('HFS_SECRET_TARGET_MISSING', `${name} (the file of ${env}) is not in the checkout ${target.root}; \`starci app secret set --env ${env} --ext ${target.id} <KEY>\` creates it`); continue; }
      const verdict = judgeTargetFile(fs.readFileSync(file, 'utf8'));
      if (verdict === 'unsealed') at('HFS_SECRET_TARGET_UNSEALED', `${name} is not a sops envelope: its values are plain text; seal it with \`starci app secret set --env ${env} --ext ${target.id} <KEY>\` and remove the plain file from history`);
      else if (verdict === 'plain') at('HFS_SECRET_TARGET_PLAIN', `${name} carries a sops block and holds a value that is not encrypted: set that key again with \`starci app secret set --env ${env} --ext ${target.id} <KEY>\``);
    }
  }
  return out;
}

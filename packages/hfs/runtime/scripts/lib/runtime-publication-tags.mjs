// The release owner's dist-tag judgment and idempotent reconciliation, independent of npm processes.
import { compareVersions, releaseLine, versionParts } from './release-version.mjs';

/**
 * Plan the release's declared tags from a complete registry read. Unknown reads and historical
 * releases fail closed (alpha.31.1 is behind alpha.31.2 and alpha.32 on the one alpha line); a newer
 * tag on another release line is preserved rather than rolled back.
 * Returns serializable {tag, version, current, action} entries for the native dry-run plan.
 */
export function runtimeTagPlan({ version, tags, state, uploadTag = null }) {
  versionParts(version);
  if (!Array.isArray(tags) || !tags.length || tags.some((tag) => typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(tag)))
    throw new Error('runtime publication requires declared npm dist-tags');
  if (!['present', 'absent'].includes(state?.state) || !Array.isArray(state.versions) || !state.distTags || Array.isArray(state.distTags) || typeof state.distTags !== 'object')
    throw new Error('runtime dist-tags and version inventory could not be read');
  if (state.state === 'present' && !state.versions.includes(version)) throw new Error('runtime version inventory omits the published release');
  const newer = state.versions.find((entry) => releaseLine(entry) === releaseLine(version) && compareVersions(entry, version) > 0);
  if (newer) throw new Error(`runtime release ${version} is behind ${newer} on its release line; dist-tags cannot move backwards`);
  const plan = [...new Set(tags)].map((tag) => {
    const current = state.distTags[tag] ?? null;
    if (current !== null && typeof current !== 'string') throw new Error(`unreadable npm dist-tag ${tag}`);
    const compared = current === null ? -1 : compareVersions(current, version);
    let action = current === version ? 'confirmed' : 'set';
    if (compared > 0) action = 'preserve';
    return { tag, version: compared > 0 ? current : version, current,
      action };
  });
  if (uploadTag && plan.some((entry) => entry.tag === uploadTag && entry.action === 'preserve'))
    throw new Error(`runtime upload channel ${uploadTag} points to a newer release; publication cannot move it backwards`);
  return plan;
}

/**
 * Repair only stale declared tags of an integrity-confirmed runtime version, then read every tag
 * back. The registry seam owns effects; a failed write/read throws and can be retried without upload.
 */
export function reconcileRuntimeTags({ row, tags, registry, out, sleep = null, waitMs = 0, stepMs = 5000 }) {
  const state = registry.state(row.name, row.version);
  if (state.state !== 'present' || state.integrity !== row.registry.integrity) throw new Error('runtime registry integrity changed before dist-tag reconciliation');
  const plan = runtimeTagPlan({ version: row.version, tags, state });
  for (const entry of plan.filter((item) => item.action === 'set')) {
    const result = registry.tag(row.name, row.version, entry.tag);
    if (!result.ok) throw new Error(`npm dist-tag ${entry.tag} failed (exit ${result.status ?? 'unknown'})`);
  }
  // Registry propagation of a tag write can lag; poll the read-back inside the window before calling it stale.
  const deadline = Date.now() + waitMs;
  let confirmed = registry.state(row.name, row.version);
  while (sleep && Date.now() < deadline && plan.some((entry) => confirmed.distTags?.[entry.tag] !== entry.version)) {
    sleep(stepMs);
    confirmed = registry.state(row.name, row.version);
  }
  if (confirmed.state !== 'present' || confirmed.integrity !== state.integrity || plan.some((entry) => confirmed.distTags?.[entry.tag] !== entry.version))
    throw new Error('runtime dist-tag read-back did not confirm the declared targets and immutable integrity');
  for (const entry of plan) out(`  dist-tag ${row.name}@${entry.version} ${entry.tag}: ${entry.action === 'preserve' ? 'newer release preserved' : 'confirmed by registry read-back'}`);
  return plan;
}

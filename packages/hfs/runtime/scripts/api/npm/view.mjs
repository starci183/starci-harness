// view.mjs - `npm view`: what the npm registry says about one package version. The release gate reads it to know whether a
// version is published and which integrity the registry holds; it never writes.
import { npmSpawn } from './lib.mjs';

/** The JSON `npm view <spec> <field> --json` printed, or null when it printed none. */
const parsed = (text) => { try { return JSON.parse(String(text ?? '').trim() || 'null'); } catch { return null; } };

/**
 * {state: 'present' | 'absent' | 'unreachable', integrity?, latest?, versions?, distTags?, detail?} of `name@version`. A package the registry does not
 * know (E404) or a version it does not list is `absent` (with the registry's latest when it has one); any other failure
 * (network, auth, a broken npm) is `unreachable`, never a guess. `run` is the spawn seam of a spec.
 */
export function view(name, version, { cwd, run = npmSpawn } = {}) {
  const listed = run(['view', name, 'versions', 'dist-tags', '--json'], { cwd, timeout: 120_000 });
  const err = `${listed.stderr ?? ''}${listed.error?.message ?? ''}`;
  if (listed.error || listed.signal || listed.status === null) return { state: 'unreachable', detail: err.trim().slice(0, 200) || 'npm did not run' };
  if (listed.status !== 0) {
    return /\bE404\b|404 Not Found|code E404/.test(err) ? { state: 'absent', latest: '-', versions: [], distTags: {} } : { state: 'unreachable', detail: err.trim().split(/\r?\n/)[0].slice(0, 200) };
  }
  const doc = parsed(listed.stdout);
  const versions = [doc?.versions].flat();
  const distTags = doc?.['dist-tags'];
  if (!versions.length || versions.some((entry) => typeof entry !== 'string') || !distTags || Array.isArray(distTags) || typeof distTags !== 'object' || Object.values(distTags).some((entry) => typeof entry !== 'string'))
    return { state: 'unreachable', detail: 'the registry returned an unreadable version or dist-tag inventory' };
  const inventory = { versions, distTags, latest: distTags.latest ?? '-' };
  if (!versions.includes(version)) return { state: 'absent', ...inventory };
  const dist = run(['view', `${name}@${version}`, 'dist.integrity', '--json'], { cwd, timeout: 120_000 });
  const integrity = !dist.error && !dist.signal && dist.status === 0 ? parsed(dist.stdout) : null;
  return typeof integrity === 'string' ? { state: 'present', integrity, ...inventory } : { state: 'unreachable', detail: 'the registry lists the version but gave no integrity' };
}

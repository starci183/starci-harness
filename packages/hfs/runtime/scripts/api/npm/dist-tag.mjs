// The release owner's npm dist-tag mutation edge; reads remain owned by view.mjs.
import { npmSpawn } from './lib.mjs';

/** Set one declared tag on an already confirmed package version; report incomplete effects as failure. */
export function distTag(name, version, tag, { cwd, run = npmSpawn } = {}) {
  const result = run(['dist-tag', 'add', `${name}@${version}`, tag], { cwd, timeout: 120_000 });
  return { ok: !result.error && !result.signal && result.status === 0, status: result.status ?? null };
}

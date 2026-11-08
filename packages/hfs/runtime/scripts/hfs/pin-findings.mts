import fs from 'node:fs';
import path from 'node:path';
import { APP_SCOPE } from './slots.mjs';
import type { CanonPin, CanonPins } from './canon-pins.mjs';
import { pinMiss } from '../lib/pin-range.mjs';
import { lockEntries, lockPackageName, resolvedOnThisMachine } from '../../../cache/fingerprint.mjs';

const DEP_SECTIONS = ['dependencies', 'devDependencies'];
// A pin row may carry a same-minor `range` (the Grammar family and the two canons): an exact version inside it meets it.
/** The versions of each package the app's lockfile resolved from a registry on this machine (`starci deps install-local`): a pin naming one is met by that build, and only the restore returns it to npm's. */
const lockedHere = (repoRoot: string): ReadonlyMap<string, ReadonlySet<string>> => {
  const here = new Map<string, Set<string>>();
  for (const [key, entry] of Object.entries(lockEntries(repoRoot))) {
    const name = lockPackageName(key);
    if (name === null || entry.version === undefined || !resolvedOnThisMachine(entry.resolved)) continue;
    here.set(name, (here.get(name) ?? new Set<string>()).add(entry.version));
  }
  return here;
};
const pinnedSpec = (spec: string, pin: CanonPin): string | null => pinMiss(typeof pin.range === 'string' ? pin.range : pin.version, spec);

/** One canon-pin drift finding. */
export interface PinFinding { code: 'HFS_CANON_PIN_DRIFT'; level: 'error'; path: string; dependency: string; section: string; pinned: string; declared: string; message: string; local?: true }

function pinFileFindings(repoRoot: string, file: string, profile: string, pins: CanonPins, local: ReadonlyMap<string, ReadonlySet<string>>): PinFinding[] {
  const findings: PinFinding[] = [];
  let pkg: Record<string, Record<string, string> | undefined>; // reason: package.json parsed from disk
  try { pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')); } catch { return findings; }
  for (const [name, pin] of Object.entries(pins)) {
    // The app root's one package.json carries the pins of both sides.
    if (profile !== APP_SCOPE && pin.side !== 'both' && pin.side !== profile) continue;
    for (const section of DEP_SECTIONS) {
      const spec = pkg[section]?.[name];
      if (spec === undefined) continue;
      const drift = pinnedSpec(spec, pin);
      if (drift) findings.push({ code: 'HFS_CANON_PIN_DRIFT', level: 'error', path: file, dependency: name, section, pinned: typeof pin.range === 'string' ? pin.range : pin.version, declared: spec, message: `${name} in ${file} ${section}: ${drift}`, ...(local.get(name)?.has(spec) === true ? { local: true as const } : {}) });
    }
  }
  return findings;
}

export function pinFindings({ repoRoot, files, profile, pins, only }: { repoRoot: string; files: string[]; profile: string; pins: CanonPins; only?: Set<string> | null }): PinFinding[] {
  const findings: PinFinding[] = [];
  const local = lockedHere(repoRoot);
  for (const file of files.filter((f) => (f === 'package.json' || f.endsWith('/package.json')) && (!only || only.has(f)))) {
    findings.push(...pinFileFindings(repoRoot, file, profile, pins, local));
  }
  return findings;
}

import fs from 'node:fs';
import path from 'node:path';
import { APP_SCOPE } from './slots.mjs';
import type { CanonPin, CanonPins } from './canon-pins.mjs';
import { pinMiss } from '../lib/pin-range.mjs';

const DEP_SECTIONS = ['dependencies', 'devDependencies'];
// A pin row may carry a same-minor `range` (the Grammar family and the two canons): an exact version inside it meets it.
/** A spec naming a build of the local registry (`<version>-local.<n>`, cli/src/core/deps/local-version.ts): a pin only the restore can meet. */
const LOCAL_BUILD = /[-.]local\.\d+$/u;
const pinnedSpec = (spec: string, pin: CanonPin): string | null => pinMiss(typeof pin.range === 'string' ? pin.range : pin.version, spec);

/** One canon-pin drift finding. */
export interface PinFinding { code: 'HFS_CANON_PIN_DRIFT'; level: 'error'; path: string; dependency: string; section: string; pinned: string; declared: string; message: string; local?: true }

function pinFileFindings(repoRoot: string, file: string, profile: string, pins: CanonPins): PinFinding[] {
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
      if (drift) findings.push({ code: 'HFS_CANON_PIN_DRIFT', level: 'error', path: file, dependency: name, section, pinned: typeof pin.range === 'string' ? pin.range : pin.version, declared: spec, message: `${name} in ${file} ${section}: ${drift}`, ...(LOCAL_BUILD.test(spec) ? { local: true as const } : {}) });
    }
  }
  return findings;
}

export function pinFindings({ repoRoot, files, profile, pins, only }: { repoRoot: string; files: string[]; profile: string; pins: CanonPins; only?: Set<string> | null }): PinFinding[] {
  const findings: PinFinding[] = [];
  for (const file of files.filter((f) => (f === 'package.json' || f.endsWith('/package.json')) && (!only || only.has(f)))) {
    findings.push(...pinFileFindings(repoRoot, file, profile, pins));
  }
  return findings;
}

// canon-pins.mjs - the pins an app is judged and scaffolded against. knowledge/hfs/canon-pins.yaml pins every shared dependency
// but the command line itself: the `starci-harness` row is the version of the CLI that runs this @starci/hfs (it passes its own
// version to main as `harness`), never a bundled row, since the CLI depends on this package exactly and a bundled pin of the CLI
// would make each release of one need a release of the other. Run without a CLI (the package's own specs and diagnostics), there
// is no such row: nothing judges the app's starci-harness, and the scaffold, which needs it, refuses.
import fs from 'node:fs';
import path from 'node:path';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { parseYaml } from '../../engine/yaml.mjs';

/** The runtime-relative file of the bundled pins. */
export const CANON_PINS_FILE = 'knowledge/hfs/canon-pins.yaml';
/** The npm name of the command line that runs @starci/hfs, pinned at its own version. */
export const HARNESS_PACKAGE = 'starci-harness';

/** The pin map of knowledge/hfs/canon-pins.yaml under `root` (the bundled runtime by default). */
/** One pin row of canon-pins.yaml. */
export interface CanonPin { version: string; group?: string; install?: string; side?: string; [key: string]: unknown }
/** The pin map: package name to its pin row. */
export type CanonPins = Record<string, CanonPin>;

export const bundledPins = (root: string = skillRoot): CanonPins => parseYaml(fs.readFileSync(path.join(root, CANON_PINS_FILE), 'utf8'))?.pins ?? {}; // reason: parsed YAML from disk, shaped by canon-pins.yaml

/**
 * The pin map an app answers to: the bundled pins plus the `starci-harness` row at `harness.version`, the version of the CLI that
 * runs this package; without `harness` the bundled pins alone.
 */
export function canonPins({ root = skillRoot, harness }: { root?: string; harness?: { version?: string } } = {}): CanonPins {
  const pins = bundledPins(root);
  if (harness?.version === undefined) return pins;
  return { ...pins, [HARNESS_PACKAGE]: { version: harness.version, group: 'starci', install: 'registry', side: 'both' } };
}

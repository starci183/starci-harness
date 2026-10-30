// bypass-markers.mjs - HFS_BYPASS_MARKER (R303): a product repository holds no bypass of a check. Whatever makes a check pass without
// satisfying it is refused wherever it is written (owner ruling loosening-always-red: a bypass is always red):
//   - an inline disable of any tool (eslint, stylelint, tslint, prettier, biome), a type-check escape (the ts-ignore, ts-expect-error and
//     ts-nocheck directives), a Sonar exclusion comment, an istanbul / c8 / v8 coverage ignore;
//   - a skipped, focused or todo test, or a skip option (a front end has no specs, but its source is still judged for the inline disables);
//   - a failure swallowed in a hook, a script or a workflow: `|| true`, `continue-on-error`, `set +e`, `HUSKY=0`, `--no-verify`,
//     `fail_ci_if_error: false`, `--passWithNoTests`;
//   - a gate configuration relaxed: a coverage target or threshold below the canon, a relaxing switch, a disabled ESLint rule, a strictness option
//     turned off, an exception file the design-truths manifest does not list.
// The tree is read as it stands, by the library of the runtime's own loosening check (scripts/lib/loosening-state.mjs, knowledge/hfs/design-truths.yaml);
// `starci app check --staged` (the pre-commit hook) reads the staged bypass markers with the same table (scripts/lib/bypass-markers.mjs). The ignore and
// exclude lists of a managed config are the managed-file drift's (HFS_MANAGED_FILE_DRIFT).
import fs from 'node:fs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { found, readText } from './read.mjs';
import { bypassesIn } from '../../lib/bypass-markers.mjs';
import { findingLine, stateFindings } from '../../lib/loosening-state.mjs';
import type { Parsed } from './rule-types.mjs';

export const HFS_BYPASS_MARKER = 'HFS_BYPASS_MARKER';
const TRUTHS_FILE = new URL('../../../knowledge/hfs/design-truths.yaml', import.meta.url);

/** The finding message of one marker of `file`. */
export const bypassMessage = (file: string, hit: Parsed) => `${file}:${hit.line} spells ${hit.label} (${hit.text.slice(0, 80)}); a check is satisfied, never bypassed: fix the cause and delete the marker`;

const markerFindings = ({ repoRoot, files }: { repoRoot: string; files: string[] }) => files.flatMap((file: string) => {
  const text = readText(repoRoot, file);
  return text === null ? [] : bypassesIn(file, text).map((hit: Parsed) => found(HFS_BYPASS_MARKER, file, bypassMessage(file, hit), { line: hit.line }));
});

/** The relaxed gate configuration of `files`: the library's findings other than the markers and the lists. */
const configFindings = ({ repoRoot, files }: { repoRoot: string; files: string[] }) => stateFindings({ files, read: (file: string) => readText(repoRoot, file), truths: parseYaml(fs.readFileSync(TRUTHS_FILE, 'utf8')), lists: false })
  .filter((entry: Parsed) => entry.kind !== 'bypass' && entry.kind !== 'truths')
  .map((entry: Parsed) => found(HFS_BYPASS_MARKER, entry.file, `${entry.file}:${entry.line} relaxes a gate (${findingLine(entry)}); a check is satisfied, never relaxed: restore the canon value`, { line: entry.line }));

/** The findings of R303 over the tracked paths `files` of the repository at `repoRoot`. */
export function bypassMarkerFindings({ repoRoot, files }: { repoRoot: string; files: string[] }) {
  const markers = markerFindings({ repoRoot, files });
  return markers.concat(configFindings({ repoRoot, files }));
}

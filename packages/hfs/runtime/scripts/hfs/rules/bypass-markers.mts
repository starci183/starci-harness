// bypass-markers.mts - HFS_BYPASS_MARKER (R303): a product repository holds no bypass of a check. Whatever makes a check pass without
// satisfying it is refused wherever it is written (a bypass is always red):
//   - an inline disable of any tool (eslint, stylelint, tslint, prettier, biome), a type-check escape (the ts-ignore, ts-expect-error and
//     ts-nocheck directives), a Sonar exclusion comment, an istanbul / c8 / v8 coverage ignore;
//   - a skipped, focused or todo test, or a skip option (a front end has no specs, but its source is still judged for the inline disables);
//   - a failure swallowed in a hook, a script or a workflow: `|| true`, `continue-on-error`, `set +e`, `HUSKY=0`, `--no-verify`,
//     `fail_ci_if_error: false`, `--passWithNoTests`, a constant false `if` on a check job or step (a job of the managed ci.yml that the
//     gate declaration idles, IDLE_JOBS of scripts/lib/stack-declaration.mts, is the render of that declaration, never a bypass);
//   - a gate configuration relaxed: a coverage target or threshold below the canon, a relaxing switch, a disabled ESLint rule, a strictness option
//     turned off, an exception file the design-truths manifest does not list.
// The tree is read as it stands, by the library of the runtime's own loosening check (scripts/lib/loosening-state.mts, knowledge/hfs/design-truths.yaml);
// `starci app check --staged` (the pre-commit hook) reads the staged bypass markers with the same table (scripts/lib/bypass-markers.mts). The ignore and
// exclude lists of a managed config are the managed-file drift's (HFS_MANAGED_FILE_DRIFT).
// One marker reaches one rule (contexts/project/lint.md PROJECT-LINT-7): a suppression comment and a skipped or focused test in a TypeScript source
// file are the canon lint's (R18 no-inline-suppression / no-inline-lint-config, R48 spec-no-skip); a rule switched off in a managed eslint or stylelint
// config is the managed-file drift's (R17); a strictness option of a side's tsconfig.json is R22's; a lint-suppression file is R104's.
import fs from 'node:fs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { found, readText } from './read.mjs';
import { bypassesIn, MANAGED_CI } from '../../lib/bypass-markers.mjs';
import { declaredGatesOff, idleJobs } from '../../lib/stack-declaration.mjs';
import { findingLine, stateFindings } from '../../lib/loosening-state.mjs';
import type { Parsed } from './rule-types.mjs';

export const HFS_BYPASS_MARKER = 'HFS_BYPASS_MARKER';
const TRUTHS_FILE = new URL('../../../knowledge/hfs/design-truths.yaml', import.meta.url);

/** The finding message of one marker of `file`. */
export const bypassMessage = (file: string, hit: Parsed) => `${file}:${hit.line} spells ${hit.label} (${hit.text.slice(0, 80)}); a check is satisfied, never bypassed: fix the cause and delete the marker`;

/** A TypeScript source file: the canon lint reads its comments and its tests. */
const LINTED_SOURCE = /\.tsx?$/;
/** The managed one-line lint configs (R17) and the side tsconfig files (R22): their relaxations are those rules' findings. */
const MANAGED_LINT_CONFIG = /(?:^|\/)(?:eslint|stylelint)\.config\.mjs$/;
const SIDE_TSCONFIG = /^(?:be|fe)\/tsconfig\.json$/;
const LINT_SUPPRESSION_FILE = /(?:^|\/)eslint[.-]suppressions[^/]*$/;

/** Whether another rule owns this relaxation of the gate configuration (see the header). */
const ownedElsewhere = (entry: Parsed): boolean => (entry.kind === 'rule-off' && MANAGED_LINT_CONFIG.test(entry.file))
  || (entry.kind === 'strictness' && SIDE_TSCONFIG.test(entry.file))
  || (entry.kind === 'exception-file' && LINT_SUPPRESSION_FILE.test(entry.file));

/**
 * The markers of one product file this rule owns: every marker, less the suppression comments and test markers of a TypeScript source file,
 * which the canon lint owns. The tree rule and the staged guard of the pre-commit hook (sync/hygiene.mts) both read a file through it.
 */
export const productBypassHits = (file: string, text: string, idle: ReadonlySet<string>): Parsed[] => {
  const linted = LINTED_SOURCE.test(file);
  return bypassesIn(file, text, { idle }).filter((hit: Parsed) => !(linted && hit.via !== undefined));
};

const markerFindings = ({ repoRoot, files }: { repoRoot: string; files: string[] }) => {
  // The jobs of the managed ci.yml the gate declaration idles are its render (PROJECT-LINT-4), not a bypass.
  // Read only when the managed ci.yml is judged: its per-file record depends on the declaration (perFileRules deps), every other file on itself alone.
  const idle = files.includes(MANAGED_CI) ? idleJobs(declaredGatesOff(repoRoot)) : new Set<string>();
  return files.flatMap((file: string) => {
    const text = readText(repoRoot, file);
    return text === null ? [] : productBypassHits(file, text, idle).map((hit: Parsed) => found(HFS_BYPASS_MARKER, file, bypassMessage(file, hit), { line: hit.line }));
  });
};

/** The relaxed gate configuration of `files`: the library's findings other than the markers and the lists. */
const configFindings = ({ repoRoot, files }: { repoRoot: string; files: string[] }) => stateFindings({ files, read: (file: string) => readText(repoRoot, file), truths: parseYaml(fs.readFileSync(TRUTHS_FILE, 'utf8')), lists: false })
  .filter((entry: Parsed) => entry.kind !== 'bypass' && entry.kind !== 'truths' && !ownedElsewhere(entry))
  .map((entry: Parsed) => found(HFS_BYPASS_MARKER, entry.file, `${entry.file}:${entry.line} relaxes a gate (${findingLine(entry)}); a check is satisfied, never relaxed: restore the canon value`, { line: entry.line }));

/** The findings of R303 over the tracked paths `files` of the repository at `repoRoot`. */
export function bypassMarkerFindings({ repoRoot, files }: { repoRoot: string; files: string[] }) {
  const markers = markerFindings({ repoRoot, files });
  return markers.concat(configFindings({ repoRoot, files }));
}

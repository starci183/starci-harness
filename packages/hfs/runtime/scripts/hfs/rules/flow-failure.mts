// R377: every job and saga flow runs itself again after a failure of any kind (BE-RESILIENCE-2). A processor, a job step, a saga step
// or compensation and a message consumer let a failure reach the runner, which classifies it, retries a transient one and parks any
// other with one alert until a resume; a `catch` that neither rethrows nor parks swallows the failure, and BullMQ's `removeOnFail` set to
// `true` or a bare count deletes the failed job that a resume needs, a silent final dead letter either way. The runner parks a failure durably
// (`JobClaims.park`, `failed_awaiting_fix` in PostgreSQL), so the broker's copy is a cache: a bounded retention of it, an object literal naming
// `age` or `count` (`removeOnFail: { age: KEEP_FAILED_SECONDS }`), keeps Redis bounded under noeviction and is accepted, as are
// `removeOnFail: false` and a type member that declares the option without setting it (`readonly removeOnFail: Retention`, `removeOnFail?: ...`).
// Judged: every tracked flow file of the back end (`*.processor.ts`, `*.step.ts`, `*.saga-step.ts`, `*.compensation.ts`, `*.consumer.ts`)
// for a swallowing catch, and every tracked back-end source for `removeOnFail`, read through readText with comments stripped.
import { found, readText } from './read.mjs';
import type { Repo, Resolver } from './rule-types.mjs';

export const BE_FLOW_FAILURE_SWALLOWED = 'BE_FLOW_FAILURE_SWALLOWED';

const FLOW_FILE = /^be\/src\/.+\.(?:processor|step|saga-step|compensation|consumer)\.ts$/u;
const BE_SOURCE = /^be\/(?:src|apps)\/.+\.ts$/u;
const SPEC = /\.spec\.ts$/u;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{/gu;
const HANDS_ON = /\bthrow\b|\.park\(/u;
const REMOVE_ON_FAIL = /(\breadonly\s+)?\bremoveOnFail\b(\s*\?)?(\s*:\s*)?/gu;
const BOUNDED = /(?:^|[{,\s])(?:age|count)\s*:/u;

/** The body of the block whose opening brace ends at `open`, or the rest of the text when it never closes. */
function blockAt(text: string, open: number): string {
  let depth = 1;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    if (depth === 0) return text.slice(open, at);
  }
  return text.slice(open);
}

/**
 * True when some `removeOnFail` of the source deletes failed jobs: every use except a type member (readonly or optional), `false`, and an object
 * literal that names `age` or `count` (a bounded retention of the broker copy; the parked row in PostgreSQL is the durable failure).
 */
function deletesFailed(source: string): boolean {
  return [...source.matchAll(REMOVE_ON_FAIL)].some((match) => {
    const [whole, readonly, optional, colon] = match;
    if (readonly !== undefined || optional !== undefined) return false;
    if (colon === undefined) return true;
    const rest = source.slice(match.index + whole.length);
    if (/^false\b/u.test(rest)) return false;
    return !(rest.startsWith('{') && BOUNDED.test(blockAt(source, match.index + whole.length + 1)));
  });
}

/** True when some catch block of the source neither rethrows nor parks. */
const swallows = (source: string): boolean => [...source.matchAll(CATCH)].some((match) => !HANDS_ON.test(blockAt(source, match.index + match[0].length)));

/** The R377 findings: a flow file that swallows a failure, and a source that deletes failed jobs. */
export function flowFailureFindings({ repoRoot, files = [], all = files, repo, isRoot, inScope = () => true }: { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; resolver?: Resolver; isRoot: boolean; inScope?: (file: string) => boolean }) {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  return [...new Set(all)].filter((file) => BE_SOURCE.test(file) && !SPEC.test(file) && inScope(file)).flatMap((file) => {
    const text = readText(repoRoot, file);
    if (text === null) return [];
    const source = text.replace(COMMENT, '');
    const findings = [];
    if (FLOW_FILE.test(file) && swallows(source))
      findings.push(found(BE_FLOW_FAILURE_SWALLOWED, file, `${file} catches a failure and neither rethrows nor parks it, so the flow ends without a retry, a park or an alert; let it reach the runner, which retries a transient failure and parks the rest (R377, BE-RESILIENCE-2)`));
    if (deletesFailed(source))
      findings.push(found(BE_FLOW_FAILURE_SWALLOWED, file, `${file} sets removeOnFail to delete failed jobs (true, a bare count or a value the rule cannot read), which drops the failed job before its durable park is proven; a failure is parked as failed_awaiting_fix, and the broker copy is kept (removeOnFail: false) or kept bounded with an object literal naming age or count (removeOnFail: { age: <seconds> }) (R377, BE-RESILIENCE-2)`));
    return findings;
  });
}

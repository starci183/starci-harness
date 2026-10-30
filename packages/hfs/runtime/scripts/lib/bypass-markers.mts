// bypass-markers.mjs - what a BYPASS of a check looks like in text (owner ruling loosening-always-red: any bypass is red, always).
// One table serves both sides of the no-bypass law, and both read a whole file as it stands (no history):
//   product   scripts/hfs/rules/bypass-markers.mjs (HFS_BYPASS_MARKER, `starci app check`) and `starci app hygiene` (the pre-commit hook);
//   runtime   scripts/lib/loosening-state.mjs (RT_LOOSENING_STATE, `starci runtime check`).
// A marker is a way to make a check pass without satisfying it: an inline disable of any tool, a type-check escape, a Sonar or coverage
// exclusion comment, a skipped or focused test, a failure swallowed in a hook, a script or a workflow step, a hook skipped.
// A directive is read where it acts: a suppression word at the start of a comment, a test marker in code, a swallowed failure in a shell line or
// in the string a script hands a shell. The same words quoted as data (a message, a ban list, a fixture) are no directive.
// No file is skipped for its place or its name: a generated file or a folder named build is read like any other (a generator that emits a marker
// is a loosening too); build output is untracked and never reaches a tree check.
// The patterns are assembled from fragments (joined) so that this file never spells a marker itself.
import { langOf, lexSource, splitLines } from './js-lex.mjs';
import type { LexComment, LexString } from './js-lex.mjs';

/** A bypass marker found in a text: its 1-based line, its label and the text that carries it. */
export interface BypassHit { line: number; label: string; text: string }
/** The kind of file the markers are read in. */
export type BypassFileKind = 'code' | 'shell' | 'workflow' | 'dockerfile' | 'manifest';
/** Anything with a `test(text)`: a pattern, or a predicate on the line. */
interface Matcher { test(text: string): boolean }
type Labelled = readonly [Matcher, string];

const join = (...parts: string[]): string => parts.join('');

const SUPPRESSION_WORDS = [
  join('eslint', '-disable'), join('stylelint', '-disable'), join('tslint', ':disable'), join('prettier', '-ignore'), join('biome', '-ignore'),
  join('@ts', '-ignore'), join('@ts', '-expect-error'), join('@ts', '-nocheck'),
  join('istanbul', ' ignore'), join('c8', ' ignore'), join('v8', ' ignore'), join('jscpd', ':ignore'), join('eslint', '-env'),
];
const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
/** A suppression directive opens its comment: after the opener only blanks and asterisks may precede it. */
const DIRECTIVE = new RegExp(String.raw`^[\s*/]*(${SUPPRESSION_WORDS.map(escaped).join('|')})`);
/** Inline configuration ESLint honours at the start of a comment: a rule level, declared globals or exports. */
const INLINE_CONFIG = new RegExp(String.raw`^[\s*/]*(${join('eslint')}\s+[@\w/.-]+\s*:|globals?\s|exported\b)`);
/** The type-check escapes: TypeScript reads them on the last line of a block comment too. */
const TYPE_ESCAPES = SUPPRESSION_WORDS.filter((word) => word.startsWith('@ts'));
/** Sonar reads its exclusion word anywhere in a comment. */
const SONAR_WORD = join('NO', 'SONAR');

const RUNNER = '(?:it|test|describe|suite)';
const ANYWHERE_TESTS: [RegExp, string][] = [
  [new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.(?:skip|only|todo|failing)\b`), 'a skipped or focused test'],
  [new RegExp(String.raw`\b${RUNNER}(?:\.\w+)*\.(?:skipIf|runIf)\(`), 'a conditionally skipped test'],
  [new RegExp(String.raw`\{[^}]*\b(?:skip|only|todo)\b[^}]*\}\s*=\s*${RUNNER}\b`), 'a skip taken from the test runner'],
];
/** Names that are ordinary identifiers outside a test file: read only in a spec or test file. */
const SPEC_TESTS: [RegExp, string][] = [
  [new RegExp(String.raw`\b(?:xit|xtest|xdescribe|fit|fdescribe)\(`), 'a skipped or focused test'],
  [new RegExp(String.raw`\b(?:skip|todo)\s*:\s*(?!false\b|\d|\[)\S|\bonly\s*:\s*true\b`), 'a skip option'],
  [new RegExp(String.raw`\.\s*(?:skip|todo)\s*\(`), 'a skipped test through its context'],
  [new RegExp(String.raw`\bpending\(\)`), 'a pending test'],
];
const TEST_KEYS = new Set(['skip', 'only', 'todo', 'failing']);

const CHILD = '(?:execSync|spawnSync|execFileSync)';
/** Exit codes that a script resets or a helper swallows (scripts, hooks and tools; never specs). */
const EXIT_PATTERNS: [RegExp, string][] = [
  [new RegExp(String.raw`\btry\s*\{[^{}]*\b${CHILD}\b[^{}]*\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}`), 'a child failure swallowed by an empty catch'],
  [new RegExp(String.raw`\b${CHILD}\([^;]*\);\s*process\.exit\(\s*0\s*\)`), 'an exit 0 right after a child whose status is never read'],
];
const EXIT_EVENTS = new Set(['exit', 'uncaughtException', 'unhandledRejection']);
const EXIT_ZERO = /exitCode\s*=\s*0|exit\(\s*0\s*\)/;

/** The text after the `=>` of a handler argument that follows the event name (`, () => ...`), or null when it is not one. */
function arrowBody(after: string): string | null {
  const text = after.trimStart();
  const arrow = text.indexOf('=>');
  return text.startsWith(',') && arrow > 0 && arrow < 60 ? text.slice(arrow + 2).trimStart() : null;
}

/** Whether the handler that starts at `after` (what follows the event name) is empty, resets the exit code or exits 0. */
function resetsExit(after: string): boolean {
  const body = arrowBody(after);
  if (body === null) return false;
  if (!body.startsWith('{')) return EXIT_ZERO.test(body.slice(0, 40));
  const inner = body.slice(1, Math.max(1, body.indexOf('}')));
  return inner.trim() === '' || EXIT_ZERO.test(inner);
}

/** Whether a line commits with a short flag group that holds n, which skips the hooks (`-n`, `-nm`, `-an`). */
function commitsWithShortSkip(line: string): boolean {
  const words = line.split(/\s+/);
  const at = words.indexOf('commit');
  return words.includes('git') && at >= 0 && words.slice(at + 1).some((word) => /^-[a-zA-Z]+$/.test(word) && word.includes('n'));
}

const SWALLOW: Labelled[] = [
  [/\|\|\s*(?:true\b|:|"true"|'true'|\/(?:usr\/)?bin\/true|exit\s+0\b|return\s+0\b|echo\b|printf\b)/, 'a failure swallowed with or-true'],
  [/;\s*(?:true\b(?!\s*[,:(.=])|:\s*$)/, 'a failure swallowed with semicolon-true'],
  [/\bcontinue-on-error\s*:\s*(?!false\b)\S/, join('continue', '-on-error')],
  [/\bset\s+\+[a-z]*e/, join('set ', '+e')],
  [/\bset\s+\+o\s+errexit\b/, join('set ', '+o errexit')],
  [/\btrap\s+['"]?exit\s+0/, join('trap ', 'exit 0')],
  [/\bHUSKY\s*=\s*0\b/, join('HUSKY', '=0')],
  [/--no-verify\b/, '--no-verify'],
  [{ test: commitsWithShortSkip }, join('git commit ', '-n')],
  [/-c\s+core\.hooksPath=[/\w]/, join('core.hooks', 'Path redirected')],
  [/\bfail_ci_if_error\s*:\s*false\b/, 'fail_ci_if_error: false'],
  [/--(?:passWithNoTests|pass-with-no-tests)\b/, '--passWithNoTests'],
  [/--coverageThreshold\b/, '--coverageThreshold'],
  [/--no-error-on-unmatched-pattern\b/, '--no-error-on-unmatched-pattern'],
  [/--max-warnings(?:\s+|=)(?!0\b)\S/, 'a warning budget'],
  [/--continue-on-error\b|--keep-going\b/, join('--continue', '-on-error')],
  [/\beslint\b[^\n|;&]*--quiet\b/, 'eslint --quiet'],
  [/--(?:rule\s+['"]?[@\w/-]+:\s*(?:off|0)|ignore-pattern|testPathIgnorePatterns)\b/, 'a check narrowed on the command line'],
  [/-Dsonar\.(?:[\w.]*(?:exclusions|inclusions|sources)\b|qualitygate\.wait=(?!true\b))/, 'a Sonar scope set on the command line'],
  [/sonar\.qualitygate\.wait\s*=\s*false/, 'a Sonar gate not waited for'],
];
/** The failures a script hands a shell in a string: the commands only, never a flag a message names. */
const COMMAND_SWALLOW = SWALLOW.filter(([, label]) => /or-true|semicolon-true|set \+|trap exit|HUSKY|git commit -n|Path redirected/.test(label));
const GIT_VERBS = new Set(['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'am', 'revert']);
/** A git command line carrying the flag: after the flag only more flags, operators or quoted and variable words follow, never prose. */
const GIT_COMMAND = /^\s*git\s(?:\S+\s)*?--no-verify(?:\s+(?:-\S*|[&|;>"'$]\S*))*\s*$/;
const GIT_LINE_WITH_MESSAGE = /^\s*git\s.*--no-verify\b.*\s-m\s/;

/** Workflow lines that make a job or a step not run, or a shell not stop on a failure. */
const WORKFLOW_PATTERNS: Labelled[] = [
  [/^\s*shell:\s*bash\s*\{0\}/, 'a shell that does not stop on a failure'],
];
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|less)$/;
const SHELL_FILE = /(?:^|\/)(?:\.(?:husky|githooks)\/(?!_\/)[^/]+|[^/]+\.sh|hooks\/husky\/[^/]+)$/;
const WORKFLOW_FILE = /(?:^|\/)(?:(?:\.github|github)\/(?:workflows|actions)\/.+|ci-workflows(?:-lite)?\/[^/]+|lefthook)\.ya?ml$/;
const DOCKERFILE = /(?:^|\/)Dockerfile(?:\.[\w-]+)?$/;
const MANIFEST_FILE = /(?:^|\/)package\.json$/;
const TEST_FILE = /(?:\.(?:spec|test|e2e-spec|integration-spec|contract-spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|e2e)\/)/;
const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?\S*(?:sh|bash|zsh|dash)\b/;
const NAMED_SCRIPT = /\.\w+$/;

/** The kind of text `file` holds for the markers: 'code', 'shell' (hooks, scripts), 'workflow', 'dockerfile', 'manifest', or null. `text` lets an extensionless file with a shell shebang count as a script. */
export function bypassFileKind(file: string, text = ''): BypassFileKind | null {
  if (SHELL_FILE.test(file)) return 'shell';
  if (WORKFLOW_FILE.test(file)) return 'workflow';
  if (DOCKERFILE.test(file)) return 'dockerfile';
  if (MANIFEST_FILE.test(file)) return 'manifest';
  if (CODE_FILE.test(file)) return 'code';
  return !NAMED_SCRIPT.test(file.slice(file.lastIndexOf('/') + 1)) && SHEBANG.test(text) ? 'shell' : null;
}

/** The text of a shell line without the read-only git queries in its `$(...)` and backticks: `|| true` inside one is a query, not a bypass. */
const QUERY = String.raw`git\s+(?:tag|rev-parse|config|ls-files|describe|log|show|status|branch|remote|diff|symbolic-ref|rev-list)\b[^()\`]*`;
const withoutSubstitutions = (line: string): string => line.replace(new RegExp(String.raw`\$\(\s*${QUERY}\)`, 'g'), '').replace(new RegExp(String.raw`\`\s*${QUERY}\``, 'g'), '');

const labelsOf = (pairs: readonly Labelled[], text: string): string[] => pairs.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);

/** The labels of the bypass markers on one `line` of a shell, Dockerfile or workflow file ([] when none). */
function textLabelsOf(kind: BypassFileKind, line: string): string[] {
  const text = withoutSubstitutions(line);
  if (/^\s*#/.test(text)) return [];
  const own: Labelled[] = kind === 'workflow' ? WORKFLOW_PATTERNS : [];
  return [...labelsOf(SWALLOW, text), ...labelsOf(own, text)];
}

const CONSTANT_FALSE = /^\s*(?:-\s+)?if:\s*(?:\$\{\{\s*)?false\b/;
const CHECK_STEP = /(?:run|uses|name):[^\n]*(?:test|lint|check|audit|tsc|coverage|sonar|codecov|jest|eslint|stylelint|prettier|verify|scan)/i;

/** A job or a check step of a workflow that a constant false condition keeps from running (a setup step disabled for an app without build values is none). */
function disabledHits(text: string): BypassHit[] {
  const lines = text.split('\n');
  const hits: BypassHit[] = [];
  lines.forEach((content, index) => {
    if (!CONSTANT_FALSE.test(content)) return;
    const indent = content.search(/\S/);
    const label = 'a constant false condition';
    if (indent === 4) { hits.push({ line: index + 1, label, text: content.trim() }); return; }
    let start = index;
    while (start > 0 && !/^\s*-\s/.test(lines[start] as string) && (lines[start] as string).search(/\S/) >= indent) start -= 1;
    let end = index + 1;
    while (end < lines.length && ((lines[end] as string).trim() === '' || (lines[end] as string).search(/\S/) >= indent) && !/^\s*-\s/.test(lines[end] as string)) end += 1;
    if (CHECK_STEP.test(lines.slice(start, end).join('\n'))) hits.push({ line: index + 1, label, text: content.trim() });
  });
  return hits;
}

/** A job-level `if: always()` of a workflow that never reads a result of the jobs it needs. */
function alwaysHits(text: string): BypassHit[] {
  const reads = /needs\.[\w-]+\.result|needs\.\*|toJSON\(needs\)/.test(text);
  return text.split('\n').flatMap((content, index) => (/^ {4}if:\s*(?:\$\{\{\s*)?always\(\)/.test(content) && !reads
    ? [{ line: index + 1, label: 'always() without reading the results of the needed jobs', text: content.trim() }] : []));
}

/** The directive a comment line is, or null: a suppression word opens its comment; the Sonar word may stand anywhere in one. */
function commentDirective(comment: LexComment, opening: boolean): string | null {
  const inline = comment.block ? INLINE_CONFIG.exec(comment.text)?.[1]?.trim() : undefined;
  const open = opening ? (DIRECTIVE.exec(comment.text)?.[1] ?? inline) : null;
  const closing = comment.last ? TYPE_ESCAPES.find((word) => comment.text.replace(/^[\s*]+/, '').startsWith(word)) : null;
  return open ?? closing ?? (comment.text.includes(SONAR_WORD) ? SONAR_WORD : null);
}

/** The comments with the line a directive may open: the first non-blank line of each comment. */
function commentHits(comments: readonly LexComment[]): BypassHit[] {
  let waiting = false;
  return comments.flatMap((comment) => {
    if (comment.first) waiting = true;
    const opening = waiting && comment.text.trim() !== '';
    if (opening) waiting = false;
    const directive = commentDirective(comment, opening);
    return directive ? [{ line: comment.line, label: directive, text: comment.text.trim() }] : [];
  });
}

const OPENERS = '([{';
const CLOSERS = ')]}';

/** The index of the bracket that encloses `at` in the blanked `code` (walking back, skipping balanced pairs), or -1. */
function enclosingOpen(code: string, at: number): number {
  let depth = 0;
  for (let index = at; index >= 0; index -= 1) {
    if (CLOSERS.includes(code.charAt(index))) depth += 1;
    else if (OPENERS.includes(code.charAt(index)) && depth === 0) return index;
    else if (OPENERS.includes(code.charAt(index))) depth -= 1;
  }
  return -1;
}

/** The index of the `]` that closes the `[` at `open`, or -1. */
function closingBracket(code: string, open: number): number {
  let depth = 0;
  for (let index = open + 1; index < code.length; index += 1) {
    if (code[index] === '[') depth += 1;
    else if (code[index] === ']' && depth === 0) return index;
    else if (code[index] === ']') depth -= 1;
  }
  return -1;
}

/** The offsets of the brackets of the array that holds `at` in the blanked `code`, or null when no array does. */
function arrayAround(code: string, at: number): [number, number] | null {
  const open = enclosingOpen(code, at);
  if (open < 0 || code[open] !== '[') return null;
  const close = closingBracket(code, open);
  return close < 0 ? null : [open, close];
}

/** Whether the string `piece` hands git the hook-skipping flag: a git command line, or an element of an array that also names a git verb. */
function skipsHooks(piece: LexString, code: string, strings: readonly LexString[]): boolean {
  if (GIT_COMMAND.test(piece.text) || GIT_LINE_WITH_MESSAGE.test(piece.text)) return true;
  if (piece.text.trim() !== '--no-verify') return false;
  const around = arrayAround(code, piece.at);
  return around !== null && strings.some((other) => other.at > around[0] && other.at < around[1] && GIT_VERBS.has(other.text));
}

/** Words after which a `[` opens an array literal, not a member access. */
const BEFORE_ARRAY_LITERAL = /(?:^|[^\w$.])(?:return|typeof|in|of|case|yield|await|void|new|delete|else|do|throw|default|extends)$/;

/**
 * A test marker spelled as an index (`describe['skip']`): a string equal to a marker that is the whole key of a member access,
 * `[` before it after an expression and `]` right after it. An array element (`["skip", "idea"]`, `const kinds = ['only']`) is data.
 */
function indexedMarker(piece: LexString, code: string): boolean {
  if (!TEST_KEYS.has(piece.text)) return false;
  const before = code.slice(0, piece.at).trimEnd();
  if (!before.endsWith('[') || !code.slice(piece.at + piece.text.length).trimStart().startsWith(']')) return false;
  const subject = before.slice(0, -1).trimEnd();
  return /[\w$)\]]$/.test(subject) && !BEFORE_ARRAY_LITERAL.test(subject);
}

/** An `exit` handler of the process that resets the exit code or swallows the failure. */
function exitHandler(piece: LexString, code: string): boolean {
  if (!EXIT_EVENTS.has(piece.text)) return false;
  const before = code.slice(Math.max(0, piece.at - 24), piece.at);
  return /process\s*\.\s*(?:on|once)\(\s*['"]?$/.test(before) && resetsExit(code.slice(piece.at + piece.text.length + 1, piece.at + piece.text.length + 200));
}

function stringHits(strings: readonly LexString[], code: string): BypassHit[] {
  const hits: BypassHit[] = [];
  for (const piece of strings) {
    piece.text.split('\n').forEach((content, offset) => {
      for (const label of labelsOf(COMMAND_SWALLOW, withoutSubstitutions(content))) hits.push({ line: piece.line + offset, label, text: content.trim() });
    });
    if (skipsHooks(piece, code, strings)) hits.push({ line: piece.line, label: '--no-verify', text: piece.text.trim() });
    if (/\bHUSKY\b/.test(code.slice(Math.max(0, piece.at - 12), piece.at)) && /^["']?0$/.test(piece.text.trim())) hits.push({ line: piece.line, label: join('HUSKY', '=0'), text: piece.text });
  }
  return hits;
}

/** The exit patterns of a script, matched over the whole code (a try block and the call that follows it span lines). */
function exitHits(code: string, sourceLines: readonly string[]): BypassHit[] {
  return EXIT_PATTERNS.flatMap(([pattern, label]) => [...code.matchAll(new RegExp(pattern.source, 'g'))].map((match): BypassHit => {
    const line = splitLines(code.slice(0, match.index)).length;
    return { line, label, text: (sourceLines[line - 1] ?? '').trim() };
  }));
}

function codeHits(file: string, text: string): BypassHit[] {
  const { code, comments, strings } = lexSource(text, langOf(file));
  const sourceLines = splitLines(text);
  const spec = TEST_FILE.test(file);
  const hits = commentHits(comments);
  const tests = spec ? [...ANYWHERE_TESTS, ...SPEC_TESTS] : ANYWHERE_TESTS.slice(0, 2);
  splitLines(code).forEach((content, index) => {
    for (const label of labelsOf(tests, content)) hits.push({ line: index + 1, label, text: (sourceLines[index] ?? '').trim() });
  });
  if (!spec) hits.push(...exitHits(code, sourceLines));
  for (const piece of strings) {
    if (spec && indexedMarker(piece, code)) hits.push({ line: piece.line, label: 'a skipped or focused test', text: piece.text });
    if (!spec && exitHandler(piece, code)) hits.push({ line: piece.line, label: 'a process exit handler that resets the exit code', text: piece.text });
  }
  const seen = new Set<number>();
  return [...hits, ...stringHits(strings, code)].sort((x, y) => x.line - y.line).filter((hit) => !seen.has(hit.line) && seen.add(hit.line));
}

/** package.json: every command a shell runs (scripts, lint-staged, husky, simple-git-hooks) and a tool config kept outside its own file. */
const COMMAND_KEYS = ['scripts', 'lint-staged', 'husky', 'simple-git-hooks'];
const TOOL_BLOCKS = ['jest', 'eslintConfig', 'stylelint'];

function commandStrings(value: unknown, name: string): [string, string][] {
  if (typeof value === 'string') return [[name, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => commandStrings(inner, Array.isArray(value) ? name : key));
}

function manifestHits(text: string): BypassHit[] {
  let doc: Record<string, unknown> | null;
  try { doc = JSON.parse(text); } catch { return []; }
  const lines = text.split('\n');
  const lineOf = (name: string): number => lines.findIndex((line) => line.includes(JSON.stringify(name))) + 1;
  const commands = COMMAND_KEYS.flatMap((key) => commandStrings(doc?.[key], key));
  const hits = commands.flatMap(([name, command]) => labelsOf(SWALLOW, withoutSubstitutions(command)).map((label) => ({ line: lineOf(name), label, text: command.trim() })));
  const blocks = TOOL_BLOCKS.filter((key) => doc?.[key] !== undefined).map((key) => ({ line: lineOf(key), label: `a ${key} config kept in package.json`, text: key }));
  return [...hits, ...blocks];
}

/**
 * Every bypass marker of the text of one file: [{line, label, text}] (line numbers from 1). The file's kind decides the patterns;
 * a file of no kind has none.
 */
export function bypassesIn(file: string, text: string): BypassHit[] {
  const kind = bypassFileKind(file, text);
  if (!kind || typeof text !== 'string') return [];
  if (kind === 'code') return codeHits(file, text);
  if (kind === 'manifest') return manifestHits(text);
  const hits = text.split(/\r?\n/).flatMap((content, index) => textLabelsOf(kind, content).map((label) => ({ line: index + 1, label, text: content.trim() })));
  return kind === 'workflow' ? [...hits, ...alwaysHits(text), ...disabledHits(text)] : hits;
}

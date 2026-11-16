// failure-class.mts - BE_FAILURE_CLASS_BY_TEXT (R432): whether a failure is transient or permanent is decided by one judge only,
// `classifyFailure` of @starci/nest-kit, which reads an explicit `failureClass` the error carries first (contexts/code/be/resilience.md
// BE-RESILIENCE-2). App code that needs another class sets `failureClass` on the error it throws; it never matches the code or the message
// of an error against the texts a dropped connection, a timeout or a lock conflict carries, since a second list drifts from the judge's and a
// message is no contract. The check reads the back end's source (`src/**`, not a spec, a declaration or a test folder) for a string or
// template literal that is one of those codes, or a regular expression literal that names one; each is a finding at its line. The codes are
// the judge's own list (`TRANSIENT_CODES` of packages/nest-kit/src/failure.ts) and the other system and driver codes of the same failures.
import { found, readText } from './read.mjs';
import type { Finding } from './rule-types.mjs';

export const BE_FAILURE_CLASS_BY_TEXT = 'BE_FAILURE_CLASS_BY_TEXT';

/** The failure codes a hand-written classification matches: the judge's list (owner: @starci/nest-kit src/failure.ts) and their siblings. */
const TRANSIENT_TEXTS = ['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', '40001', '40P01', '55P03', '57P01', '53300'];
const CODES = TRANSIENT_TEXTS.join('|');
/** A quoted literal that is exactly one code. */
const QUOTED = new RegExp(String.raw`(['"\x60])(${CODES})\1`, 'u');
/** A regular expression literal (after `(`, `=`, `,`, `:`, `!`, `&`, `|`, `?`, `{`, `;` or a line start) that names a code. */
const PATTERN = new RegExp(String.raw`(?:^|[(=,:!&|?{;]\s*)\/(?![/*])(?:\\.|[^/\n])*\b(${CODES})\b(?:\\.|[^/\n])*\/[a-z]*`, 'u');

/** A back-end source file the check reads: TypeScript under src/, not a spec, a declaration or a test-support file. */
const isSource = (file: string): boolean => /^src\/.+\.[cm]?ts$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)
  && !/(?:\.|-)spec\.[cm]?ts$/u.test(file) && !/(?:^|\/)(?:test|test-support|__tests__)\//u.test(file);

/** The text of one line without its `//` comment, and a line that only continues a block comment as empty. */
const codeOf = (line: string): string => (/^\s*(?:\*|\/\*)/u.test(line) ? '' : line.replace(/(^|[^:"'`\\])\/\/.*$/u, '$1'));

/** R432 findings of the back end's tracked files (`files` relative to the side folder `repoRoot`). */
export function failureClassFindings({ repoRoot, files }: { repoRoot: string; files: readonly string[] }): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!isSource(file)) continue;
    const text = readText(repoRoot, file);
    if (text === null) continue;
    text.split(/\r?\n/u).forEach((raw, index) => {
      const line = codeOf(raw);
      const hit = QUOTED.exec(line)?.[2] ?? PATTERN.exec(line)?.[1];
      if (hit === undefined) return;
      findings.push(found(BE_FAILURE_CLASS_BY_TEXT, file, `${file}:${String(index + 1)} matches the failure text ${hit} to decide what a failure is; transient or permanent is decided only by classifyFailure of @starci/nest-kit, so throw the error with an explicit failureClass ("transient", "input", "config" or "code") and let the job runner judge it`, { line: index + 1, text: hit }));
    });
  }
  return findings;
}

// error-tail.mts - the one answer to "its output is withheld": when a stack command fails and its output may hold secrets, the failure still names
// WHY it failed, as an error-only, redacted tail (PROJECT-STACKS-15). Only lines that read as an error survive: an Error or exception line, a stack
// frame, a Nest "can't resolve dependencies" block with its potential solutions; every value of the opened secret set is masked first (raw, URL-encoded and JSON-escaped), then
// the shared redaction (URL credentials, tokens, KEY=value of a secret name) runs, so a line never carries a value. The raw output, an env dump
// and the lines that are not errors are never printed.
import { MARK, redactText } from './redact.mjs';

/** The most lines a tail prints, counted from the first error line: the first error of a run is its cause, the lines after it are its message block and frames. */
export const TAIL_LIMIT = 14;
/** The longest a printed line may be; the rest is cut so a minified bundle or a serialized object never fills the log. */
const LINE_LIMIT = 240;
/** The shortest secret value that is masked: a one or two character value is not a secret and would shred every word it appears in. */
const MIN_SECRET = 3;
/** What an error line is: a named error or exception, a stack frame, the Nest wiring messages, a missing module, a failed promise. */
const ERROR_LINE = /(?:\b\w*(?:Error|Exception)\b|\bUnhandled(?:Promise)?Rejection|^\s+at\s|can'?t resolve dependencies|cannot export a provider|Cannot find module|\bERR_[A-Z_]+|\bECONN[A-Z]+|Please make sure that the argument|Potential solutions|^\s*-\s+(?:Is|If)\s)/u;
/** An environment dump line (`NAME=value`): never printed, whatever else it says. */
const ENV_LINE = /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*=/u;

/** The forms a secret value may appear in inside a log: as is, percent-encoded and JSON-escaped. */
const formsOf = (value: string): string[] => [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])].filter((form) => form.length >= MIN_SECRET);

/** `text` with every value of `secrets` replaced by the redaction mark, the longest first so a value inside another does not leave a stub. */
export function maskValues(text: string, secrets: Iterable<string>): string {
  const forms = [...new Set([...secrets].filter((value) => typeof value === 'string').flatMap(formsOf))].sort((a, b) => b.length - a.length);
  return forms.reduce((out, form) => out.split(form).join(MARK), text);
}

/**
 * The error-only, redacted tail of a failed command's output: the first TAIL_LIMIT lines of `stderr` then `stdout` that read as an error, each
 * masked of every value in `secrets` and redacted, cut to LINE_LIMIT. Empty when no line reads as an error, so a command that failed silently prints nothing.
 */
export function errorTail(output: { readonly stdout?: string | undefined; readonly stderr?: string | undefined }, secrets: Iterable<string> = []): string[] {
  // masked as one text, before any line is cut: a value that spans lines (a key) never survives as halves
  const masked = maskValues(`${output.stderr ?? ''}\n${output.stdout ?? ''}`, secrets);
  return masked.split(/\r?\n/u)
    .map((line) => redactText(line).trimEnd())
    .filter((line) => line.trim() !== '' && ERROR_LINE.test(line) && !ENV_LINE.test(line))
    .map((line) => (line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)}...` : line))
    .slice(0, TAIL_LIMIT);
}

/** The words that follow a failure's `its output is withheld`: the tail, indented under it, or nothing when no line reads as an error. */
export function withTail(message: string, output: Parameters<typeof errorTail>[0], secrets: Iterable<string> = []): string {
  const tail = errorTail(output, secrets);
  return tail.length === 0 ? message : `${message}\nerror lines of its output (secret values masked):\n${tail.map((line) => `  ${line}`).join('\n')}`;
}

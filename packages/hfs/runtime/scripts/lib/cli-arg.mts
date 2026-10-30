// cli-arg.mjs — the `--name value` and `--flag` readers of the thin CLI entries (the scripts/api call files run as
// commands, scripts/agent/send.mjs). Pure.
import { textLine } from './escape.mjs';

/** The value after `--<name>` in argv, else `fallback`. */
export const arg = <F = null,>(argv: readonly string[], name: string, fallback: F = null as F): string | undefined | F => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

/** True when argv holds `--<name>`. */
export const flag = (argv: readonly string[], name: string): boolean => argv.includes(`--${name}`);

/** The token after the literal `token` in argv, else `fallback` (absent or last). */
export const valueAfter = <F = null,>(argv: readonly string[], token: string, fallback: F = null as F): string | F => {
  const i = argv.indexOf(token);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] as string) : fallback;
};

/** A setter of a multi-option CLI: `take()` consumes the next token as the option's value. */
export type OptSetter<O> = (opts: O, take: () => string) => void;

/**
 * The `--name value` / boolean-flag scan the multi-option CLIs share: `spec` maps each accepted token to a setter
 * `(opts, take)` where `take()` consumes the next token as the value (a missing one reports
 * `<token> needs a value` through `fail`); boolean flags are setters that never call `take`. An unrecognized
 * token reports `unrecognized argument: <token>` through `fail` (its return is ignored, so a non-throwing `fail`
 * keeps scanning). Returns `opts`.
 */
export function parseOpts<O extends object>(argv: readonly string[], spec: Readonly<Record<string, OptSetter<O>>>, fail: (message: string) => unknown): O {
  const opts = {} as O;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    const set = spec[token];
    if (!set) { fail(`unrecognized argument: ${token}`); continue; }
    const take = (): string => {
      i += 1;
      if (argv[i] === undefined) fail(`${token} needs a value`);
      return argv[i] as string;
    };
    set(opts, take);
  }
  return opts;
}

/**
 * The `--<name> value` pairs of `names` read from argv: every other token, a missing value and a `--`-led value throw
 * an error suffixed with `usage`.
 */
export const valueFlags = (argv: readonly string[], names: readonly string[], usage: string): Record<string, string> => {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (names.includes(arg)) {
      if (argv[i + 1] === undefined || (argv[i + 1] as string).startsWith('--')) throw new Error(`${arg} needs a value; ${usage}`);
      opts[arg.slice(2)] = argv[++i] as string;
    } else throw new Error(`unknown argument ${arg}; ${usage}`);
  }
  return opts;
};

/** A parseOpts `fail` that throws `Error(message)`. */
export const argThrow = (message: string): never => { throw new Error(message); };

/** Throw `Error('--<name> is required')` for the first of `names` `args` lacks a value for. */
export const needArgs = (args: Readonly<Record<string, unknown>>, names: readonly string[]): void => {
  for (const name of names) if (!args[name]) throw new Error(`--${name} is required`);
};

/** The options of the `.starciwork`-record CLIs. */
export interface WorkRecordOpts { work?: string; record?: string; cwd?: string }

/** Setter entries the `.starciwork`-record CLIs share: `--work <dir> --record <id> --cwd <dir>`. */
export const workRecordSpec: Readonly<Record<string, OptSetter<WorkRecordOpts>>> = {
  '--work': (o, take) => { o.work = take(); },
  '--record': (o, take) => { o.record = take(); },
  '--cwd': (o, take) => { o.cwd = take(); },
};

/** `--work --record --cwd` for the example-record CLIs; throws on an unknown token or a missing value. */
export function parseExampleArgs(argv: readonly string[]): Required<WorkRecordOpts> {
  const args = parseOpts<WorkRecordOpts>(argv, workRecordSpec, argThrow);
  needArgs(args as Record<string, unknown>, ['work', 'record', 'cwd']);
  return args as Required<WorkRecordOpts>;
}

/** The options of the record-scoped op CLIs. */
export interface OpRecordOpts { op?: string; records?: string[]; state?: string; json?: boolean }

/** Setter entries the record-scoped op CLIs share: `--op`, `--records` (csv, accumulated), `--state`, `--json`, `--help`/`-h` (calls `help`). */
const opRecordSpec = (help: () => void): Record<string, OptSetter<OpRecordOpts>> => ({
  '--op': (o, take) => { o.op = take(); },
  '--records': (o, take) => { o.records = [...(o.records ?? []), ...take().split(',')]; },
  '--state': (o, take) => { o.state = take(); },
  '--json': (o) => { o.json = true; },
  '--help': () => help(), '-h': () => help(),
});

/** The final value of an accumulated `--records` list: trimmed, blanks dropped, deduplicated. */
const recordsList = (args: OpRecordOpts): string[] => [...new Set((args.records ?? []).map((s) => s.trim()).filter(Boolean))];

/**
 * The `usage` + `parseArgs` pair the record-scoped op CLIs share: `usage` prints `usageText` to stderr and exits
 * with the code; `parseArgs` scans the opRecordSpec options plus the CLI's own `spec` setters and resolves
 * `records` to its deduplicated list (recordsList).
 */
export function opCli<O extends OpRecordOpts = OpRecordOpts>(usageText: string, spec: Readonly<Record<string, OptSetter<O>>>): { usage: (code: number) => never; parseArgs: (argv: readonly string[]) => O & { records: string[] } } {
  const usage = (code: number): never => { console.error(usageText); return process.exit(code); };
  const parseArgs = (argv: readonly string[]): O & { records: string[] } => {
    const a = parseOpts<O>(argv, { ...opRecordSpec(() => usage(0)), ...spec } as Record<string, OptSetter<O>>, () => usage(2));
    a.records = recordsList(a);
    return a as O & { records: string[] };
  };
  return { usage, parseArgs };
}

/**
 * The prelude the multi-verb lesson CLIs share (scripts/machine/lessons.mjs, scripts/supervisor/lesson-actions.mjs):
 * `verb` is argv[0]; `value(n)` the token after `--n` (null when absent); `csv(v)` a trimmed non-empty list;
 * `print(result, human)` logs the JSON record under `--json`, else the human text: one string is one line, an array
 * holds one element per line; control characters inside a line (CR, LF, escape sequences) print as \uXXXX.
 */
export function verbCli(argv: string[] = process.argv.slice(2)): { argv: string[]; verb: string | undefined; value: (n: string) => string | null; csv: (v: unknown) => string[]; asJson: boolean; print: (r: unknown, human: string | readonly string[]) => void } {
  const value = (n: string): string | null => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? null : null; };
  const csv = (v: unknown): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const asJson = argv.includes('--json');
  const print = (r: unknown, human: string | readonly string[]): void => console.log(asJson ? JSON.stringify(r) : [human].flat().map((line) => textLine(line)).join('\n'));
  return { argv, verb: argv[0], value, csv, asJson, print };
}

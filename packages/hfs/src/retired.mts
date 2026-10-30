// The retired spellings of `starci app` (owner ruling cli-canonical-2026-10-30, contexts/harness/cli-canonical.md "App layer"),
// the app-layer twin of the harness CLI's cli/src/shared/retired.ts: the same row shape, the same switch, the same notice and
// refusal. main.mts rewrites every command line through rewriteRetired before it picks the verb, so each verb's parser only
// ever sees the canonical spelling. The rows live in one file per area (retired-stack, retired-data, retired-app), concatenated
// here, so the areas never edit the same file.
import { RETIRED_APP_FLAGS, RETIRED_APP_VERBS } from './retired-app.mjs';
import { RETIRED_DATA_FLAGS, RETIRED_DATA_VERBS } from './retired-data.mjs';
import { RETIRED_STACK_FLAGS, RETIRED_STACK_VERBS } from './retired-stack.mjs';

/**
 * Whether a retired spelling is refused. Off, the parser accepts it, rewrites it to its new spelling and prints one notice on
 * stderr naming the new one; on, it refuses it (exit 2) with the row's code and recovery line. The owner turns it on with the
 * harness CLI's switch, once the app nivo-lite has deployed on the new spellings; a removed verb (`now` null) has nothing to map
 * to and is refused either way.
 */
export const REFUSE_RETIRED_SPELLINGS = false;

/** A retired flag of one verb: its old spelling, the new one (null: dropped, effects being dry by default), how its value moves. */
export interface RetiredFlag {
  readonly old: string;
  readonly now: string | null;
  /** Whether the old flag takes a value (the next token, or `--old=value`). */
  readonly value: boolean;
  /** Divides a numeric value on the way (milliseconds to seconds: 1000). */
  readonly divide?: number;
  /** Only this value of the old flag is retired (`--format json`); the flag with any other value passes untouched. */
  readonly when?: string;
  /** The old flag's value is dropped on the way, the new flag being a boolean (`--format json` gives `--json`). */
  readonly bare?: boolean;
}

/** A retired verb path (`explain`, `stack up`): the spelling that replaces it (null: removed), the tokens it adds, its own flag renames. */
export interface RetiredVerb {
  /** The verb and, where the retired spelling is one action of it, that action: one or two leading operands. */
  readonly old: readonly string[];
  readonly now: readonly string[] | null;
  /** Tokens added after the new path (`check --staged`). */
  readonly adds?: readonly string[];
  /**
   * The flag the old spelling's first operand after its path becomes (`secret set <env> ...` gives `--env <env>`). Applied only
   * when that flag is not given already; a row whose path does not change (`old` equals `now`) matches only then.
   */
  readonly operand?: string;
  /** Flags of the old verb renamed on the way, applied before `adds` so an added flag is never renamed. */
  readonly flags?: readonly RetiredFlag[];
  readonly code: string;
  readonly recovery: string;
}

/** The retired flags of one canonical verb, each with its refusal code and recovery line. */
export interface RetiredFlagRow extends RetiredFlag {
  /** The leading operands the row applies under (`stack` every stack action, `stack deploy` that action alone). */
  readonly verb: string;
  readonly code: string;
  readonly recovery: string;
}

/** Every retired verb spelling of `starci app` (the rewrite tries the longest path first, so `stack up` before `stack`). */
export const RETIRED_VERBS: readonly RetiredVerb[] = [...RETIRED_STACK_VERBS, ...RETIRED_DATA_VERBS, ...RETIRED_APP_VERBS];

/** Every retired flag spelling of a canonical `starci app` verb. */
export const RETIRED_FLAGS: readonly RetiredFlagRow[] = [...RETIRED_STACK_FLAGS, ...RETIRED_DATA_FLAGS, ...RETIRED_APP_FLAGS];

/** The refusal of a retired spelling: main prints `<code>: <message>` and exits 2. */
export class RetiredSpelling extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RetiredSpelling';
    this.code = code;
  }
}

/** The tables a rewrite reads: every retired verb path and every retired flag. */
export interface RetiredRows {
  readonly verbs: readonly RetiredVerb[];
  readonly flags: readonly RetiredFlagRow[];
}

/** What the rewrite made of a command line: the argv the verbs read, and one notice per retired spelling it mapped. */
export interface Rewritten {
  readonly argv: string[];
  readonly notices: string[];
}

/** The operands before the first option: the verb and its action (and, for a positional verb, its operands). */
const leading = (tokens: readonly string[]): string[] => {
  const first = tokens.findIndex((token) => token.startsWith('-'));
  return first < 0 ? [...tokens] : tokens.slice(0, first);
};

const startsWith = (tokens: readonly string[], prefix: readonly string[]): boolean => prefix.length > 0 && prefix.every((token, at) => tokens[at] === token);

const scaled = (value: string, divide: number | undefined): string => (divide === undefined ? value : String(Number(value) / divide));

/** One flag rename over the tokens after the path; returns the tokens and whether the old spelling was there. */
const renameFlag = (tokens: readonly string[], flag: RetiredFlag): { tokens: string[]; hit: boolean } => {
  const out: string[] = [];
  let hit = false;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at] ?? '';
    const inline = flag.value && token.startsWith(`${flag.old}=`);
    if (token !== flag.old && !inline) {
      out.push(token);
      continue;
    }
    if (!flag.value) {
      hit = true;
      if (flag.now !== null) out.push(flag.now);
      continue;
    }
    const value = inline ? token.slice(flag.old.length + 1) : tokens[at + 1];
    if (flag.when !== undefined && value !== flag.when) {
      out.push(token);
      continue;
    }
    hit = true;
    if (!inline) at += 1;
    if (flag.now === null) continue;
    out.push(...(flag.bare === true || value === undefined ? [flag.now] : [flag.now, scaled(value, flag.divide)]));
  }
  return { tokens: out, hit };
};

/** Whether `--name` (or `--name=value`) stands among the tokens. */
const hasFlag = (tokens: readonly string[], name: string): boolean => tokens.some((token) => token === name || token.startsWith(`${name}=`));

const spelled = (tokens: readonly string[]): string => tokens.join(' ');

/** The one line a retired spelling answers: the notice while it maps, the refusal once refusal is on or when nothing replaces it. */
const retiredLine = (old: string, now: string | null): string => (now === null ? `"${old}" is retired` : `"${old}" is retired; it runs as "${now}" for now`);

/** Whether a verb row matches the leading operands: its path, and for an unchanged path the operand it turns into a flag. */
const verbMatches = (row: RetiredVerb, tokens: readonly string[]): boolean => {
  const lead = leading(tokens);
  if (!startsWith(lead, row.old)) return false;
  const renamed = row.now === null || spelled(row.now) !== spelled(row.old);
  if (renamed) return true;
  return row.operand !== undefined && !hasFlag(tokens, row.operand) && lead.length > row.old.length;
};

/**
 * Rewrites the retired spellings of a `starci app` command line (the tokens after the global options, the verb first, before
 * any `--`) into their new spelling, one notice per rewrite; with `refuse` (REFUSE_RETIRED_SPELLINGS) the first one is refused
 * instead, with its row's code and recovery line. A removed verb is refused whatever `refuse` says. `rows` replaces the tables
(a spec's own rows); at most one verb row applies, then every flag row of the path it leaves.
 */
export const rewriteRetired = (argv: readonly string[], refuse: boolean = REFUSE_RETIRED_SPELLINGS, rows: RetiredRows = { verbs: RETIRED_VERBS, flags: RETIRED_FLAGS }): Rewritten => {
  const dashes = argv.indexOf('--');
  const theirs = dashes >= 0 ? argv.slice(dashes) : [];
  let tokens = dashes >= 0 ? argv.slice(0, dashes) : [...argv];
  const notices: string[] = [];
  const fail = (code: string, old: string, recovery: string): never => {
    throw new RetiredSpelling(code, `${retiredLine(old, null)}: ${recovery}`);
  };
  const verbRow = [...rows.verbs].sort((left, right) => right.old.length - left.old.length).find((row) => verbMatches(row, tokens));
  if (verbRow !== undefined) {
    let rest = tokens.slice(verbRow.old.length);
    const usesOperand = verbRow.operand !== undefined && !hasFlag(rest, verbRow.operand) && rest[0] !== undefined && !rest[0].startsWith('-');
    const old = spelled([...verbRow.old, ...(usesOperand ? [`<${verbRow.operand?.slice(2)}>`] : [])]);
    if (verbRow.now === null || refuse) fail(verbRow.code, old, verbRow.recovery);
    const now = verbRow.now ?? [];
    for (const flag of verbRow.flags ?? []) rest = renameFlag(rest, flag).tokens;
    if (usesOperand && verbRow.operand !== undefined) rest = [verbRow.operand, ...rest];
    tokens = [...now, ...(verbRow.adds ?? []), ...rest];
    const shown = [...now, ...(verbRow.adds ?? []), ...(usesOperand ? [`${verbRow.operand} <${verbRow.operand?.slice(2)}>`] : [])];
    notices.push(`starci app: ${retiredLine(old, spelled(shown))}`);
  }
  const lead = leading(tokens);
  for (const row of rows.flags) {
    const verb = row.verb.split(' ');
    if (!startsWith(lead, verb)) continue;
    const renamed = renameFlag(tokens.slice(verb.length), row);
    if (!renamed.hit) continue;
    const old = `${row.verb} ${row.old}${row.when === undefined ? '' : ` ${row.when}`}`;
    if (refuse) fail(row.code, old, row.recovery);
    tokens = [...tokens.slice(0, verb.length), ...renamed.tokens];
    notices.push(`starci app: ${retiredLine(old, row.now === null ? row.verb : `${row.verb} ${row.now}`)}`);
  }
  return { argv: [...tokens, ...theirs], notices };
};

/** The retired spellings as usage lines (`  explain -> slot`), indented so no line reads as a verb's own usage. */
export const retiredUsage = (): string[] => [
  ...RETIRED_VERBS.map((row) => `  ${spelled(row.old)}${row.operand === undefined ? '' : ` <${row.operand.slice(2)}>`} -> ${row.now === null ? '(removed)' : spelled([...row.now, ...(row.adds ?? []), ...(row.operand === undefined ? [] : [`${row.operand} <${row.operand.slice(2)}>`])])}`),
  ...RETIRED_FLAGS.map((row) => `  ${row.verb} ${row.old}${row.when === undefined ? '' : ` ${row.when}`} -> ${row.now === null ? `${row.verb} (dropped)` : `${row.verb} ${row.now}`}`),
];

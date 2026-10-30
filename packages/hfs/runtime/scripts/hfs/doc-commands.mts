import { validateArgs } from '../../packages/cli/src/validate-args.mjs';
import { isAlternation, isPlaceholder, tokenise, type CommandToken } from '../lib/command-tokens.mjs';

// The one owner of "a documented command exists": it finds every `starci <group> <verb> ...` a text shows to an agent or owner
// (extractCommands) and judges it the way the dispatcher would (checkCommand): group and verb exist, every flag is declared, enum
// values are valid, required flags and positionals are present unless the text is a fragment (a bare verb, a line that ends in an
// ellipsis, a flag mentioned on its own). The prose-commands self-check (check-prose-commands.mjs, R230) and the doc-command specs
// are callers: they choose the files and the reasons they enforce, never a second extractor.

/** One starci command occurrence in a text: `bounded` runs to the end of its span, `prose` keeps only the flags that follow the verb. */
export interface CommandOccurrence { line: number; mode: 'bounded' | 'prose'; preceded: string; text: string }
/** A whitespace token of a command (the command tokenizer's output). */
export type { CommandToken };
/** A declared flag of the command catalog. */
export interface CatalogFlag { name: string; type: string; enum?: string[]; [key: string]: unknown }
/** A declared positional of a verb. */
export interface CatalogPositional { name: string; enum?: string[]; [key: string]: unknown }
/** A verb of the command catalog. */
export interface CatalogVerb { flags?: CatalogFlag[]; positional?: CatalogPositional[]; [key: string]: unknown }
/** A group of the command catalog; `self` is set when the group word is itself the whole command. */
export interface CatalogGroup { self?: CatalogVerb; verbs: Record<string, CatalogVerb> }
/** The command catalog checkCommand reads. */
export interface CommandCatalog { global: CatalogFlag[]; groups: Record<string, CatalogGroup> }
/** The generated catalog's loaded form: { global: { flags }, groups: [{ group, verbs: [{ verb }] }] }. */
export interface LoadedCatalog { global: { flags: CatalogFlag[] }; groups: { group: string; verbs: ({ verb: string } & CatalogVerb)[] }[] }
/** The options of checkCommand, extractCommands. */
export interface ExtractOptions { kind?: string; skipLine?: ((line: string) => boolean) | null }

const IDENTIFIER = /^[a-z][a-z0-9-]*$/;
// a sentence that quotes a command only to say it is gone is not an instruction to run it
const RETIRED_SENTENCE = /^[^.;]*?\b(?:is|was|are|were)\s+(?:now\s+)?(?:gone|removed|retired|dropped)\b/;
// `starci history guard: refused ...`: a log label names no command
const LOG_LABEL = /^[\w-]+(?:\s+[\w-]+)?:(?:\s|$)/;
const ASKED = /\b(?:run|Run|execute|Execute)\s*$/;
const LIST_BULLET = /^\s*(?:[-*>$]\s*)*$/;
const NOT_A_COMMAND_HEAD = new Set(['help', '--help', '-h', '--version', 'completion']);
const SEPARATORS = new Set(['|', '||', '&&', ';', '>', '>>', '<', '&', '2>', '2>&1', '#', '\\', 'then', 'do', '-', '—', '–', '→', '←', '=>', '->', '-->', '=', '+', '/', 'and', 'or', 'to']);
const WORD_VALUE = /^[\w-]+$/;
const PROMPT_ASSIGNMENT = /^[A-Za-z_]+=\S*\s+/;
const OPERATORS = ['&&', '||', ';', '|', '('];
const KEYWORDS = ['then', 'do', 'sudo', 'exec'];

// a flag family (`--until-*`, `--until-<type>`, `--until-...`) names no single flag
const isEllipsis = (t: string): boolean => t === '...' || t === '…' || t.endsWith('...') || /^--[\w-]*(-\*|-<[^>]*>|-)$/.test(t) || /^[<[]?(options?|flags?|args?|arguments?|rest|more|etc)[>\]]?$/i.test(t);
const isOpaque = (t: string): boolean => isPlaceholder(t) || isEllipsis(t);
const alternatives = (t: string): string[] => (!/[<{$]/.test(t) && (t.includes('|') || (/^[a-z]/.test(t) && t.includes('/'))) ? t.split(/[|/]/) : [t]);
const inner = (t: string): string => t.replace(/^<|>$/g, '');

// ---- extraction -----------------------------------------------------------------------------------------------

const COMMAND_FORM = /npx\s+starci|npm\s+run\s+starci(?:\s+--silent)?(?:\s+--)?|starci/;
const COMMAND_AT = new RegExp(String.raw`(?<![\w@./:-])(?:${COMMAND_FORM.source})(?![\w@./-])(?=\s|$)`, 'g');
const FENCE = /^\s*(?:[-*>|]\s*)?```/;
const SCRIPT_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;
const CONTINUED = /\\\s*$/;
const SCRIPT_LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g;
const SPELLING_FIELD = /\bspelling:\s*$/;

// the text before a `starci` is a shell prompt and environment assignments only
function startsAtPrompt(before: string): boolean {
  let rest = before.trimStart();
  if (rest.startsWith('PS>')) rest = rest.slice(3).trimStart();
  else if (rest.startsWith('$') || rest.startsWith('>')) rest = rest.slice(1).trimStart();
  while (PROMPT_ASSIGNMENT.test(rest)) rest = rest.replace(PROMPT_ASSIGNMENT, '');
  return rest === '';
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);

// the text before a `starci` ends in a shell operator or a command keyword
function endsAtOperator(before: string): boolean {
  const head = before.trimEnd();
  if (OPERATORS.some((op) => head.endsWith(op))) return true;
  return KEYWORDS.some((word) => head.endsWith(word) && !isWordChar(head[head.length - word.length - 1]));
}

const isCommandPosition = (before: string): boolean => startsAtPrompt(before) || endsAtOperator(before);

// {body, end} of the code span that opens at `from` (a run of backticks closed by a run of the same length), or null
function spanAt(line: string, from: number): { body: string; end: number } | null {
  let run = 0;
  while (line[from + run] === '`') run += 1;
  for (let n = run; n >= 1; n -= 1) {
    const close = line.indexOf('`'.repeat(n), from + n);
    if (close > from + n) return { body: line.slice(from + n, close), end: close + n };
  }
  return null;
}

function spansOf(line: string): { spans: string[]; masked: string } {
  const spans: string[] = [];
  let masked = '';
  let i = 0;
  while (i < line.length) {
    const span = line[i] === '`' ? spanAt(line, i) : null;
    if (span === null) {
      masked += line[i] as string;
      i += 1;
    } else {
      spans.push(span.body);
      masked += ' '.repeat(span.end - i);
      i = span.end;
    }
  }
  return { spans, masked };
}

// Escapes of the host language (JSON/YAML/JS string literals) are not part of the command.
const unescape = (s: string): string => s.replace(/\\[nt]/g, ' ').replace(/\\(["'`])/g, '$1').replace(/\\$/, '');

// the line without its trailing ` # comment`
function withoutComment(code: string): string {
  for (let i = code.indexOf('#'); i >= 0; i = code.indexOf('#', i + 1)) {
    if (i > 0 && /\s/.test(code[i - 1] as string) && /\s/.test(code[i + 1] ?? '')) {
      let start = i - 1;
      while (start > 0 && /\s/.test(code[start - 1] as string)) start -= 1;
      return code.slice(0, start);
    }
  }
  return code;
}

// every `starci` of `body` as an occurrence {line, mode, preceded, text}; `modeOf(before)` names the mode
function occurrencesIn(body: string, line: number, modeOf: (before: string) => 'bounded' | 'prose', scan: string = body): CommandOccurrence[] {
  return [...scan.matchAll(COMMAND_AT)].map((m) => {
    const before = body.slice(0, m.index);
    return { line, mode: modeOf(before), preceded: before, text: unescape(body.slice((m.index as number) + m[0].length)) };
  });
}

// a fenced line is a command where starci stands in command position; elsewhere it is a diagram or a sentence
const fencedMode = (before: string): 'bounded' | 'prose' => (isCommandPosition(before) ? 'bounded' : 'prose');

// the fenced line at `index` with its `\`-continued lines joined: {code, last}
function joinContinuations(lines: string[], index: number): { code: string; last: number } {
  let code = lines[index] as string;
  let last = index;
  while (CONTINUED.test(code) && last + 1 < lines.length && !/^\s*```/.test(lines[last + 1] as string)) {
    last += 1;
    code = `${code.replace(CONTINUED, ' ')}${(lines[last] as string).trimStart()}`;
  }
  return { code, last };
}

// the string literals of a script line, a retired spelling (`spelling: '...'`) kept so the dispatcher can refuse it excluded
const scriptLiterals = (line: string): string[] => [...line.matchAll(SCRIPT_LITERAL)].filter((m) => !SPELLING_FIELD.test(line.slice(0, m.index))).map((m) => m[2] as string);

function lineOccurrences(line: string, lineNo: number, kind: string): CommandOccurrence[] {
  const found: CommandOccurrence[] = [];
  for (const segment of kind === 'script' ? scriptLiterals(line) : [line]) {
    const { spans, masked } = spansOf(segment);
    for (const span of spans) found.push(...occurrencesIn(span, lineNo, () => 'bounded'));
    found.push(...occurrencesIn(masked, lineNo, () => 'prose'));
  }
  return found;
}

/**
 * Every starci command occurrence in one text.
 * `bounded` occurrences (inside a code span, a fenced line, or a script string literal span) run to the end of that
 * span; `prose` occurrences inside running text only keep the flags and values that follow the verb.
 */
export function extractCommands(text: string, { kind = 'text', skipLine = null }: ExtractOptions = {}): CommandOccurrence[] {
  const found: CommandOccurrence[] = [];
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (kind !== 'script' && FENCE.test(line)) fenced = !fenced;
    else if (!skipLine?.(line) && fenced) {
      const { code, last } = joinContinuations(lines, index);
      found.push(...occurrencesIn(code, index + 1, fencedMode, withoutComment(code)));
      index = last;
    } else if (!skipLine?.(line) && (kind !== 'script' || !SCRIPT_COMMENT.test(line))) {
      found.push(...lineOccurrences(line, index + 1, kind));
    }
    index += 1;
  }
  return found;
}

// ---- validation -----------------------------------------------------------------------------------------------

const sampleFor = (flag: CatalogFlag): string => {
  if (flag.type === 'enum') return (flag.enum as string[])[0] as string;
  if (flag.type === 'number') return '1';
  if (flag.type === 'boolean') return 'true';
  return 'x';
};

const globalFlagsBefore = (tokens: CommandToken[], globals: Map<string, CatalogFlag>): number => {
  let i = 0;
  while (i < tokens.length && (tokens[i] as CommandToken).text.startsWith('--')) {
    const g = globals.get((tokens[i] as CommandToken).text.slice(2).split('=')[0] as string);
    if (!g) break;
    i += g.type === 'boolean' || (tokens[i] as CommandToken).text.includes('=') ? 1 : 2;
  }
  return i;
};

function commandTokens(occurrence: CommandOccurrence): CommandToken[] {
  const tokens: CommandToken[] = tokenise((occurrence.text.split(/\s{3,}/)[0] as string).trim());
  const cut = tokens.findIndex((t: CommandToken) => SEPARATORS.has(t.text) || /^\d?>/.test(t.text) || t.text === 'starci');
  return cut >= 0 ? tokens.slice(0, cut) : tokens;
}

const isAsked = (occurrence: CommandOccurrence, strictProse: boolean): boolean => strictProse || ASKED.test(occurrence.preceded) || LIST_BULLET.test(occurrence.preceded);

// the findings of the group word(s) when they end the check ([] ends it silently), or null when the verb is next
function groupStop(occurrence: CommandOccurrence, groupAlts: string[], unknownGroups: string[], lenient: boolean): string[] | null {
  if (!groupAlts.every((g) => IDENTIFIER.test(g))) return [];
  if (unknownGroups.length > 0 && (lenient || LOG_LABEL.test(occurrence.text.trim()))) return [];
  return unknownGroups.length > 0 ? unknownGroups.map((g) => `unknown group "${g}"`) : null;
}

/** A call resolved to its group, verb(s) and the tokens after them. */
interface ResolvedCall { stop?: undefined; groupAlts: string[]; verbAlts: string[]; group: CatalogGroup; rest: CommandToken[]; globals: Map<string, CatalogFlag>; bounded: boolean }
/** The state read from a call's arguments. */
interface ArgState { argv: string[]; errors: string[]; valued: boolean; fragment: boolean; position: number }
/** What the argument readers need about the verb being checked. */
interface ArgContext { bounded: boolean; verb: CatalogVerb & { group: string; verb: string }; declared: Map<string, CatalogFlag>; schema: CatalogPositional[] }

// {stop: findings} when the occurrence ends before its flags, else the resolved call
function resolveCall(occurrence: CommandOccurrence, catalog: CommandCatalog, strictProse: boolean): ResolvedCall | { stop: string[] } {
  const bounded = occurrence.mode === 'bounded';
  const tokens = commandTokens(occurrence);
  const globals = new Map(catalog.global.map((f) => [f.name, f] as const));
  const i = globalFlagsBefore(tokens, globals);
  const head = tokens[i];
  if (!head || NOT_A_COMMAND_HEAD.has(head.text) || isOpaque(head.text)) return { stop: [] };
  const groupAlts = alternatives(head.text);
  const lenient = !bounded && !isAsked(occurrence, strictProse);
  const stopped = groupStop(occurrence, groupAlts, groupAlts.filter((g) => !catalog.groups[g]), lenient);
  if (stopped) return { stop: stopped };
  const group = catalog.groups[groupAlts[0] as string] as CatalogGroup;
  // a one-word verb (`starci explain [term]`): the group word is the whole command and the rest are its arguments
  if (group.self && groupAlts.length === 1) return { groupAlts, verbAlts: groupAlts, group: { verbs: { [groupAlts[0] as string]: group.self } }, rest: tokens.slice(i + 1), globals, bounded };
  const verbToken = tokens[i + 1];
  if (!verbToken || verbToken.text.startsWith('-') || isOpaque(verbToken.text)) return { stop: [] };
  const verbAlts = alternatives(verbToken.text);
  const unknownVerbs = verbAlts.filter((v) => !group.verbs[v]);
  if (lenient && unknownVerbs.length === verbAlts.length) return { stop: [] };
  if (unknownVerbs.length > 0) return { stop: unknownVerbs.map((v) => `unknown verb "${groupAlts[0]} ${v}"`) };
  return { groupAlts, verbAlts, group, rest: tokens.slice(i + 2), globals, bounded };
}

// alternatives of groups or verbs: only the flag names are provable
function alternativeErrors(call: ResolvedCall): string[] {
  const errors: string[] = [];
  for (const t of call.rest) {
    if (!t.text.startsWith('--')) continue;
    for (const n of alternatives(t.text).map((a) => a.replace(/^--/, '').split('=')[0] as string)) {
      const some = call.verbAlts.some((v) => call.group.verbs[v]?.flags?.some((f) => f.name === n)) || call.globals.has(n);
      if (!some) errors.push(`--${n} is not a flag of ${call.groupAlts[0]} ${call.verbAlts.join('|')}`);
    }
  }
  return errors;
}

const enumChoices = (literal: string | null, value: string | null): string[] => {
  if (literal !== null) return alternatives(literal);
  return value !== null && isAlternation(value) ? inner(value).split('|') : [];
};

function pushFlagValue(st: ArgState, flag: CatalogFlag, name: string, value: string | null): void {
  const literal = value === null || isPlaceholder(value) ? null : value;
  if (flag.type !== 'enum') {
    st.argv.push(`--${name}`, flag.type === 'number' || literal === null ? sampleFor(flag) : literal);
    return;
  }
  for (const c of enumChoices(literal, value)) {
    if (WORD_VALUE.test(c) && !(flag.enum as string[]).includes(c)) st.errors.push(`--${name} expects one of: ${(flag.enum as string[]).join(', ')} (got ${c})`);
  }
  st.argv.push(`--${name}`, (flag.enum as string[])[0] as string);
}

// reads the flag at rest[k] (with its value) into `st`; returns the index of the last token it used
function readFlag(st: ArgState, rest: CommandToken[], k: number, ctx: ArgContext): number {
  const alts = alternatives((rest[k] as CommandToken).text).map((a) => a.replace(/^--/, ''));
  const first = alts[0] as string;
  const eq = first.indexOf('=');
  const name = eq >= 0 ? first.slice(0, eq) : first;
  const unknown = alts.map((a) => a.split('=')[0] as string).filter((an) => !ctx.declared.has(an));
  for (const an of unknown) st.errors.push(`unknown option --${an}`);
  if (unknown.length > 0) return k;
  const flag = ctx.declared.get(name) as CatalogFlag;
  if (flag.type === 'boolean') {
    st.argv.push(`--${name}`);
    return k;
  }
  let value: string | null | undefined = eq >= 0 ? first.slice(eq + 1) : undefined;
  let last = k;
  if (value === undefined) {
    const next = rest[k + 1];
    const takesNext = next && !next.text.startsWith('--') && !isEllipsis(next.text);
    value = takesNext ? (next as CommandToken).text : null;
    if (takesNext) last = k + 1;
  }
  if (value !== null) st.valued = true;
  pushFlagValue(st, flag, name, value);
  return last;
}

// the argv entry (and findings) of one positional token against its schema entry
function pushPositional(st: ArgState, text: string, entry: CatalogPositional | undefined): void {
  const alts = isAlternation(text) ? inner(text).split('|') : null;
  if (entry?.enum && alts) {
    for (const c of alts) {
      if (WORD_VALUE.test(c) && !entry.enum.includes(c)) st.errors.push(`${entry.name} expects one of: ${entry.enum.join(', ')} (got ${c})`);
    }
    st.argv.push(entry.enum[0] as string);
  } else if (isPlaceholder(text) || text.includes('|')) st.argv.push(entry?.enum ? entry.enum[0] as string : 'x');
  else st.argv.push(text);
}

// reads the positional token `t` into `st`; false when the command ends before it
function readPositional(st: ArgState, t: CommandToken, ctx: ArgContext): boolean {
  if (!ctx.bounded && !/^<.*>$/.test(t.text)) return false;
  if (t.text.startsWith('-') && t.text.length > 1) {
    st.errors.push(`unknown option ${t.text}`);
    return true;
  }
  const entry = ctx.schema[Math.min(st.position, ctx.schema.length - 1)];
  st.position += 1;
  st.valued = true;
  pushPositional(st, t.text, entry);
  return true;
}

function readArguments(rest: CommandToken[], ctx: ArgContext): ArgState {
  const st: ArgState = { argv: [], errors: [], valued: false, fragment: rest.length === 0, position: 0 };
  let k = 0;
  while (k < rest.length) {
    const t = rest[k] as CommandToken;
    if (isEllipsis(t.text)) {
      st.fragment = true;
      if (!ctx.bounded) break;
    } else if (t.text === '--') {
      st.fragment = true;
      break;
    } else if (t.text.startsWith('--')) k = readFlag(st, rest, k, ctx);
    else if (!readPositional(st, t, ctx)) break;
    k += 1;
  }
  return st;
}

// A mention that is not a whole call (prose, no value given, an ellipsis) is only held to the flags it names.
function supplyMissing(st: ArgState, ctx: ArgContext, error: string): boolean {
  const missingFlag = /^missing required option --(.+)$/.exec(error);
  if (missingFlag) {
    st.argv.push(`--${missingFlag[1]}`, sampleFor(ctx.declared.get(missingFlag[1] as string) as CatalogFlag));
    return true;
  }
  const missingPositional = /^missing required positional (.+)$/.exec(error);
  if (!missingPositional) return false;
  st.argv.push(ctx.schema.find((s) => s.name === missingPositional[1])?.enum?.[0] ?? 'x');
  return true;
}

function proveCall(st: ArgState, ctx: ArgContext, catalog: CommandCatalog): string[] {
  const whole = ctx.bounded && st.valued && !st.fragment;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = validateArgs(st.argv, ctx.verb, catalog.global);
    if (result.ok) return [];
    if (whole || !supplyMissing(st, ctx, result.error)) return [result.error];
  }
  return [];
}

function checkSingle(call: ResolvedCall, catalog: CommandCatalog): string[] {
  const verbName = call.verbAlts[0] as string;
  const verb = { ...call.group.verbs[verbName], group: call.groupAlts[0] as string, verb: verbName };
  const declared = new Map([...catalog.global, ...(verb.flags ?? [])].map((f) => [f.name, f] as const));
  const ctx: ArgContext = { bounded: call.bounded, verb, declared, schema: verb.positional ?? [] };
  const st = readArguments(call.rest, ctx);
  return st.errors.length > 0 ? st.errors : proveCall(st, ctx, catalog);
}

/**
 * Returns [] when the command is a valid call (or a fragment of one), else the reasons it is not.
 * `strictProse` holds a mention inside running text to the same group and verb as a span.
 */
export function checkCommand(occurrence: CommandOccurrence, catalog: CommandCatalog, { strictProse = false }: { strictProse?: boolean } = {}): string[] {
  if (RETIRED_SENTENCE.test(occurrence.text)) return [];
  const call = resolveCall(occurrence, catalog, strictProse);
  if (call.stop) return call.stop;
  if (call.verbAlts.length > 1 || call.groupAlts.length > 1) return alternativeErrors(call);
  return checkSingle(call, catalog);
}

/** A catalog of the { global: { flags }, groups: [{ group, verbs: [{ verb }] }] } form in the shape checkCommand reads (packages/cli/src/catalog.generated.mjs already is). */
export const commandCatalogOf = (loaded: LoadedCatalog): CommandCatalog => ({
  global: loaded.global.flags,
  groups: Object.fromEntries(loaded.groups.map((group) => [group.group, { verbs: Object.fromEntries(group.verbs.map((verb) => [verb.verb, verb])) }])),
});

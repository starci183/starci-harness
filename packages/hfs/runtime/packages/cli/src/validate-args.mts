/** One option of a catalogued verb (or a global one). */
export interface CatalogFlag { name: string; type: string; summary?: string; required?: boolean; default?: unknown; enum?: readonly unknown[]; global?: boolean }
/** One positional slot of a catalogued verb. */
export interface CatalogPositional { name: string; required?: boolean; variadic?: boolean; enum?: readonly unknown[] }
/** The catalog entry validateArgs judges a command line against, with the group and verb names a dispatcher adds. */
export interface CatalogVerb {
  verb?: string; group?: string; flags?: CatalogFlag[]; positional?: CatalogPositional[]; internalFlags?: Array<{ name: string; pointer: string }>;
  editions?: string[]; json?: string; operationPolicy?: Record<string, { action?: unknown; credentials?: unknown } | undefined>;
}
/** validateArgs' answer: the typed values or the refusal (code 2). */
export type ValidatedArgs =
  | { ok: true; values: Values; args: Values; global: Values; localArgs: string[]; positionals: string[]; operationPolicy: { action?: unknown; credentials?: unknown } | null }
  | { ok: false; code: 2; error: string };
type Values = Record<string, unknown>;
type Known = Map<string, CatalogFlag>;

const optionName = (token: string): string => token.slice(2).split('=', 1)[0] ?? '';

// A value may start with a single dash; one that is `--` or names a known flag is a missing value (use --flag=value).
const looksLikeFlag = (token: string, known: { has(name: string): boolean }): boolean => token === '--' || (token.startsWith('--') && known.has(optionName(token)));

const optionValue = (argv: string[], index: number, flag: CatalogFlag, known: Known): { value: unknown; consumed: number } => {
  const token = argv[index] ?? '';
  const equals = token.indexOf('=');
  if (equals >= 0) return { value: token.slice(equals + 1), consumed: 0 };
  if (flag.type === 'boolean') return { value: true, consumed: 0 };
  if (index + 1 >= argv.length || looksLikeFlag(argv[index + 1] ?? '', known)) {
    throw new Error(`--${flag.name} needs a value (use --${flag.name}=<value> for a value that looks like an option)`);
  }
  return { value: argv[index + 1], consumed: 1 };
};

const typedValue = (flag: CatalogFlag, raw: unknown): unknown => {
  if (flag.type === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`--${flag.name} expects true or false`);
  }
  if (flag.type === 'number') {
    const value = String(raw).trim() === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${flag.name} expects a number`);
    return value;
  }
  if (flag.type === 'enum' && !flag.enum?.includes(raw)) {
    throw new Error(`--${flag.name} expects one of: ${(flag.enum ?? []).join(', ')}`);
  }
  return raw;
};

/** The values a list flag takes after its first one when the verb has no positional slot: every following token that is no option (`--knowledge a b c`), as the contracts write it. */
const listTail = (argv: string[], index: number, flag: CatalogFlag, verb: CatalogVerb): string[] => {
  if (flag.type !== 'list' || (verb.positional ?? []).length > 0) return [];
  const tail: string[] = [];
  while (index + 2 + tail.length < argv.length && !(argv[index + 2 + tail.length] ?? '').startsWith('-')) tail.push(argv[index + 2 + tail.length] ?? '');
  return tail;
};

/** One `--name[=value]` token: type-check it into values/global, or pass it through to localArgs. */
const applyOption = (argv: string[], index: number, token: string, { known, internal, values, global, localArgs, verb }: { known: Known; internal: Map<string, string>; values: Values; global: Values; localArgs: string[]; verb: CatalogVerb }): number => {
  const name = optionName(token);
  const flag = known.get(name);
  if (!flag) throw new Error(internal.has(name) ? `unknown option --${name}: it is a call of the runtime itself, not a CLI option; ${internal.get(name)}` : `unknown option --${name}`);
  const { value: raw, consumed } = optionValue(argv, index, flag, known);
  const value = typedValue(flag, raw);
  const tail = consumed ? listTail(argv, index, flag, verb) : [];
  if (flag.type === 'list') {
    values[name] = [...((values[name] as unknown[] | undefined) ?? []), value, ...tail];
  } else if (Object.hasOwn(values, name)) {
    throw new Error(`--${name} may be given only once`);
  } else {
    values[name] = value;
  }
  if (flag.global) { global[name] = values[name]; }
  else {
    localArgs.push(token);
    if (consumed) localArgs.push(argv[index + consumed] ?? '');
    // each further value of a list flag reaches the handler as a repeated option, the form every list-flag handler parses
    for (const extra of tail) localArgs.push(token, extra);
  }
  return consumed + tail.length;
};

/** Every required local option must have been given. */
const requiredCheck = (locals: Map<string, CatalogFlag>, values: Values): void => {
  for (const flag of locals.values()) {
    if (flag.required && !Object.hasOwn(values, flag.name)) throw new Error(`missing required option --${flag.name}`);
  }
};

/** The values one positional slot holds: a variadic slot's list, a single value, or none. */
const candidatesOf = (supplied: unknown): unknown[] => {
  if (Array.isArray(supplied)) return supplied;
  return supplied === undefined ? [] : [supplied];
};

/** A slot with an enum accepts only its members. */
const checkEnum = (schema: CatalogPositional, candidates: unknown[]): void => {
  for (const candidate of candidates) {
    if (schema.enum && !schema.enum.includes(candidate)) throw new Error(`${schema.name} expects one of: ${schema.enum.join(', ')}`);
  }
};

/** Positional arity and enum checks; passthrough tokens fill free slots first. */
const checkPositionals = (verb: CatalogVerb, positionals: string[], passthrough: string[]): void => {
  const positionalSchema = verb.positional ?? [];
  const variadicAt = positionalSchema.findIndex((entry) => entry.variadic === true);
  const maximum = variadicAt >= 0 ? Infinity : positionalSchema.length;
  if (positionals.length > maximum) throw new Error(`too many positional arguments for ${verb.verb ?? 'command'}`);
  positionals.push(...passthrough.slice(0, Math.max(0, maximum - positionals.length)));
  for (const [index, schema] of positionalSchema.entries()) {
    const supplied = variadicAt === index ? positionals.slice(index) : positionals[index];
    const empty = Array.isArray(supplied) ? supplied.length === 0 : supplied === undefined;
    if (schema.required && empty) throw new Error(`missing required positional ${schema.name}`);
    checkEnum(schema, candidatesOf(supplied));
  }
};

/** Edition availability, --cwd emptiness and --json support. */
const checkGlobals = (verb: CatalogVerb, global: Values): void => {
  if (global.edition !== undefined && Array.isArray(verb.editions) && !verb.editions.some((edition) => edition === global.edition)) {
    throw new Error(`${verb.group ?? 'this command'} ${verb.verb ?? ''}`.trim() + ` is not available in the ${global.edition} edition (editions: ${verb.editions.join(', ')})`);
  }
  if (global.cwd === '') throw new Error('--cwd needs a value');
  if (global.json === true && verb.json === 'none') {
    throw new Error(`${verb.group ?? 'this command'} ${verb.verb ?? ''}`.trim() + ' has no machine output');
  }
};

/** args = supplied locals, else their declared defaults (a list flag's scalar default wraps in an array). */
const defaultArgs = (locals: Map<string, CatalogFlag>, values: Values): Values => {
  const args: Values = {};
  for (const flag of locals.values()) {
    if (Object.hasOwn(values, flag.name)) args[flag.name] = values[flag.name];
    else if (flag.default !== undefined) args[flag.name] = flag.type === 'list' && !Array.isArray(flag.default) ? [flag.default] : flag.default;
  }
  return args;
};

/** Select the catalogued action policy; a missing policy refuses before runtime or provider dispatch. */
const operationPolicyOf = (verb: CatalogVerb, positionals: string[]): { action?: unknown; credentials?: unknown } | null => {
  if (verb.operationPolicy === undefined) return null;
  const policy = verb.operationPolicy?.[positionals[0] ?? ''];
  if (!policy || typeof policy.action !== 'string' || !Array.isArray(policy.credentials)) {
    throw new Error('the selected action has no executable operation policy');
  }
  return policy;
};

/**
 * Validate the arguments after a catalog group and verb.
 *
 * Global options are returned separately so dispatchers can implement them once;
 * localArgs contains only the verb's positionals and local options, in input order.
 * Everything after a bare `--` is passed through unchanged: it is never parsed as an option and
 * only fills positional slots the verb declares.
 */
export function validateArgs(argv: string[], verb: CatalogVerb, globalFlags: CatalogFlag[] = []): ValidatedArgs {
  const globals = new Map(globalFlags.map((flag) => [flag.name, { ...flag, global: true }]));
  const locals = new Map((verb.flags ?? []).map((flag) => [flag.name, flag]));
  const known = new Map([...globals, ...locals]);
  // Flags the runtime's own scripts take and the CLI refuses, each with the pointer a person is given instead.
  const internal = new Map((verb.internalFlags ?? []).map((entry) => [entry.name, entry.pointer]));
  const values: Values = {};
  const global: Values = {};
  const localArgs: string[] = [];
  const positionals: string[] = [];
  const passthrough: string[] = [];
  let positionalOnly = false;

  try {
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index] ?? '';
      if (positionalOnly) {
        passthrough.push(token);
        localArgs.push(token);
        continue;
      }
      if (token === '--') {
        positionalOnly = true;
        localArgs.push(token);
        continue;
      }
      if (token.startsWith('--')) {
        index += applyOption(argv, index, token, { known, internal, values, global, localArgs, verb });
        continue;
      }
      if (token.startsWith('-')) throw new Error(`unknown option ${token}`);
      positionals.push(token);
      localArgs.push(token);
    }

    requiredCheck(locals, values);
    checkPositionals(verb, positionals, passthrough);
    checkGlobals(verb, global);
    const operationPolicy = operationPolicyOf(verb, positionals);
    return { ok: true, values, args: defaultArgs(locals, values), global, localArgs, positionals, operationPolicy };
  } catch (error) {
    return { ok: false, code: 2, error: String((error as { message?: unknown } | null | undefined)?.message ?? error) };
  }
}

/** Insert dispatcher-owned flags before a pass-through `--`, where handlers still parse them as options. */
export function withFlagsBeforeDashes(args: string[], extra: string[]): string[] {
  const at = args.indexOf('--');
  return at < 0 ? [...args, ...extra] : [...args.slice(0, at), ...extra, ...args.slice(at)];
}

const isHelpToken = (token: string): boolean => token === '--help' || token === '-h' || token === '--help=true';

/**
 * Find the group and verb while allowing catalog global options before them.
 * `help` is true when --help or -h appears before any bare `--`; everything after `--` is pass-through.
 */
export function splitCommand(argv: string[], globalFlags: CatalogFlag[] = []): { group: string | null; verb: string | null; args: string[]; help: boolean } {
  const globals = new Map(globalFlags.map((flag) => [flag.name, flag]));
  const command: string[] = [];
  const args: string[] = [];
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--') {
      args.push(...argv.slice(index));
      break;
    }
    if (isHelpToken(token)) {
      help = true;
      continue;
    }
    if (token.startsWith('--')) {
      const flag = globals.get(optionName(token));
      args.push(token);
      const next = argv[index + 1];
      if (flag && flag.type !== 'boolean' && !token.includes('=') && next !== undefined && !looksLikeFlag(next, globals)) args.push(argv[++index] ?? '');
    } else if (token.startsWith('-') && token.length > 1) {
      args.push(token);
    } else if (command.length < 2) command.push(token);
    else args.push(token);
  }
  return { group: command[0] ?? null, verb: command[1] ?? null, args, help };
}

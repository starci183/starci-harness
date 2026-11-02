import fs from 'node:fs';
import { refuse, scopeArgs, scopeName } from './github.mjs';
import type { CiDeclaration, CiEntry, CiOptions, Gh, StdinSource } from './github.mjs';
import { boundSealedKey, type ServiceBinding } from '../runtime/scripts/hfs/ci-declaration.mjs';

/** An input pipe or file is an input source even before its bytes arrive; fstat never consumes its value. */
export function redirectedSecretInput(): boolean {
  try { const input = fs.fstatSync(0); return input.isFIFO() || input.isFile(); }
  catch { return false; }
}

/** A declared name must belong to the requested store before a secret body is read. */
export function declaredEntry(entries: readonly CiEntry[], name: string, options: CiOptions): CiEntry {
  const entry = entries.find((item) => item.name === name);
  if (!entry) throw refuse('CI_NAME_UNDECLARED', 'the name is not declared for this CI class');
  const environment = entry.scope === 'environment' ? entry.environment : undefined;
  if (environment !== options.env || (options.dependabot && options.env)) throw refuse('CI_SCOPE_MISMATCH', 'the requested scope differs from the declaration');
  return entry;
}

/** Secret input is read once, stripped of one trailing newline, and passed only to the child stdin; without options.execute nothing is read or written. */
export async function setSecret({ declaration, sealed, gh, options, name, stdin, stdout, bindings = [], custody, inputRedirected = redirectedSecretInput }: {
  declaration: CiDeclaration; sealed: readonly { env?: string; member?: string; file?: string; key: string }[]; gh: Gh; options: CiOptions; name: string; stdin: StdinSource; stdout: (text: string) => unknown;
  bindings?: ServiceBinding[]; custody?: ((binding: ServiceBinding) => string) | undefined;
  inputRedirected?: (() => boolean) | undefined;
}): Promise<number> {
  declaredEntry(options.dependabot ? declaration.dependabotSecrets : declaration.secrets, name, options);
  const binding = options.dependabot ? undefined : bindings.find((item) => item.name === name);
  if (sealed.some((item) => (item.key === name || (binding && item.key === binding.key)) && !(binding && boundSealedKey(binding, item))))
    throw refuse('CI_SECRET_SEALED', 'the name or selected key belongs to unrelated sealed app custody');
  if (binding && options['from-custody'] !== true) throw refuse('CI_CUSTODY_REQUIRED', 'this service secret is an execution copy; use --from-custody');
  if (options['from-custody'] && (!binding || !custody)) throw refuse('CI_CUSTODY_INVALID', 'one explicit project service credential binding is required');
  if (options['from-custody'] && (stdin !== undefined || inputRedirected())) throw refuse('CI_VALUE_AMBIGUOUS', 'choose custody or stdin, never both');
  // Dry until --execute: the name is judged, but no value is read and GitHub is not reached; the line never carries a value.
  if (options.execute !== true) {
    stdout(`dry run: would set secret ${name} (${scopeName(options)}) from ${binding ? 'its declared service custody' : 'the value on stdin'}; add --execute\n`);
    return 0;
  }
  let value: unknown;
  if (binding && custody) value = custody(binding);
  else if (stdin === undefined) {
    if (process.stdin.isTTY) throw refuse('CI_VALUE_EMPTY', 'a secret value is required on stdin');
    value = fs.readFileSync(0, 'utf8');
  } else value = typeof stdin === 'function' ? await stdin() : stdin;
  value = binding ? value : String(value ?? '').replace(/\r?\n$/, '');
  if (!(value as string).length) throw refuse('CI_VALUE_EMPTY', 'a secret value is required on stdin');
  const repo = gh.repository(options.repo);
  gh.run(['secret', 'set', name, ...scopeArgs(options), '--repo', repo], value as string);
  stdout(`set secret ${name} (${scopeName(options)})\n`);
  return 0;
}

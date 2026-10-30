import fs from 'node:fs';
import { refuse, scopeArgs, scopeName } from './github.mjs';
import type { CiDeclaration, CiEntry, CiOptions, Gh, StdinSource } from './github.mjs';

/** A declared name must belong to the requested store before a secret body is read. */
export function declaredEntry(entries: readonly CiEntry[], name: string, options: CiOptions): CiEntry {
  const entry = entries.find((item) => item.name === name);
  if (!entry) throw refuse('CI_NAME_UNDECLARED', 'the name is not declared for this CI class');
  const environment = entry.scope === 'environment' ? entry.environment : undefined;
  if (environment !== options.env || (options.dependabot && options.env)) throw refuse('CI_SCOPE_MISMATCH', 'the requested scope differs from the declaration');
  return entry;
}

/** Secret input is read once, stripped of one trailing newline, and passed only to the child stdin; without options.execute nothing is read or written. */
export async function setSecret({ declaration, sealed, gh, options, name, stdin, stdout }: {
  declaration: CiDeclaration; sealed: readonly { key: string }[]; gh: Gh; options: CiOptions; name: string; stdin: StdinSource; stdout: (text: string) => unknown;
}): Promise<number> {
  if (sealed.some((item) => item.key === name)) throw refuse('CI_SECRET_SEALED', 'the name belongs to a sealed app secret');
  declaredEntry(options.dependabot ? declaration.dependabotSecrets : declaration.secrets, name, options);
  // Dry until --execute: the name is judged, but no value is read and GitHub is not reached; the line never carries a value.
  if (options.execute !== true) {
    stdout(`dry run: would set secret ${name} (${scopeName(options)}) from the value on stdin; add --execute\n`);
    return 0;
  }
  let value: unknown;
  if (stdin === undefined) {
    if (process.stdin.isTTY) throw refuse('CI_VALUE_EMPTY', 'a secret value is required on stdin');
    value = fs.readFileSync(0, 'utf8');
  } else value = typeof stdin === 'function' ? await stdin() : stdin;
  value = String(value ?? '').replace(/\r?\n$/, '');
  if (!(value as string).length) throw refuse('CI_VALUE_EMPTY', 'a secret value is required on stdin');
  const repo = gh.repository(options.repo);
  gh.run(['secret', 'set', name, ...scopeArgs(options), '--repo', repo], value as string);
  stdout(`set secret ${name} (${scopeName(options)})\n`);
  return 0;
}

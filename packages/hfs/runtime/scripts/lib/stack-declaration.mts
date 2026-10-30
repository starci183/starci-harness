// stack-declaration.mjs - the one reader of a repository's stack declaration (.starcistacks/application-stacks.yaml): where it
// lives, its bounded read and parse, and the stack block of one service as declared. scripts/gates/starcistacks.mjs (the
// services contract) and scripts/hfs/rules/stacks.mjs (the .starcistacks shape, R10) both read it here; this file imports
// nothing of the kernel, so the published @starci/hfs bundle carries it without the ledger.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { parseYaml } from '../../engine/yaml.mjs';
import { isDir, isFile } from './fs-kind.mjs';
import { posixPath } from './path-key.mjs';

export const DECLARATION = 'application-stacks.yaml';
/** The one stack root a repository owns. */
export const STACK_ROOT = '.starcistacks';
const MAX_BYTES = 2 * 1024 * 1024;

/** A non-blank string, trimmed; anything else is null. */
export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The text of `file`, or null when it is absent or larger than 2 MiB. */
export const readText = (file: string): string | null => { try { return fs.statSync(file).size > MAX_BYTES ? null : fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** A parsed YAML mapping (the declaration document). */
export type DeclarationDoc = Record<string, unknown>;
/** The read of a declaration file. */
export type DeclarationRead = { doc: DeclarationDoc; error?: undefined } | { error: string; doc?: undefined };
/** The stack declaration a repository owns, or {missing:true} when it declares none. */
export type StackDeclaration =
  | ({ repo: string; root: string; file: string; rooted: boolean } & DeclarationRead)
  | { repo: string; missing: true; rooted: boolean; root?: undefined; file?: undefined; doc?: undefined; error?: undefined };
/** The stack block of one declared service. */
export interface DeclaredStack { owner: string | null; root: string | null; repository: string | null; hostOwned: boolean }

/** The parsed declaration file: {doc} or {error}. */
export function readDeclaration(file: string): DeclarationRead {
  const raw = readText(file);
  if (raw === null) return { error: 'unreadable or larger than 2 MiB' };
  try { const doc = parseYaml(raw); return plain(doc) ? { doc } : { error: 'not a YAML mapping' }; }
  catch (error) { return { error: `YAML does not parse: ${String((error as { message?: unknown } | null)?.message ?? error).split('\n')[0]}` }; }
}

/**
 * The stack declaration a repository owns: {root, file, rooted, doc|error} - or {missing:true, rooted}
 * when .starcistacks/application-stacks.yaml does not exist. `rooted` says the .starcistacks tree exists.
 */
export function findStackDeclaration(repoRoot: unknown): StackDeclaration {
  const repo = path.resolve(String(repoRoot ?? ''));
  const rooted = isDir(path.join(repo, STACK_ROOT));
  const file = path.join(repo, STACK_ROOT, DECLARATION);
  if (isFile(file)) return { repo, root: STACK_ROOT, file, rooted, ...readDeclaration(file) };
  return { repo, missing: true, rooted };
}

/**
 * The stack block of one declared service, or null when it has none: {owner, root, repository, hostOwned}. A stack is
 * host-owned when it says `owner: host` (it lives in the installed runtime tree, `.claude/ext/<service>`); `root` is posix.
 */
export function declaredStack(entry: unknown): DeclaredStack | null {
  const stack = (plain(entry) && plain((entry as Record<string, unknown>)['stack']) ? (entry as Record<string, unknown>)['stack'] : null) as Record<string, unknown> | null;
  if (!stack) return null;
  const root = text(stack.root);
  return { owner: text(stack.owner), root: root === null ? null : posixPath(root), repository: text(stack.repository), hostOwned: text(stack.owner) === 'host' };
}

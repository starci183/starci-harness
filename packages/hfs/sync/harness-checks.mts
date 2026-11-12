// harness-checks.mts - the copies of a harness-owned check an app once kept for itself, which `starci app sync` takes out (R103: a repository
// keeps no check of its own). Each copy is a retired file of a lite app (sync/index.mts `retiredFiles`: the dry run names it, --execute deletes
// it), and every root package.json script that runs it is removed with it, so no script is left pointing at a deleted file. Nothing else of
// package.json changes: its key order and its indentation stay.
import type { DeclarationEdit } from './declared-sides.mjs';

/** The app-relative copies of a check the harness now owns, each with the owner the dry run names. */
export const HARNESS_CHECK_COPIES: Readonly<Record<string, string>> = Object.freeze({
  'scripts/di-ring-check.mjs': 'the provider-ring check is the boot proof\'s: starci app check (and its --gate wiring) names every ring as BE_DI_RING (R401, BE-INJECTION-5)',
});

const PACKAGE_FILE = 'package.json';
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const RUNS_COPY = new RegExp(`(?:^|[\\s&|;(])(?:\\./)?(?:${Object.keys(HARNESS_CHECK_COPIES).map(escape).join('|')})(?=$|[\\s&|;)])`, 'u');

/** The edit that drops every root package.json script running a retired check copy, or none; `read` gives a file's text as earlier edits left it. */
export function harnessCheckScriptEdits(read: (relative: string) => string | null): DeclarationEdit[] {
  const text = read(PACKAGE_FILE);
  if (text === null) return [];
  let manifest: { scripts?: Record<string, unknown> };
  try { manifest = JSON.parse(text) as typeof manifest; } catch { return []; }
  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  const dropped = Object.keys(scripts).filter((name) => typeof scripts[name] === 'string' && RUNS_COPY.test(scripts[name]));
  if (dropped.length === 0) return [];
  for (const name of dropped) delete scripts[name];
  const indent = /^[ \t]+(?=")/mu.exec(text)?.[0] ?? '  ';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const content = `${JSON.stringify(manifest, null, indent).replace(/\n/gu, newline)}${text.endsWith('\n') ? newline : ''}`;
  return [{ path: PACKAGE_FILE, reason: `drop the script(s) ${dropped.join(', ')}: they run a check the harness owns, retired with its copy`, content }];
}

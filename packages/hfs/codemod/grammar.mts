// codemod/grammar.mts - the Grammar's own codemods, one per Grammar release that needs one, named after its version (0.54.0 is
// v0540; owner 2026-11-21: "starci app codemod v0540 đi pattern thế 1 codemod đi kèm 1 bản grammars"). They live in
// packages/grammar/codemods and ship in @starci/grammar (its `./codemods` export, dist/codemods); this module finds the Grammar the
// app has installed, imports its codemods and hands them the app's own TypeScript compiler, so neither package takes a runtime
// dependency on the other.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findPackage, loadTypescript, type FoundPackage } from '../runtime/scripts/lib/package-at.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A Grammar codemod id: v<major><minor><patch>. */
export const GRAMMAR_CODEMOD_ID = /^v\d{3,}$/;

/** What one Grammar codemod reports. */
export interface GrammarCodemodReport { codemod: string; version: string; mode: 'dry' | 'execute'; findings: readonly unknown[] }

/** One codemod as `@starci/grammar/codemods` publishes it. */
export interface GrammarCodemod {
  id: string;
  version: string;
  summary: string;
  run: (input: { root: string; write: boolean; ts: unknown }) => GrammarCodemodReport;
  markdown: (report: GrammarCodemodReport) => string;
}

/** The module `@starci/grammar/codemods` is. */
export interface GrammarCodemods {
  CODEMODS: readonly GrammarCodemod[];
  codemodsBetween: (from: string, to: string) => GrammarCodemod[];
}

/** The folders an app installs @starci/grammar from: the root, `fe/`, and each app and package workspace on either layout. */
export function grammarDirs(root: string): string[] {
  const dirs = [root, path.join(root, 'fe')];
  for (const base of [root, path.join(root, 'fe')]) {
    for (const group of ['apps', 'packages']) {
      const dir = path.join(base, group);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) dirs.push(path.join(dir, name));
    }
  }
  return dirs.filter((dir) => fs.existsSync(dir));
}

/** The app's installed @starci/grammar, or null. */
export const installedGrammar = (root: string): FoundPackage | null => findPackage(grammarDirs(root), ['@starci/grammar']);

/** The codemods of an installed Grammar; a Grammar before 0.54.0 ships none, which is refused with what to do. */
export async function loadGrammarCodemods(grammar: FoundPackage): Promise<GrammarCodemods> {
  // reason: package.json is parsed from disk; only `exports["./codemods"]` is read.
  const manifest: { exports?: Record<string, { import?: string } | string> } = JSON.parse(fs.readFileSync(grammar.packageFile, 'utf8'));
  const entry = manifest.exports?.['./codemods'];
  const rel = typeof entry === 'string' ? entry : entry?.import;
  if (!rel) throw new Error(`@starci/grammar ${grammar.version} at ${grammar.root} ships no codemods (they start with 0.54.0): install the target Grammar first, then run starci app codemod`);
  return import(pathToFileURL(path.join(grammar.root, rel)).href) as Promise<GrammarCodemods>;
}

/** The options of a Grammar codemod run. */
export interface GrammarCodemodOptions { write: boolean; format: 'json' | 'markdown'; out?: string; from?: string; to?: string }

const VERSION = /^\d+\.\d+\.\d+$/;

/** True when version `a` is above `b` (x.y.z). */
const newer = (a: string, b: string): boolean => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** `--from` and `--to` taken out of an argv (each `--flag value` or `--flag=value`), the rest left for the report options. */
export function rangeArguments(argv: readonly string[]): { from?: string; to?: string; rest: string[] } {
  const out: { from?: string; to?: string; rest: string[] } = { rest: [] };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? '';
    const [flag, inline] = arg.split(/=(.*)/s);
    if (flag !== '--from' && flag !== '--to') { out.rest.push(arg); continue; }
    const value = inline ?? argv[at += 1];
    if (!value || !VERSION.test(value)) throw new Error(`${flag} needs a Grammar version x.y.z`);
    if (flag === '--from') out.from = value;
    else out.to = value;
  }
  return out;
}

/** The lines of `starci app codemod --list`: each Grammar codemod with its version and summary. */
export function listMarkdown(codemods: readonly GrammarCodemod[], grammar: FoundPackage): string {
  const rows = codemods.map((codemod) => `| ${codemod.id} | ${codemod.version} | ${codemod.summary} |`);
  return [`# Grammar codemods (@starci/grammar ${grammar.version} installed)`, '', '| Codemod | Grammar | What it does |', '| --- | --- | --- |', ...rows, '', 'Run one: `starci app codemod <id>`; an upgrade: `starci app codemod --from <installed> --to <target>`. Dry until --execute.', ''].join('\n');
}

/**
 * Run Grammar codemods at an app root: the one named (`id`), or every one above `from` up to `to` (the installed Grammar when no
 * `to`), in version order. Returns each report; the TypeScript compiler is the app's own, else this package's.
 */
export async function runGrammarCodemods({ root, id, from, to, write, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; id?: string; from?: string; to?: string; write: boolean; ts?: unknown }): Promise<{ grammar: FoundPackage; reports: { codemod: GrammarCodemod; report: GrammarCodemodReport }[] }> {
  const grammar = installedGrammar(root);
  if (!grammar) throw new Error(`no @starci/grammar is installed under ${root}: install the app's dependencies first`);
  const module = await loadGrammarCodemods(grammar);
  let chosen: GrammarCodemod[];
  if (id !== undefined) {
    const found = module.CODEMODS.find((codemod) => codemod.id === id);
    if (!found) throw new Error(`@starci/grammar ${grammar.version} has no codemod ${id}; it has ${module.CODEMODS.map((codemod) => codemod.id).join(', ') || 'none'} (starci app codemod --list)`);
    chosen = [found];
  } else {
    if (from === undefined) throw new Error('starci app codemod --from <installed> [--to <target>] needs --from');
    const target = to ?? grammar.version;
    if (newer(target, grammar.version)) throw new Error(`--to ${target} is above the installed @starci/grammar ${grammar.version}: install ${target} first (its package carries the codemods up to it), then run the codemods`);
    chosen = module.codemodsBetween(from, target);
  }
  if (!ts) throw new Error('no TypeScript compiler resolves from the app or @starci/hfs: install the app dependencies first');
  const reports = chosen.map((codemod) => ({ codemod, report: codemod.run({ root, write, ts }) }));
  return { grammar, reports };
}

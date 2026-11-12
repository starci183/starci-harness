// harness-checks.mts - the copies of a harness-owned check an app once kept for itself, which `starci app sync` takes out (R103: a repository
// keeps no check of its own). Each copy is a retired file of a lite app (sync/index.mts `retiredFiles`: the dry run names it, --execute deletes
// it), and every root package.json script that runs it is removed with it, so no script is left pointing at a deleted file. Nothing else of
// package.json changes: its key order and its indentation stay.
import fs from 'node:fs';
import path from 'node:path';
import { declaredCheckFiles, namesACheck, PROJECT_CHECKS_DIR } from '../runtime/scripts/hfs/rules/repo-local-checks.mjs';
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

const TOOL_FOLDERS = ['scripts', 'tools'];
const RUNNABLE = /\.(?:[cm]?[jt]s|sh|ps1)$/u;

/** The runnable files of `folder` and of each folder directly below it, app-relative with forward slashes. */
function toolFiles(root: string, folder: string): string[] {
  const listed: string[] = [];
  const entries = (relative: string): fs.Dirent[] => { try { return fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch { return []; } };
  for (const entry of entries(folder)) {
    if (entry.isFile()) listed.push(`${folder}/${entry.name}`);
    else if (entry.isDirectory() && entry.name !== 'node_modules') for (const inner of entries(`${folder}/${entry.name}`)) if (inner.isFile()) listed.push(`${folder}/${entry.name}/${inner.name}`);
  }
  return listed.filter((file) => RUNNABLE.test(file));
}

/** The kebab-case id a loose check file suggests: its name without the extension and the word check, else the whole name. */
const suggestedId = (file: string): string => {
  const stem = path.posix.basename(file).replace(/\.[^.]+$/u, '');
  const words = stem.toLowerCase().split(/[^a-z0-9]+/u).filter((word) => word !== '' && !['check', 'checks', 'checker'].includes(word));
  return (words.length > 0 ? words : stem.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)).join('-');
};

/**
 * One notice per check an app keeps outside the home PROJECT-LINT-3 gives it (R103): a check-named runnable file of scripts/ or tools/ (one folder
 * below included) outside scripts/checks/, a harness-owned copy aside (that one is retired). Each notice names the move, the hfs.json `checks`
 * entry to add and the package.json scripts to repoint. Sync never moves the file: a check may resolve paths from its own folder (a root of
 * `..`, its own path in an allow list), so a moved copy can pass while it reads the wrong tree, and the `why` of the declaration is the project's.
 */
export function looseCheckNotices(root: string): string[] {
  const declared = declaredCheckFiles(root);
  let scripts: Record<string, unknown> = {};
  try { scripts = (JSON.parse(fs.readFileSync(path.join(root, PACKAGE_FILE), 'utf8')) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { /* no root manifest: no script to repoint */ }
  const loose = TOOL_FOLDERS.flatMap((folder) => toolFiles(root, folder))
    .filter((file) => !file.startsWith(PROJECT_CHECKS_DIR) && !Object.hasOwn(HARNESS_CHECK_COPIES, file) && !declared.has(file) && namesACheck(path.posix.basename(file)));
  return loose.map((file) => {
    const id = suggestedId(file);
    const target = `${PROJECT_CHECKS_DIR}${id}.mjs`;
    const runners = Object.entries(scripts).filter(([, command]) => typeof command === 'string' && command.includes(file)).map(([name]) => name);
    const repoint = runners.length === 0 ? '' : `, and point the package.json script(s) ${runners.join(', ')} at ${target}`;
    return `notice: ${file} is a project check outside its home (R103, PROJECT-LINT-3); sync does not move it, since a check may resolve paths from its own folder and its why is the project's: move it to ${target} (an .mjs file), fix the paths it resolves from its folder, add {"id": "${id}", "run": "${target}", "why": "<what it guards>"} to hfs.json checks${repoint}; starci app check then runs it as its own checks step (R402)`;
  });
}

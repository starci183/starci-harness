// R270: product documentation cites paths, commands and rules that still exist.
// Paths in links are document-relative; code/prose paths may be repository-relative. Only tracked
// names are inspected.
import path from 'node:path';
import { CATALOG } from '../../../packages/cli/src/catalog.generated.mjs';
import { checkCommand, extractCommands } from '../doc-commands.mjs';
import { globExpression } from '../../lib/glob.mjs';
import { loadRuleCatalog } from '../rule-catalog.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Repo, Resolver } from './rule-types.mjs';

const PATH_MISSING = 'HFS_DOC_PATH_MISSING';
const COMMAND_UNKNOWN = 'HFS_DOC_COMMAND_UNKNOWN';
const RULE_UNKNOWN = 'HFS_DOC_RULE_UNKNOWN';
const DOCUMENT = /(?:^|\/)README\.md$|(?:^|\/)docs\/.+\.mdx?$/i;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const PLACEHOLDER = /[<>{}*$]/;
const PATH_TOKEN = /^(?:\.\.?\/)?[\w@.-]+(?:\/[\w@.()[\]-]+)*\/?$/;
let runtimeCatalogs;

function catalogs() {
  runtimeCatalogs ??= {
    commands: CATALOG,
    rules: loadRuleCatalog(),
  };
  return runtimeCatalogs;
}

const trackedPath = (target: Parsed, tracked: Parsed) => tracked.has(target) || [...tracked].some((file) => file.startsWith(`${target.replace(/\/$/, '')}/`));

function cleanPath(raw: Parsed) {
  if (EXTERNAL.test(raw) || PLACEHOLDER.test(raw)) return null;
  let target;
  try { target = decodeURIComponent(raw.split(/[?#]/)[0]); } catch { return null; }
  if (!PATH_TOKEN.test(target) || !target || target === '.' || target === '..') return null;
  return target.replace(/\/$/, '');
}

function codePathRoots(file: string, tracked: Parsed) {
  const side = /^(be|fe)\//.exec(file)?.[1] ?? '';
  return [...new Set(['', side, packageDirectory(file, tracked)])];
}

function resolvedPath(raw: Parsed, file: string, tracked: Parsed, link: Parsed, generated: Parsed, roots: Parsed) {
  const target = cleanPath(raw);
  if (target === null) return true;
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
  const candidates = link ? [relative] : [relative, ...roots.map((root: string) => path.posix.join(root, target))];
  return candidates.some((candidate) => !candidate.startsWith('../') && (trackedPath(candidate, tracked) || generated.has(candidate)));
}

const INLINE_LINK = /\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['"][^)]*)?\)/.source;
const REFERENCE_LINK = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/.source;
const MARKDOWN_LINK = new RegExp(`${INLINE_LINK}|${REFERENCE_LINK}`, 'g');

function pathReferences(line: string) {
  const refs = [];
  // Markdown inline and reference links, including image links. URLs and anchors are excluded later.
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    refs.push({ target: match[1] ?? match[2] ?? match[3] ?? match[4], link: true });
  }
  const masked = line.replace(/\]\([^)]*\)/g, ']');
  for (const match of masked.matchAll(/`([^`]+)`/g)) {
    const target = match[1];
    if (target!.includes('/') || /\.(?:md|mdx|json|ya?ml|[cm]?[jt]sx?|sh|env|toml|sql|graphql|enc)$/.test(target!)) refs.push({ target, link: false });
  }
  // Unquoted prose paths need a slash; dotted words and API routes are not file citations.
  const prose = masked.replace(/`[^`]*`|\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '');
  for (const match of prose.matchAll(/(?<![\w@./:-])((?:\.\.?\/)?[\w@.-]+\/(?:[\w@.()[\]-]+\/)*[\w@.()[\]-]*)(?![\w/])/g)) {
    refs.push({ target: match[1]!.replace(/[.,;:]$/, ''), link: false });
  }
  return refs;
}

/** A cited host location (the untracked custody file `.claude/secret.env`, `~/...`) or a prose pair (`expand/contract`: no extension and no tracked top-level folder of that name) is no repository path. */
function hostOrProse(target: Parsed, tracked: Parsed, link: Parsed, roots: Parsed) {
  if (!link && (target === 'process.env' || target === 'import.meta.env')) return true;
  if (target === '.claude/secret.env' || /^(?:~\/|\/)/.test(target)) return true;
  if (link || /\.[A-Za-z0-9]+$/.test(target) || target.endsWith('/') || target.startsWith('.')) return false;
  const top = target.split('/')[0];
  return !roots.some((root: string) => trackedPath(path.posix.join(root, top), tracked));
}

function pathFindings(file: string, lines: string[], tracked: Parsed, generated: Parsed) {
  const findings = [];
  const roots = codePathRoots(file, tracked);
  for (const [index, line] of lines.entries()) {
    for (const { target, link } of pathReferences(line)) {
      if (hostOrProse(target, tracked, link, roots)) continue;
      if (!resolvedPath(target, file, tracked, link, generated, roots)) findings.push(found(PATH_MISSING, file, `${file} cites a missing repository path ${target}; update the documentation or restore the path`, { line: index + 1, reference: target }));
    }
  }
  return findings;
}

/** Tool reports are generated, never tracked; both their consumer and the slot policy must declare them. */
function generatedReports(repoRoot: string, tracked: Parsed, resolver?: Resolver) {
  const reports = new Set();
  if (!tracked.has('sonar-project.properties') || !resolver) return reports;
  const text = readText(repoRoot, 'sonar-project.properties') ?? '';
  for (const match of text.matchAll(/^sonar\.javascript\.lcov\.reportPaths\s*=\s*([^\r\n]*)/gm)) {
    for (const report of match[1]!.split(',').map((entry) => entry.trim())) {
      const target = cleanPath(report);
      if (target && resolver.trackingOf(target) === 'ignored') reports.add(target);
    }
  }
  return reports;
}

function packageDirectory(file: string, tracked: Parsed) {
  let dir = path.posix.dirname(file);
  while (true) {
    if (tracked.has(path.posix.join(dir, 'package.json'))) return dir === '.' ? '' : dir;
    if (dir === '.') return '';
    dir = path.posix.dirname(dir);
  }
}

function workspaceManifests(repoRoot: string, directory: string, tracked: Parsed) {
  const manifest = readJson(repoRoot, path.posix.join(directory, 'package.json'));
  const workspaces = Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages ?? [];
  const patterns = workspaces.map((entry: Parsed) => globExpression(path.posix.join(directory, entry)));
  return [...tracked].filter((entry) => path.posix.basename(entry) === 'package.json' && patterns.some((pattern: Parsed) => pattern.test(path.posix.dirname(entry))));
}

function missingScripts(repoRoot: string, directory: string, tracked: Parsed, name: string, workspaces: Parsed) {
  const manifests = workspaces ? workspaceManifests(repoRoot, directory, tracked) : [path.posix.join(directory, 'package.json')];
  if (!manifests.length) return [path.posix.join(directory, 'package.json')];
  return manifests.filter((file) => !Object.hasOwn(readJson(repoRoot, file)?.scripts ?? {}, name));
}

function scriptFindings(repoRoot: string, file: string, lines: string[], tracked: Parsed) {
  const findings = [];
  const initial = packageDirectory(file, tracked);
  let directory = initial;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) directory = initial;
    const changed = /(?:^|[;&]\s*|\$\s*)cd\s+([\w./-]+)/.exec(line);
    if (changed) directory = path.posix.normalize(path.posix.join(directory, changed[1]!));
    for (const match of line.matchAll(/\bnpm\s+(?:--prefix\s+([\w./-]+)\s+)?run\s+(?:--silent\s+)?([\w:.-]+)/g)) {
      const dir = match[1] ? path.posix.join(directory, match[1]) : directory;
      const name = match[2];
      const tail = line.slice(match.index + match[0].length).split(/[`;&|]/)[0];
      const workspaces = /(?:^|\s)--workspaces(?:\s|$)/.test(tail!);
      const missing = missingScripts(repoRoot, dir, tracked, name!, workspaces);
      for (const manifest of missing) findings.push(found(COMMAND_UNKNOWN, file, `${file} cites npm run ${name}, absent from ${manifest}; update the command or declare the script`, { line: index + 1, reference: `npm run ${name}` }));
    }
  }
  return findings;
}

function commandFindings(repoRoot: string, file: string, text: string, tracked: Parsed, commands: Parsed) {
  const findings = scriptFindings(repoRoot, file, text.split(/\r?\n/), tracked);
  for (const occurrence of extractCommands(text)) {
    if (!/^\s*app\s/.test(occurrence.text)) continue;
    for (const issue of checkCommand(occurrence, commands, { strictProse: true }).filter((reason: Parsed) => /^unknown verb\b/.test(reason))) {
      findings.push(found(COMMAND_UNKNOWN, file, `${file} cites a starci app command that does not resolve: ${issue}; use a verb from the CLI catalog`, { line: occurrence.line }));
    }
  }
  return findings;
}

function ruleFindings(file: string, lines: string[], rules: Parsed) {
  const findings = [];
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/\bR\d+\b/g)) {
      if (!rules.rule(match[0])) findings.push(found(RULE_UNKNOWN, file, `${file} cites unknown rule ${match[0]}; use an id from the HFS rule catalog`, { line: index + 1, reference: match[0] }));
    }
  }
  return findings;
}

/** Findings of R270 over product READMEs and docs, in and full; runtime docs retain their own checks. */
export function docFreshFindings({ repoRoot, files = [], all = files, repo, resolver, appSide = false, inScope = () => true }: { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; resolver?: Resolver; appSide?: Parsed; inScope?: (file: string) => boolean }) {
  if (appSide || repo?.profile === 'runtime') return [];
  const inventory = repo.profile === 'app' ? all : files;
  const docs = inventory.filter((file: string) => DOCUMENT.test(file) && path.posix.basename(file) !== 'KEYS.md' && inScope(file));
  if (!docs.length) return [];
  const tracked = new Set(all);
  const { commands, rules } = catalogs();
  const generated = generatedReports(repoRoot, tracked, resolver);
  const findings = [];
  for (const file of docs) {
    const text = readText(repoRoot, file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    findings.push(...pathFindings(file, lines, tracked, generated), ...commandFindings(repoRoot, file, text, tracked, commands), ...ruleFindings(file, lines, rules));
  }
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.path}:${finding.line}:${finding.reference ?? finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

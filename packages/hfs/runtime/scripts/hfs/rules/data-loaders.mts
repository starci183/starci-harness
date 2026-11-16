// data-loaders.mts - R435: a seed-standard reaches an app by ONE path, the bring-up's seed step over the commit `data.sets` pins
// (contexts/project/stacks.md PROJECT-STACKS-13, "One path in"). The hfs check of `starci app check`, at the app root, reads the tracked
// text files (source, scripts, package.json, workflows, compose and env files, the stack declaration) and refuses every other way in:
//   HFS_DATA_SECOND_LOADER   kind `git`:     a line that runs git clone, pull, fetch, archive, submodule, sparse-checkout or remote add and
//                                            names a `<name>-seed-standard` repository;
//                            kind `command`: a package.json script, or a command name declared in source, shaped like a content sync
//                                            (`content:sync`, `standard-pull`, `content import`...), or a package.json script that names a
//                                            `-seed-standard` repository;
//                            kind `env`:     an environment variable assigned a value that names a `-seed-standard` repository, or an
//                                            upper-case name holding SEED_STANDARD (`process.env.CONTENT_SEED_STANDARD_URL`).
// Not judged: the `data.sets` declaration (its keys are lower case, so it is never an env assignment), the project's extension (ext/: a
// `completeness` check reads its standard through pinRepository, PROJECT-STACKS-13), the work tree (.starciwork), Markdown, lock files and
// the committed check cache. The seed step that loads a standard is the harness's own code (@starci/hfs stack/seeds.mts), never the app's.
import { readText, found } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

/** A repository named as a whole word that ends -seed-standard. */
const STANDARD_NAME = /(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9._-]*-seed-standard(?![A-Za-z0-9_-])/u;
/** A git invocation that brings a repository's content in. */
const GIT_FETCH = /\bgit\b.*\b(?:clone|pull|fetch|archive|submodule|sparse-checkout|remote\s+add)\b|['"]git['"]\s*,\s*\[?\s*['"](?:clone|pull|fetch|archive|submodule|sparse-checkout|remote)['"]/u;
/** The name of a content-sync command. */
const SYNC_NAME = /^(?:content|standard)[-:_ ]?(?:sync|pull|fetch|import|load)$/iu;
/** A command name declared in source: a quoted content-sync name. */
const SYNC_DECLARED = /['"`](?:content|standard)[-:_ ](?:sync|pull|fetch|import|load)['"`]/iu;
/** An environment assignment: `NAME=value`, `export NAME=value`, `ENV NAME value`, `NAME: value` (YAML), `- NAME=value` (compose). */
const ENV_ASSIGNMENT = /^\s*(?:export\s+|ENV\s+|-\s+)?["']?[A-Z][A-Z0-9_]*["']?\s*(?:=|:|\s)\s*\S/u;
/** An upper-case environment name that holds SEED_STANDARD. */
const ENV_NAME = /\b[A-Z0-9_]*SEED_STANDARD[A-Z0-9_]*\b/u;
/** The tracked files the rule reads: source, scripts, manifests, workflows, compose and env files. */
const SCANNED = /\.(?:[cm]?[jt]sx?|sh|bash|zsh|ps1|psm1|cmd|bat|ya?ml|json|toml)$|(?:^|\/)(?:Dockerfile[^/]*|Makefile|\.env[^/]*)$/u;
const SKIPPED = /^(?:ext\/|\.starciwork\/|\.starcistacks\/cache\/)|(?:^|\/)node_modules\/|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/u;
const STACK_DECLARATION = '.starcistacks/application-stacks.yaml';

/** True for a tracked file the rule reads. */
export const isLoaderCandidate = (file: string): boolean => SCANNED.test(file) && !SKIPPED.test(file);

const WHY = 'a seed-standard reaches an app only through the bring-up seed step, at the commit data.sets pins (an upsert by natural key, force once per pin); declare the standard in data.sets of .starcistacks/application-stacks.yaml and remove this path (R435, PROJECT-STACKS-13)';

const loader = (file: string, line: number, kind: 'git' | 'command' | 'env', what: string): Finding =>
  // Report-only (a warning) until the bring-up loader that applies the pinned data.sets standards ships; it turns into an error in that train.
  found('HFS_DATA_SECOND_LOADER', file, `${file}:${String(line)} ${what}: ${WHY}`, { kind, line, level: 'warning' });

/** The script findings of a package.json text: a content-sync name, or a script that names a -seed-standard repository. */
function scriptFindings(file: string, text: string): Finding[] {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return []; }
  const scripts = (doc as { scripts?: unknown } | null)?.scripts;
  if (scripts === null || typeof scripts !== 'object') return [];
  const lines = text.split('\n');
  const lineOf = (name: string): number => Math.max(1, lines.findIndex((line) => line.includes(JSON.stringify(name))) + 1);
  return Object.entries(scripts as Record<string, unknown>).flatMap(([name, command]) => {
    if (SYNC_NAME.test(name)) return [loader(file, lineOf(name), 'command', `the script ${name} is a content-sync command`)];
    const repository = typeof command === 'string' ? STANDARD_NAME.exec(command)?.[0] : undefined;
    return repository === undefined ? [] : [loader(file, lineOf(name), 'command', `the script ${name} reads the standard ${repository}`)];
  });
}

/** HFS_DATA_SECOND_LOADER of one tracked file from its text; one finding per kind, at its first line. */
export function secondLoaderFindings(file: string, text: string | null): Finding[] {
  if (text === null || !isLoaderCandidate(file)) return [];
  const findings: Finding[] = file.endsWith('package.json') ? scriptFindings(file, text) : [];
  const seen = new Set(findings.map((finding) => finding.kind));
  const declaration = file === STACK_DECLARATION;
  text.split('\n').forEach((line, at) => {
    const repository = STANDARD_NAME.exec(line)?.[0];
    if (!declaration && !seen.has('git') && repository !== undefined && GIT_FETCH.test(line)) {
      seen.add('git');
      findings.push(loader(file, at + 1, 'git', `git fetches the standard ${repository}`));
    }
    if (!declaration && !seen.has('command') && !file.endsWith('.json') && SYNC_DECLARED.test(line)) {
      seen.add('command');
      findings.push(loader(file, at + 1, 'command', 'it declares a content-sync command'));
    }
    if (!seen.has('env') && ((repository !== undefined && ENV_ASSIGNMENT.test(line)) || ENV_NAME.test(line))) {
      seen.add('env');
      findings.push(loader(file, at + 1, 'env', repository === undefined ? `the environment variable ${String(ENV_NAME.exec(line)?.[0])} names a standard` : `an environment variable names the standard ${repository}`));
    }
  });
  return findings;
}

/** Findings of R435 at the root of an app: every tracked text file it reads. */
export function dataSecondLoaderFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  return all.filter(isLoaderCandidate).flatMap((file) => secondLoaderFindings(file, readText(repoRoot, file)));
}

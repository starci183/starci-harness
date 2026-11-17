// brand.mts - R437: an AI-generated image is prompted from the app's brand folder (contexts/project/brand.md PROJECT-BRAND-1, PROJECT-BRAND-2). The folder `.starcistacks/brand/` holds
// `illustration.yaml`, whose `basePrompt: { version, text }` every prompt of an image starts with; each image under `statics/` has a sibling `<name>.prompt.yaml` that records the
// `basePrompt.version` it was prompted with and its `subject`. The findings:
//   HFS_BRAND_INVALID            `.starcistacks/brand/illustration.yaml` is not YAML or its `basePrompt` is not `{ version: <positive integer>, text: <non-empty> }` (an error);
//   HFS_BRAND_MISSING            a `statics/**/*.prompt.yaml` exists and the app has no readable `.starcistacks/brand/illustration.yaml` to prompt from;
//   HFS_BRAND_PROMPT_STALE       a prompt file records no `basePrompt.version`, or one other than the current: the image was made from an older brand prompt and is made again;
//   HFS_BRAND_PROMPT_INCOMPLETE  a prompt file is not YAML, has no `subject`, or its `prompt` does not start with the current basePrompt text.
// The last three are localOnly: a warning in `--env local` (a brand prompt moves while images are redrawn), an error in `--env prod`. The prompt files are read from the work tree, since the
// images they sit beside may be seeded and never tracked.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { found, readText } from './read.mjs';
import type { Parsed } from './rule-types.mjs';

/** The brand folder, app-root relative (slot app.starcistacks.brand). */
export const BRAND_DIR = '.starcistacks/brand';
/** The machine-readable half of the brand: the one place the base prompt and its version are written. */
export const BRAND_ILLUSTRATION_FILE = `${BRAND_DIR}/illustration.yaml`;
/** The folder of the app's statics (contexts/project/statics.md) whose prompt files this rule judges. */
export const STATICS_DIR = 'statics';
export const PROMPT_SUFFIX = '.prompt.yaml';
const RULE = '(PROJECT-BRAND-2)';
/** A walk of the statics folder reads at most this many prompt files: more is a generated dump, not provenance. */
const MAX_PROMPT_FILES = 2000;

export interface BasePrompt { version: number; text: string }

/** Whitespace folded, so a wrapped YAML block and the one-line prompt a tool sends compare equal. */
const folded = (text: string): string => text.replace(/\s+/gu, ' ').trim();
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** The basePrompt of an illustration.yaml text, or the problem that makes it invalid. */
export function parseBasePrompt(text: string): { base: BasePrompt | null; problem: string | null } {
  let doc: Parsed;
  try { doc = parseYaml(text); } catch { return { base: null, problem: 'is not YAML' }; }
  const base: unknown = plain(doc) ? (doc as Record<string, unknown>)['basePrompt'] : undefined;
  if (!plain(base)) return { base: null, problem: 'has no `basePrompt` object' };
  const { version, text: body } = base as Record<string, unknown>;
  if (!positiveInteger(version)) return { base: null, problem: `has a basePrompt.version of ${JSON.stringify(version)}, not a positive integer` };
  if (typeof body !== 'string' || folded(body) === '') return { base: null, problem: 'has an empty basePrompt.text' };
  return { base: { version, text: body }, problem: null };
}

/** The prompt files under statics/ (app-relative, sorted), walked on disk; none when the folder is absent. */
export function promptFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    if (out.length >= MAX_PROMPT_FILES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(repoRoot, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(`${rel}/${entry.name}`); }
      else if (entry.isFile() && entry.name.endsWith(PROMPT_SUFFIX)) out.push(`${rel}/${entry.name}`);
    }
  };
  walk(STATICS_DIR);
  return out;
}

/** The problems of one prompt file against the current basePrompt: the stale and the incomplete message, each null when it holds. */
function promptProblems(text: string, base: BasePrompt): { stale: string | null; incomplete: string | null } {
  let doc: Parsed;
  try { doc = parseYaml(text); } catch { return { stale: null, incomplete: 'is not YAML' }; }
  if (!plain(doc)) return { stale: null, incomplete: 'is not a YAML object of prompt, basePrompt and subject' };
  const record = doc as Record<string, unknown>;
  const recorded = plain(record['basePrompt']) ? (record['basePrompt'] as Record<string, unknown>)['version'] : undefined;
  const stale = recorded === base.version ? null : recorded === undefined ? `records no basePrompt.version (the current one is ${base.version})` : `records basePrompt.version ${JSON.stringify(recorded)}, the current one is ${base.version}`;
  const subject = record['subject'];
  const prompt = record['prompt'];
  const incomplete = typeof subject !== 'string' || subject.trim() === '' ? 'has no `subject`'
    : typeof prompt === 'string' && !folded(prompt).startsWith(folded(base.text)) ? 'has a `prompt` that does not start with the basePrompt text'
      : null;
  return { stale, incomplete };
}

/** Findings of R437 at the app root. */
export function brandFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Parsed; isRoot: boolean }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const local = { local: true };
  const findings = [];
  const sheet = readText(repoRoot, BRAND_ILLUSTRATION_FILE);
  const parsed = sheet === null ? null : parseBasePrompt(sheet);
  if (parsed !== null && parsed.base === null) findings.push(found('HFS_BRAND_INVALID', BRAND_ILLUSTRATION_FILE, `${BRAND_ILLUSTRATION_FILE} ${parsed.problem as string}: it holds \`basePrompt: { version: <integer from 1>, text: <the block every image prompt starts with> }\` ${RULE}`));
  const files = promptFiles(repoRoot);
  if (files.length === 0) return findings;
  if (parsed === null) return [...findings, found('HFS_BRAND_MISSING', BRAND_ILLUSTRATION_FILE, `${files.length} prompt file${files.length === 1 ? '' : 's'} under ${STATICS_DIR}/ (first: ${files[0] as string}) and no ${BRAND_ILLUSTRATION_FILE}: write the brand folder (\`starci app scaffold\` writes the starter, contexts/project/brand.md PROJECT-BRAND-1), then prompt the images again from its basePrompt ${RULE}`, local)];
  const { base } = parsed;
  if (base === null) return findings;
  for (const file of files) {
    const text = readText(repoRoot, file);
    if (text === null) continue;
    const { stale, incomplete } = promptProblems(text, base);
    if (stale !== null) findings.push(found('HFS_BRAND_PROMPT_STALE', file, `${file} ${stale}: the image was prompted from another brand base; build its prompt again as the basePrompt of ${BRAND_ILLUSTRATION_FILE} plus its subject, generate it again and record the version ${RULE}`, local));
    if (incomplete !== null) findings.push(found('HFS_BRAND_PROMPT_INCOMPLETE', file, `${file} ${incomplete}: a prompt file records \`basePrompt: { version }\`, a \`subject\` and the \`prompt\` that starts with the basePrompt text ${RULE}`, local));
  }
  return findings;
}

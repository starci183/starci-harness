// statics-shape.mts - R438: the shape of statics/, the repo-owned media of an app (contexts/project/statics.md PROJECT-STATICS-1), over the tracked
// files under statics/ at the app root. The folder is carried into the project's own object store by the storage image (slot app.storage.image), so
// a file there is a public object: it is named for a URL, sized for a download and kinded for a browser.
//   HFS_STATICS_FILE_KIND         a file that is not media (png jpg jpeg webp avif gif svg mp4 webm) or a prompt sidecar (<name>.prompt.yaml);
//   HFS_STATICS_KEY               a path segment that is not lowercase kebab-case (a directory, or a file name before its extension), an upper-case
//                                 extension, or a media file directly under statics/ (the first folder is the area);
//   HFS_STATICS_FILE_SIZE         a file above 2 MiB (warning) or 10 MiB (error);
//   HFS_STATICS_TREE_SIZE         the files of statics/ together above 256 MiB;
//   HFS_STATICS_PROMPT_ORPHAN     a <name>.prompt.yaml with no media file of that name beside it;
//   HFS_STATICS_PROMPT_SCHEMA     a prompt sidecar that does not parse as a YAML mapping or holds no non-empty `prompt` string.
// What else a prompt records (its subject, the basePrompt version it was made from) is judged by the brand rule over `.starcistacks/brand/` (R436, PROJECT-BRAND-2), not here.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const STATICS_MEDIA = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg', 'mp4', 'webm']);
export const STATICS_WARN_BYTES = 2 * 1024 * 1024;
export const STATICS_MAX_BYTES = 10 * 1024 * 1024;
export const STATICS_TREE_BYTES = 256 * 1024 * 1024;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PROMPT_SUFFIX = '.prompt.yaml';
const PREFIX = 'statics/';

const MIB = 1024 * 1024;
const WHY = '(PROJECT-STATICS-1)';

/** The problems of a parsed prompt sidecar; an empty list is a valid one. */
export function promptProblems(doc: unknown): string[] {
  if (!plain(doc)) return ['it is not a mapping'];
  return typeof doc.prompt === 'string' && doc.prompt.trim() !== '' ? [] : ['prompt must be a non-empty string'];
}

function sizeOf(repoRoot: string, file: string): number | null {
  readText(repoRoot, file); // records the read for the result cache: the size is a function of the file's bytes
  try { const stat = fs.statSync(path.join(repoRoot, file)); return stat.isFile() ? stat.size : null; } catch { return null; }
}

function keyFindings(file: string): Finding[] {
  const rest = file.slice(PREFIX.length);
  const segments = rest.split('/');
  const name = segments.pop() as string;
  const bad: string[] = [];
  for (const segment of segments) if (!KEBAB.test(segment)) bad.push(`folder ${segment}`);
  const stem = name.endsWith(PROMPT_SUFFIX) ? name.slice(0, -PROMPT_SUFFIX.length) : name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (!KEBAB.test(stem)) bad.push(`name ${stem}`);
  if (extension !== extension.toLowerCase()) bad.push(`extension .${extension}`);
  const findings = bad.length === 0 ? [] : [found('HFS_STATICS_KEY', file, `${file}: ${bad.join(', ')} must be lowercase kebab-case (a-z, 0-9 and single hyphens), because the path under statics/ is the key and the URL ${WHY}`)];
  if (segments.length === 0) findings.push(found('HFS_STATICS_KEY', file, `${file} sits directly under statics/: put it in an area folder (statics/<area>/...), the first segment of its key ${WHY}`));
  return findings;
}

function promptFindings(repoRoot: string, file: string): Finding[] {
  const text = readText(repoRoot, file);
  if (text === null) return [found('HFS_STATICS_PROMPT_SCHEMA', file, `${file} cannot be read as text ${WHY}`)];
  let doc: unknown;
  try { doc = parseYaml(text); } catch (error) { return [found('HFS_STATICS_PROMPT_SCHEMA', file, `${file} does not parse as YAML: ${String((error as { message?: unknown }).message ?? error).split('\n')[0]} ${WHY}`)]; }
  const problems = promptProblems(doc);
  return problems.length === 0 ? [] : [found('HFS_STATICS_PROMPT_SCHEMA', file, `${file} is not a valid prompt sidecar: ${problems.join('; ')} ${WHY}`)];
}

/** R438 over the tracked files of an app (app-relative, posix). */
export function staticsShapeFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const files = all.map((file) => file.replaceAll('\\', '/')).filter((file) => file.startsWith(PREFIX) && !file.endsWith('/.gitkeep'));
  if (files.length === 0) return [];
  const present = new Set(files);
  const findings: Finding[] = [];
  let total = 0;
  for (const file of files) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    const prompt = name.endsWith(PROMPT_SUFFIX);
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const media = !prompt && STATICS_MEDIA.includes(extension);
    if (!prompt && !media) { findings.push(found('HFS_STATICS_FILE_KIND', file, `${file} is not media (${STATICS_MEDIA.join(' ')}), or a <name>.prompt.yaml sidecar ${WHY}`)); continue; }
    findings.push(...keyFindings(file));
    const bytes = sizeOf(repoRoot, file);
    if (bytes !== null) {
      total += bytes;
      if (bytes > STATICS_MAX_BYTES) findings.push(found('HFS_STATICS_FILE_SIZE', file, `${file} is ${String(bytes)} bytes, above the ${String(STATICS_MAX_BYTES / MIB)} MiB limit of a static; compress or resize it ${WHY}`, { bytes }));
      else if (bytes > STATICS_WARN_BYTES) findings.push({ ...found('HFS_STATICS_FILE_SIZE', file, `${file} is ${String(bytes)} bytes, above ${String(STATICS_WARN_BYTES / MIB)} MiB: every client downloads it; compress or resize it ${WHY}`, { bytes }), level: 'warning' });
    }
    if (prompt) {
      const stem = file.slice(0, -PROMPT_SUFFIX.length);
      if (!STATICS_MEDIA.some((ext) => present.has(`${stem}.${ext}`))) findings.push(found('HFS_STATICS_PROMPT_ORPHAN', file, `${file} has no media file of that name beside it (${stem}.<${STATICS_MEDIA.join('|')}>): it is the prompt of an image, so delete it or add the image ${WHY}`));
    }
    if (prompt) findings.push(...promptFindings(repoRoot, file));
  }
  if (total > STATICS_TREE_BYTES) findings.push(found('HFS_STATICS_TREE_SIZE', 'statics', `statics/ holds ${String(total)} bytes, above ${String(STATICS_TREE_BYTES / MIB)} MiB: it is baked into the storage image, so keep the repository's own media small and put user media in object storage ${WHY}`, { bytes: total }));
  return findings;
}

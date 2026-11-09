// gallery.mts - R395: every app source repository carries the screenshot gallery (contexts/project/gallery.md PROJECT-GALLERY-1). The files are managed
// (`starci app sync` renders them, slot app.gallery); this rule judges the facts the gallery stands on, with the values of `ruleParams.gallery`:
//   HFS_APP_GALLERY_MISSING        the gallery folder, or one of its managed files, is absent: run `starci app sync --execute`;
//   HFS_APP_GALLERY_SCRIPT         package.json has no dev script that serves on the app's base port + `portOffset` with --strictPort (or the app declares
//                                   no `local.basePort` to derive it from);
//   HFS_APP_GALLERY_VITE_UNPINNED  vite is absent from package.json or not an exact version;
//   HFS_APP_GALLERY_SHOTS_TRACKED  the shot PNGs are not git-ignored, or some are tracked.
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { declaredBasePort, galleryParams, galleryPort } from '../gallery.mjs';
import type { GalleryParams } from '../gallery.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

/** The files the gallery is made of, gallery-relative: the managed ones (slot app.gallery). */
export const GALLERY_FILES = Object.freeze(['package.json', 'index.html', 'README.md', 'src/main.js', 'src/style.css']);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const posix = path.posix;

/** The gitignore lines of a file: comments, blanks and negations dropped. */
const ignoreLines = (text: string | null): string[] => (text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));

/** The lines that ignore every PNG under the shots folder, in a gitignore at the app root or (nested) in the gallery folder's own. */
function ignoringLines(params: GalleryParams, nested: boolean): Set<string> {
  const rooted = [params.ignoredShots, 'shots/', 'shots', 'shots/**', '**/*.png', '*.png'];
  const lines = !nested
    ? [...rooted.filter((line) => line.startsWith('**/') || line.startsWith('*.')), ...rooted.filter((line) => !line.startsWith('**/') && !line.startsWith('*.')).map((line) => `${params.dir}/${line}`), `${params.dir}/**/*.png`, `**/shots/`]
    : rooted;
  return new Set(lines.flatMap((line) => [line, `/${line}`]));
}

/** True when a gitignore at the app root or in the gallery folder ignores the shot PNGs. */
export function ignoresShots(text: string | null, params: GalleryParams, nested: boolean): boolean {
  const accepted = ignoringLines(params, nested);
  return ignoreLines(text).some((line) => accepted.has(line));
}

/** The problem of a package.json dev script, or null when it serves on `expected` with --strictPort (any port when none is expected). */
function scriptProblem(script: unknown, expected: number | null, params: GalleryParams): string | null {
  if (typeof script !== 'string' || script.trim() === '') return `package.json declares no "${params.devScript}" script: it must be \`vite --port <base + ${params.portOffset}> --strictPort\``;
  const port = /--port[ =](\d+)/u.exec(script)?.[1];
  if (port === undefined) return `the "${params.devScript}" script (${script}) names no --port: it must serve on the app's base port + ${params.portOffset}`;
  if (!/--strictPort\b/u.test(script)) return `the "${params.devScript}" script (${script}) lacks --strictPort: a taken port must fail, never move the gallery off base + ${params.portOffset}`;
  if (expected !== null && Number(port) !== expected) return `the "${params.devScript}" script serves on ${port}, not ${expected} (local.basePort + ${params.portOffset})`;
  return null;
}

/** Findings of R395 at the app root. */
export function appGalleryFindings({ repoRoot, repo, isRoot, all = [], inScope = () => true, manifest }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[]; inScope?: (file: string) => boolean; manifest?: Parsed }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const params = galleryParams(manifest);
  const at = (file: string) => posix.join(params.dir, file);
  const manifestFile = at('package.json');
  const stack = findStackDeclaration(repoRoot);
  const base = stack.doc ? declaredBasePort(stack.doc) : null;
  const port = galleryPort(base, params);
  const findings = [];
  const missing = GALLERY_FILES.filter((file) => readText(repoRoot, at(file)) === null);
  if (missing.length > 0) {
    const how = base === null ? 'declare environments.dev.local.basePort in .starcistacks/application-stacks.yaml (R389), then run `starci app sync --execute`' : `run \`starci app sync --execute\` (it renders the gallery on port ${port})`;
    findings.push(found('HFS_APP_GALLERY_MISSING', `${params.dir}/`, `the app has no screenshot gallery (missing ${missing.map(at).join(', ')}): every app source repository carries ${params.dir}/, a Vite app that shows ${params.shots}/<area>/<page>__<width>__<before|after>.png (PROJECT-GALLERY-1); ${how}`));
  }
  const manifestJson = readJson(repoRoot, manifestFile);
  if (manifestJson !== null && inScope(manifestFile)) {
    const scripts = plain(manifestJson.scripts) ? (manifestJson.scripts as Record<string, unknown>) : {};
    const problem = scriptProblem(scripts[params.devScript], port, params);
    if (problem !== null) findings.push(found('HFS_APP_GALLERY_SCRIPT', manifestFile, `${problem} (PROJECT-GALLERY-1; \`starci app sync --execute\` restores the managed file)`));
    else if (port === null) findings.push(found('HFS_APP_GALLERY_SCRIPT', manifestFile, `the app declares no local.basePort, so the gallery port (base + ${params.portOffset}) cannot be judged: declare environments.dev.local.basePort (R389, PROJECT-GALLERY-1)`));
    const vite = [manifestJson.devDependencies, manifestJson.dependencies].map((block) => (plain(block) ? (block as Record<string, unknown>)['vite'] : undefined)).find((version) => version !== undefined);
    if (typeof vite !== 'string' || !EXACT_VERSION.test(vite)) findings.push(found('HFS_APP_GALLERY_VITE_UNPINNED', manifestFile, `vite is ${typeof vite === 'string' ? `"${vite}", not an exact version` : 'not a devDependency'}: pin it exactly (e.g. "${params.vite}"), as every dependency of an app is pinned (PROJECT-GALLERY-1)`));
  }
  if (missing.length < GALLERY_FILES.length) {
    const ignored = ignoresShots(readText(repoRoot, '.gitignore'), params, false) || ignoresShots(readText(repoRoot, at('.gitignore')), params, true);
    if (!ignored) findings.push(found('HFS_APP_GALLERY_SHOTS_TRACKED', '.gitignore', `${params.shots}/**/*.png is not git-ignored: the screenshots are local evidence, never source; ignore them with \`${params.dir}/${params.ignoredShots}\` (the managed root .gitignore block of \`starci app sync --execute\` carries it)`));
  }
  const tracked = all.filter((file) => file.startsWith(`${params.shots}/`) && file.toLowerCase().endsWith('.png'));
  if (tracked.length > 0) findings.push(found('HFS_APP_GALLERY_SHOTS_TRACKED', tracked[0] as string, `${tracked.length} screenshot PNG${tracked.length === 1 ? ' is' : 's are'} tracked under ${params.shots}/ (first: ${tracked[0]}): untrack them (git rm --cached) and keep ${params.dir}/${params.ignoredShots} ignored`));
  return findings;
}

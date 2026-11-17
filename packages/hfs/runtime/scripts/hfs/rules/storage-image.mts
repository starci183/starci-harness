// storage-image.mts - R440: a project ships its OWN MinIO, in development and in production, on ONE condition (contexts/project/statics.md PROJECT-STATICS-2):
// it has statics/ (a file other than the .gitkeep starter) or its back end needs object storage (scripts/lib/storage-need.mts: the @starci/object-storage
// dependency, a `storage` custody member, a sealed storage-* secret). No condition met: no MinIO. The store is built from the managed
// .starcistacks/images/storage/Dockerfile (slot app.storage.image), whose entrypoint writes statics/ into the bucket. Over the stack declaration and the compose
// files of the environments:
//   STACK_STORAGE_MISSING       the condition holds and the dev environment declares no `storage` service (or, in a lite app, the production environment
//                               declares no `deploy.images.storage`): error;
//   STACK_STORAGE_UNUSED        a storage service is declared and no condition holds: the app runs an object store nothing uses (warning);
//   STACK_STORAGE_IMAGE_UNUSED  statics/ holds media and the dev `storage` service does not build the override Dockerfile, so the statics never reach the bucket;
//   STACK_STORAGE_IMAGE_SHAPE   the dev `storage` service builds the override but one of these fails: build.context is the app root, build.dockerfile is the
//                               override, image is <project>-storage:local, the environment holds STATICS_BUCKET (non-empty), STATICS_PREFIX (kebab-case
//                               segments) and STATICS_PUBLIC (download or none), the healthcheck tests /tmp/statics-ready, statics/ exists; or, in a lite
//                               production, `deploy.images.storage` names another app than `storage`.
// Drift of the Dockerfile itself is HFS_MANAGED_FILE_DRIFT. Whether a prompt is stale against its brand base is the brand rule's, not this one's.
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration, readDeclaration, STACK_ROOT } from '../../lib/stack-declaration.mjs';
import { STATICS_DIR, storageNeed } from '../../lib/storage-need.mjs';
import { found, readJson } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const STACK_FILE = `${STACK_ROOT}/application-stacks.yaml`;
const OVERRIDE = `${STACK_ROOT}/images/storage/Dockerfile`;
const KEBAB_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/u;
const WHY = '(PROJECT-STATICS-2)';
const map = (value: unknown): Record<string, unknown> => (plain(value) ? value : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The environment of a compose service as a map, whatever form it is written in (mapping or KEY=VALUE list). */
function environmentOf(service: Record<string, unknown>): Record<string, string> {
  const raw = service.environment;
  if (Array.isArray(raw)) return Object.fromEntries(raw.filter((entry): entry is string => typeof entry === 'string' && entry.includes('=')).map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
  return Object.fromEntries(Object.entries(map(raw)).map(([key, value]) => [key, String(value ?? '')]));
}

/** The compose services of an environment, with the compose file's folder (app-relative) of each. */
function composeServices(repoRoot: string, environment: string, spec: Parsed): { name: string; service: Record<string, unknown>; dir: string }[] {
  const out: { name: string; service: Record<string, unknown>; dir: string }[] = [];
  for (const relative of Array.isArray(spec.composeFiles) ? spec.composeFiles : []) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) continue;
    const doc = readDeclaration(path.join(repoRoot, STACK_ROOT, environment, relative)).doc;
    const dir = path.posix.dirname(`${STACK_ROOT}/${environment}/${relative.replaceAll('\\', '/')}`);
    for (const [name, service] of Object.entries(map(doc?.services))) if (plain(service)) out.push({ name, service, dir });
  }
  return out;
}

/** True when the service's build names the managed storage Dockerfile, whatever its context says (a wrong context is a shape problem, not a missing build). */
function buildsOverride(service: Record<string, unknown>): boolean {
  const build = service.build;
  const named = typeof build === 'string' ? build : plain(build) ? `${text(build.context)}/${text(build.dockerfile)}` : '';
  return named.includes('images/storage');
}

/** The context and Dockerfile of a compose service's build, normalised to app-relative paths ('' is the app root). */
function buildOf(service: Record<string, unknown>, dir: string): { context: string; dockerfile: string } | null {
  const build = service.build;
  if (typeof build === 'string') return { context: path.posix.normalize(path.posix.join(dir, build)).replace(/^\.$/u, ''), dockerfile: 'Dockerfile' };
  if (!plain(build)) return null;
  const context = path.posix.normalize(path.posix.join(dir, text(build.context) || '.')).replace(/^\.$/u, '');
  const dockerfile = text(build.dockerfile) || 'Dockerfile';
  return { context, dockerfile: path.posix.normalize(path.posix.join(context === '' ? '.' : context, dockerfile)).replace(/^\.\//u, '') };
}

function shapeProblems(service: Record<string, unknown>, dir: string, project: string, hasStaticsFolder: boolean): string[] {
  const bad: string[] = [];
  const build = buildOf(service, dir);
  if (build === null || build.context !== '') bad.push('build.context must resolve to the app root, so statics/ is reachable');
  if (build === null || build.dockerfile !== OVERRIDE) bad.push(`build.dockerfile must be ${OVERRIDE}`);
  if (service.image !== `${project}-storage:local`) bad.push(`image must be ${project}-storage:local`);
  const env = environmentOf(service);
  if ((env.STATICS_BUCKET ?? '').trim() === '') bad.push('environment STATICS_BUCKET must name the bucket');
  if (!KEBAB_PATH.test(env.STATICS_PREFIX ?? '')) bad.push('environment STATICS_PREFIX must be kebab-case segments (statics)');
  if (!['download', 'none'].includes(env.STATICS_PUBLIC ?? '')) bad.push('environment STATICS_PUBLIC must be download or none');
  if (!JSON.stringify(map(service.healthcheck).test ?? '').includes('/tmp/statics-ready')) bad.push('healthcheck must test /tmp/statics-ready, the marker the entrypoint writes once the statics are loaded');
  if (!hasStaticsFolder) bad.push(`${STATICS_DIR}/ must exist (the Dockerfile copies it): add ${STATICS_DIR}/.gitkeep`);
  return bad;
}

/** The condition and the declared services of one app, as R440 judges them. Pure over its inputs. */
export function storageImageFindings(input: {
  stack: Parsed; packageJson: unknown; project: string; edition: string | undefined; staticsFiles: readonly string[];
  compose: (environment: string, spec: Parsed) => { name: string; service: Record<string, unknown>; dir: string }[];
}): Finding[] {
  const { stack, packageJson, project, edition, staticsFiles, compose } = input;
  if (!plain(stack) || !plain(stack.environments)) return [];
  const need = storageNeed({ staticsFiles, packageJson, stack });
  const media = staticsFiles.some((file) => file.startsWith(`${STATICS_DIR}/`) && file !== `${STATICS_DIR}/.gitkeep` && !/\.ya?ml$/u.test(file));
  const hasFolder = staticsFiles.some((file) => file.startsWith(`${STATICS_DIR}/`));
  const findings: Finding[] = [];
  for (const [environment, spec] of Object.entries(stack.environments)) {
    if (!plain(spec)) continue;
    const at = `environments.${environment}`;
    if (spec.runtime === 'docker-compose' && plain(spec.local)) {
      const services = compose(environment, spec);
      const declared = new Set((Array.isArray(spec.local.services) ? spec.local.services : []).flatMap((entry) => (plain(entry) && typeof entry.name === 'string' ? [entry.name] : [])));
      const storage = services.find((entry) => entry.name === 'storage');
      const present = storage !== undefined || declared.has('storage');
      if (need.needed && !present) findings.push(found('STACK_STORAGE_MISSING', STACK_FILE, `${at}: ${need.statics ? 'statics/ holds files' : 'the back end uses object storage'} and the environment declares no \`storage\` service: add the storage service built from ${OVERRIDE} (starci app sync --execute renders the Dockerfile) ${WHY}`, { environment, reason: need.statics ? 'statics' : 'backend' }));
      if (!need.needed && present) findings.push({ ...found('STACK_STORAGE_UNUSED', STACK_FILE, `${at}: a \`storage\` service runs and nothing needs it (no file under statics/ besides .gitkeep, no ${'@starci/object-storage'} dependency, no \`storage\` custody member): remove the service, or add the statics or the storage use ${WHY}`, { environment }), level: 'warning' });
      if (storage !== undefined) {
        const builds = buildsOverride(storage.service);
        if (media && !builds) findings.push(found('STACK_STORAGE_IMAGE_UNUSED', `${storage.dir}/compose.yaml`, `${at}: statics/ holds media but the \`storage\` service does not build ${OVERRIDE}, so the statics never reach the bucket: build the managed image (build.context the app root, build.dockerfile ${OVERRIDE}) ${WHY}`, { environment }));
        else if (builds) {
          const problems = shapeProblems(storage.service, storage.dir, project, hasFolder);
          if (problems.length > 0) findings.push(found('STACK_STORAGE_IMAGE_SHAPE', storage.dir, `${at}: the \`storage\` service breaks the shape of the storage image: ${problems.join('; ')} ${WHY}`, { environment }));
        }
      }
    } else if (edition === 'lite' && spec.runtime === 'docker-swarm' && plain(spec.deploy)) {
      const images = map(spec.deploy.images);
      const entry = images.storage;
      if (need.needed && entry === undefined) findings.push(found('STACK_STORAGE_MISSING', STACK_FILE, `${at}.deploy.images: the project needs its own object store and the production deploy builds no \`storage\` image: declare \`storage: {app: storage}\` (built from ${OVERRIDE}) and the \`storage\` service of the swarm stack ${WHY}`, { environment, reason: need.statics ? 'statics' : 'backend' }));
      if (!need.needed && entry !== undefined) findings.push({ ...found('STACK_STORAGE_UNUSED', STACK_FILE, `${at}.deploy.images.storage: the production deploy builds a storage image and nothing needs it ${WHY}`, { environment }), level: 'warning' });
      if (entry !== undefined && !(plain(entry) && entry.app === 'storage')) findings.push(found('STACK_STORAGE_IMAGE_SHAPE', STACK_FILE, `${at}.deploy.images.storage must be {app: storage}, the app of ${OVERRIDE} ${WHY}`, { environment }));
    }
  }
  return findings;
}

/** Findings of R440 at the app root of an app. */
export function storageImageRuleFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const { doc } = findStackDeclaration(repoRoot);
  if (!doc) return [];
  return storageImageFindings({
    stack: doc, packageJson: readJson(repoRoot, 'package.json'), project: String(readJson(repoRoot, 'hfs.json')?.project ?? 'app'), edition: repo.edition,
    staticsFiles: all.map((file) => file.replaceAll('\\', '/')).filter((file) => file.startsWith(`${STATICS_DIR}/`)),
    compose: (environment, spec) => composeServices(repoRoot, environment, spec),
  });
}

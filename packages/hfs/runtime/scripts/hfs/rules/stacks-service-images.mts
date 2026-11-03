// stacks-service-images.mjs - R374: a customised service runs from an image the app builds, never from an upstream image with code mounted into it.
//   STACKS_CODE_BIND_MOUNT      a stack or compose file bind-mounts code, a script, a plugin or a writable repository path into a service container.
//                               Allowed: a named volume, a secret or config grant (not volumes), a bind under the data root (`${data}`, `${STACK_DATA_DIR}`) or a least grant (`${STACK_GRANT_<NAME>}`),
//                               the docker socket read-only, and a read-only plain data file (json, yaml, toml, conf, ini, properties, txt, pem, crt, csv).
//   STACKS_IMAGE_BASE_UNPINNED  a Dockerfile of `.starcistacks/images/<name>/` has a FROM that is not digest-pinned.
//   STACKS_IMAGE_BASE_NOT_FORK  the image folder of a service the harness owns a fork image for (knowledge/hfs/fork-images.yaml) does not end FROM that fork.
//   STACKS_IMAGE_ENV_DIVERGES   a service that has an image folder runs a literal third-party image in some environment: every environment runs the
//                               image built from the folder (compose `build.context`, or a project-owned or variable image reference), so dev and production share it.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { findStackDeclaration, readDeclaration, STACK_ROOT } from '../../lib/stack-declaration.mjs';
import { found, readJson } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const FORKS = new URL('../../../knowledge/hfs/fork-images.yaml', import.meta.url);
const ENV_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const DATA_ROOT = /^(?:\$\{(?:data|STACK_DATA_DIR|STACK_GRANT_[A-Z0-9_]+)\}|\$(?:data|STACK_DATA_DIR|STACK_GRANT_[A-Z0-9_]+))(?:[\\/]|$)/u;
const DATA_FILE = /\.(?:json|ya?ml|toml|conf|cnf|cfg|ini|properties|txt|pem|crt|csv)$/iu;
const SOCKET = '/var/run/docker.sock';
const mapping = (value: unknown): Parsed => (plain(value) ? (value as Parsed) : {});
type Finding = ReturnType<typeof found>;

/** The fork repositories the harness owns, by service name. */
export function forkImages(): Record<string, string> {
  return mapping(mapping(parseYaml(fs.readFileSync(FORKS, 'utf8'))).images) as Record<string, string>;
}

/** One volume entry as { source, readOnly } when it is a bind mount (a host path), else null. */
function bindOf(entry: unknown): { source: string; readOnly: boolean } | null {
  if (typeof entry === 'string') {
    const [source = '', , mode = ''] = entry.split(':');
    if (!/^(?:\.|\/|~|\$\{|\$[A-Za-z])/u.test(source)) return null;
    return { source, readOnly: mode.split(',').includes('ro') };
  }
  const long = mapping(entry);
  if (long.type !== 'bind' || typeof long.source !== 'string') return null;
  return { source: long.source, readOnly: long.read_only === true };
}

/** Whether a bind mount is a data volume or plain read-only config data, the line R374 draws. */
const allowedBind = ({ source, readOnly }: { source: string; readOnly: boolean }): boolean =>
  DATA_ROOT.test(source) || (readOnly && (source === SOCKET || DATA_FILE.test(source)));

const baseOf = (reference: string): string => reference.replace(/@sha256:[0-9a-f]+$/iu, '').replace(/:[^/:]+$/u, '');

function bindFindings(display: string, environment: string, services: Parsed): Finding[] {
  return Object.entries(services).flatMap(([name, service]) => (Array.isArray(mapping(service).volumes) ? (mapping(service).volumes as unknown[]) : [])
    .map(bindOf).filter((bind): bind is { source: string; readOnly: boolean } => bind !== null && !allowedBind(bind))
    .map((bind) => found('STACKS_CODE_BIND_MOUNT', display, `${environment}: service ${name} bind-mounts ${bind.source}; code, plugins and scripts are baked into an image built from .starcistacks/images/${name}/ (FROM the pinned base, or the harness fork image), and only data volumes, secrets and read-only plain config data are mounted`)));
}

function dockerfileFindings(repoRoot: string, forks: Record<string, string>): Finding[] {
  const images = path.join(repoRoot, STACK_ROOT, 'images');
  if (!fs.existsSync(images)) return [];
  return fs.readdirSync(images, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const display = `${STACK_ROOT}/images/${entry.name}/Dockerfile`;
    let text: string;
    try { text = fs.readFileSync(path.join(images, entry.name, 'Dockerfile'), 'utf8'); } catch { return []; }
    const stages = new Set<string>();
    const bases: string[] = [];
    const findings: Finding[] = [];
    for (const line of text.split(/\r?\n/u)) {
      const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/iu.exec(line);
      if (!from) continue;
      const ref = from[1] as string;
      if (from[2]) stages.add(from[2].toLowerCase());
      if (stages.has(ref.toLowerCase()) || ref === 'scratch') continue;
      bases.push(ref);
      if (!/@sha256:[0-9a-f]{64}/iu.test(ref)) findings.push(found('STACKS_IMAGE_BASE_UNPINNED', display, `FROM ${ref} is not pinned by digest (name@sha256:...)`));
    }
    const fork = forks[entry.name];
    const last = bases.at(-1);
    if (fork !== undefined && last !== undefined && baseOf(last) !== fork) findings.push(found('STACKS_IMAGE_BASE_NOT_FORK', display, `the harness owns the StarCi fork image ${fork} for ${entry.name}; the final stage must be FROM ${fork}@sha256:..., not ${baseOf(last)}`));
    return findings;
  });
}

/** Whether a service's image/build is the one built from its image folder, or a project-owned or variable reference. */
function builtFromFolder(service: Parsed, name: string, project: string): boolean {
  const build = service.build;
  const context = typeof build === 'string' ? build : typeof mapping(build).context === 'string' ? String(mapping(build).context) : '';
  if (context !== '' && context.replaceAll('\\', '/').includes(`images/${name}`)) return true;
  const image = typeof service.image === 'string' ? service.image : '';
  return image.includes('${') || image.startsWith(`${project}/`) || image.startsWith(`${project}-`) || image.includes(`/${project}/`);
}

/** Findings of R374 for the app root. */
export function stacksServiceImageFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Repo; isRoot: boolean }): Finding[] {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const { doc } = findStackDeclaration(repoRoot);
  if (!doc) return [];
  const project = String(readJson(repoRoot, 'hfs.json')?.project ?? 'app');
  const folders = path.join(repoRoot, STACK_ROOT, 'images');
  const withFolder = new Set(fs.existsSync(folders) ? fs.readdirSync(folders, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);
  const findings = dockerfileFindings(repoRoot, forkImages());
  for (const [environment, spec] of Object.entries(mapping(mapping(doc).environments))) {
    if (!ENV_NAME.test(environment) || !plain(spec)) continue;
    const files = Array.isArray((spec as Parsed).composeFiles) ? ((spec as Parsed).composeFiles as unknown[]) : [];
    for (const relative of files) {
      if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) continue;
      const file = path.join(repoRoot, STACK_ROOT, environment, relative);
      const display = path.relative(repoRoot, file).split(path.sep).join('/');
      const services = mapping(readDeclaration(file).doc?.services);
      findings.push(...bindFindings(display, environment, services));
      for (const [name, service] of Object.entries(services)) {
        if (withFolder.has(name) && !builtFromFolder(mapping(service), name, project)) findings.push(found('STACKS_IMAGE_ENV_DIVERGES', display, `${environment}: service ${name} has an image folder but runs ${String(mapping(service).image)}; every environment runs the image built from .starcistacks/images/${name}/ so dev and production share one image`));
      }
    }
  }
  return findings;
}

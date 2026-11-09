// local-config.mts - loads `environments.<env>.local` of .starcistacks/application-stacks.yaml for the dev verbs of `starci app stack`.
// The block is read and judged by the module `starci app check` uses (runtime/scripts/hfs/stack-local-config.mts).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLocal, LOCAL_CONFIG_CODE } from '../runtime/scripts/hfs/stack-local-config.mjs';
import type { LocalBlock } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { galleryParams, galleryPort } from '../runtime/scripts/hfs/gallery.mjs';
import { readYaml, STACKS_DIR, STACKS_FILE } from './config.mjs';
import { refusal } from './errors.mjs';

/** The dev configuration of one environment, with absolute paths. */
export interface LocalConfig extends LocalBlock {
  env: string;
  appProject: string;
  repoRoot: string;
  envDir: string;
  composeFiles: string[];
  secretsDir: string;
}

/** True when the environment is declared and runs docker-compose (the dev kind); false for a swarm or an unknown one. */
export function isLocalEnvironment(repoRoot: string, env: string): boolean {
  try {
    const declaration = readYaml(path.join(repoRoot, STACKS_DIR, STACKS_FILE), STACKS_FILE);
    return declaration?.environments?.[env]?.runtime === 'docker-compose';
  } catch { return false; }
}

/**
 * The screenshot gallery as a native process of the environment (R395, PROJECT-GALLERY-1): an app that declares `local.basePort` and carries
 * `gallery/package.json` gets the gallery dev server on base + `ruleParams.gallery.portOffset` next to its web and api processes, with its one-time
 * install, a readiness row and an origin, so `stack up` starts it, `stack down` ends it and `stack status` lists it. A process the app declares
 * itself under the name `gallery` (or a port or setup of that name) is kept untouched.
 */
export function withGallery(config: LocalBlock, repoRoot: string): LocalBlock {
  const params = galleryParams();
  const port = galleryPort(config.basePort, params);
  const taken = config.processes.some((run) => run.name === 'gallery') || Object.hasOwn(config.ports, 'gallery') || Object.values(config.ports).includes(port ?? -1)
    || config.setup.some((run) => run.name === 'gallery-install') || config.seed.some((run) => run.name === 'gallery-install');
  if (port === null || taken || !fs.existsSync(path.join(repoRoot, params.dir, 'package.json'))) return config;
  const url = 'http://localhost:${port.gallery}/';
  const command = { heavy: 'none' as const, skipIfExists: null, env: {}, files: [], after: 'migrate' as const };
  return {
    ...config,
    ports: { ...config.ports, gallery: port },
    setup: [...config.setup, { name: 'gallery-install', argv: ['npm', 'install', '--no-audit', '--no-fund'], cwd: params.dir, ...command, heavy: 'install', skipIfExists: 'node_modules' }],
    processes: [...config.processes, { name: 'gallery', argv: ['npm', 'run', params.devScript], cwd: params.dir, ...command, port: 'gallery', health: { name: 'gallery', url, method: 'GET', status: 200, contains: null } }],
    ready: [...config.ready, { name: 'gallery-live', url, method: 'GET', status: 200, contains: null }],
    origins: [...config.origins, { name: 'gallery', url }],
  };
}

/** The normalised dev configuration; a refusal names every problem when the block is missing or invalid. */
export function loadLocalConfig({ repoRoot, env }: { repoRoot: string; env: string }): LocalConfig {
  const declaration = readYaml(path.join(repoRoot, STACKS_DIR, STACKS_FILE), STACKS_FILE);
  const environment = declaration?.environments?.[env];
  if (!environment) throw refusal('STACKS_DEPLOY_ENV_UNKNOWN', `${STACKS_FILE} declares no environment ${env}`);
  if (environment.runtime !== 'docker-compose') throw refusal('STACK_LOCAL_NOT_DEV', `environment ${env} runs ${environment.runtime}; up, down, doctor and logs run a docker-compose dev environment`);
  if (environment.local === undefined) throw refusal('STACK_LOCAL_UNDECLARED', `environment ${env} has no local block in ${STACKS_FILE}: declare the ports, services, processes and probes the dev environment runs (PROJECT-STACKS-6)`);
  const appProject = String(JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')).project);
  const { config, problems } = normalizeLocal(environment.local, { project: appProject, env });
  if (!config) {
    const first = problems.slice(0, 6).map((item) => `${item.at}: ${item.message}`).join('; ');
    throw refusal(LOCAL_CONFIG_CODE, `${problems.length} problem${problems.length === 1 ? '' : 's'} in environments.${env}.local: ${first}`);
  }
  const envDir = path.join(repoRoot, STACKS_DIR, env);
  const composeFiles = ((environment.composeFiles as string[] | undefined) ?? []).map((file) => path.join(envDir, file));
  return { ...withGallery(config, repoRoot), env, appProject, repoRoot, envDir, composeFiles, secretsDir: path.join(envDir, 'secrets') };
}

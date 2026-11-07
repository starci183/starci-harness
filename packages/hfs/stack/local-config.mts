// local-config.mts - loads `environments.<env>.local` of .starcistacks/application-stacks.yaml for the dev verbs of `starci app stack`.
// The block is read and judged by the module `starci app check` uses (runtime/scripts/hfs/stack-local-config.mts).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLocal, LOCAL_CONFIG_CODE } from '../runtime/scripts/hfs/stack-local-config.mjs';
import type { LocalBlock } from '../runtime/scripts/hfs/stack-local-config.mjs';
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
  return { ...config, env, appProject, repoRoot, envDir, composeFiles, secretsDir: path.join(envDir, 'secrets') };
}

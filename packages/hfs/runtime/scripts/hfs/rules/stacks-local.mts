// stacks-local.mjs - R372 and R373: the dev environment of an app is declared runnable and its runbook names the harness verb.
//   R372 STACKS_LOCAL_CONFIG_INVALID  every docker-compose environment carries a `local` block that the dev verbs of `starci app stack`
//                                      normalise (scripts/hfs/stack-local-config.mjs), and its compose services exist in the compose files;
//        STACKS_DEV_UNDECLARED         a lite app declares at least one docker-compose environment (the dev kind of PROJECT-STACKS-3).
//   R373 STACKS_RUNBOOK_DOCKER_COMMAND the runbook of a docker-compose environment names `starci app stack up --env <env>` and carries no
//                                      `docker build|run|compose|create|start|stop|pull|push` or `docker stack deploy` command (rules.md rule 8).
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration, readDeclaration, STACK_ROOT } from '../../lib/stack-declaration.mjs';
import { normalizeLocal } from '../stack-local-config.mjs';
import { found, readJson } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const DECLARATION = `${STACK_ROOT}/application-stacks.yaml`;
const ENV_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const DOCKER_COMMAND = /^\s*(?:[$>]\s*)?(?:\w+=\S+\s+)*docker(?:-compose)?\s+(?:build|buildx|run|compose|create|start|stop|rm|pull|push|stack\s+deploy|stack\s+rm|service)\b/u;
const mapping = (value: Parsed) => (plain(value) ? value : {});

function composeServices(envDir: string, spec: Parsed): Set<string> {
  const names = new Set<string>();
  for (const relative of Array.isArray(spec.composeFiles) ? spec.composeFiles : []) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) continue;
    for (const name of Object.keys(mapping(readDeclaration(path.join(envDir, relative)).doc?.services))) names.add(name);
  }
  return names;
}

function localFindings({ repoRoot, project, environment, spec }: { repoRoot: string; project: string; environment: string; spec: Parsed }) {
  const at = `environments.${environment}.local`;
  if (spec.local === undefined) return [found('STACKS_LOCAL_CONFIG_INVALID', DECLARATION, `environments.${environment} runs docker-compose and declares no local block: declare the ports, services, processes and probes \`starci app stack up --env ${environment}\` runs`)];
  const { config, problems } = normalizeLocal(spec.local, { project, env: environment });
  const findings = problems.map((problem) => found('STACKS_LOCAL_CONFIG_INVALID', DECLARATION, `${at}.${problem.at}: ${problem.message}`));
  if (config) {
    const services = composeServices(path.join(repoRoot, STACK_ROOT, environment), spec);
    for (const service of config.services) if (!services.has(service.name)) findings.push(found('STACKS_LOCAL_CONFIG_INVALID', DECLARATION, `${at}.services: ${service.name} is not a service of the compose files of ${environment}`));
  }
  return findings;
}

function runbookFindings({ repoRoot, environment, spec }: { repoRoot: string; environment: string; spec: Parsed }) {
  const relative = typeof spec.runbook === 'string' ? spec.runbook : 'README.md';
  const file = path.join(repoRoot, STACK_ROOT, environment, relative);
  const display = path.relative(repoRoot, file).split(path.sep).join('/');
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const findings = text.split(/\r?\n/u).map((line, index) => ({ line, index })).filter(({ line }) => DOCKER_COMMAND.test(line) || /`docker\s+(?:build|run|compose|create|start|stop|pull|push|stack)\b/u.test(line))
    .map(({ index }) => found('STACKS_RUNBOOK_DOCKER_COMMAND', `${display}:${index + 1}`, `the runbook of ${environment} carries a docker command; Docker is run by the harness: name \`starci app stack up --env ${environment}\` instead`));
  if (!text.includes(`starci app stack up --env ${environment}`)) findings.push(found('STACKS_RUNBOOK_DOCKER_COMMAND', display, `the runbook of ${environment} does not name \`starci app stack up --env ${environment}\`, the one command that brings the environment up`));
  return findings;
}

/** Findings of the dev environments of the app root. */
export function stacksLocalFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Repo; isRoot: boolean }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const { doc } = findStackDeclaration(repoRoot);
  if (!doc) return [];
  const project = String(readJson(repoRoot, 'hfs.json')?.project ?? 'app');
  const judged = Object.entries(mapping(mapping(doc).environments)).filter(([environment, spec]) => ENV_NAME.test(environment) && plain(spec) && (spec as Parsed).runtime === 'docker-compose');
  const findings = judged.flatMap(([environment, spec]) => [...localFindings({ repoRoot, project, environment, spec }), ...runbookFindings({ repoRoot, environment, spec })]);
  if (repo.edition === 'lite' && judged.length === 0) findings.push(found('STACKS_DEV_UNDECLARED', DECLARATION, 'a lite app declares its dev environment: an environment with runtime docker-compose and a local block, run by `starci app stack up --env dev` (PROJECT-STACKS-3, PROJECT-STACKS-6)'));
  return findings;
}

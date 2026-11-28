// R251: product workflow custody, immutable dependencies and release-only triggers,.
// A release deploys through the reusable stack-deploy.yml: its jobs hold the environment, the age key and the transport; the job of ci.yml that calls it
// (a deployment caller) holds permissions, concurrency and the environment name it passes. A pull_request run reads and never binds an environment.
// ci.yml starts on a push of main, the release candidates and the branches the stack declaration gives a branch profile (readBranchProfiles), nothing else.
// An environment declared deploy.custody ci-key (a private repository without Environments) is the one unbound read of SOPS_AGE_KEY: stack-deploy.yml
// alone (and images.yml's sealed job), behind the release-tag steps, may leave that name without an environment and read the repository's CI key
// (unboundFindings). Every deployment caller of ci.yml passes its secrets to stack-deploy.yml by `secrets: inherit` (stackDeployCaller): GitHub hands a
// called workflow no secret the caller does not pass, an Environment secret of the called job included, so without it SOPS_AGE_KEY reads empty.
import { parseWorkflow } from '../runtime-rules/workflow-source.mjs';
import { found } from './read.mjs';
import { appWorkflowFindings } from './app-workflow-findings.mjs';
import { isPlainObject as record } from '../../../engine/plain-object.mjs';
import { workflowEventOptions } from '../../lib/workflow-events.mjs';
import { findStackDeclaration, readBranchProfiles } from '../../lib/stack-declaration.mjs';
import type { Parsed } from './rule-types.mjs';

const DEPLOY = 'HFS_DEPLOY_WORKFLOW';
const TOOL = 'HFS_CI_TOOL_INSTALL';
const TRIGGER = 'HFS_APP_WORKFLOW_TRIGGER';
// Only the age identity and SSH transport credentials belong in the CI secret store.
const CI_SECRET_ENV_NAMES = new Set(['SOPS_AGE_KEY', 'SSH_KEY', 'SSH_PRIVATE_KEY', 'SSH_KNOWN_HOSTS', 'VPS_SSH_KEY', 'VPS_SSH_PRIVATE_KEY', 'VPS_KNOWN_HOSTS', 'VPS_SSH_KNOWN_HOSTS', 'DEPLOY_SSH_KEY', 'DEPLOY_SSH_PRIVATE_KEY', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_SSH_KNOWN_HOSTS']);
const nonempty = (value: Parsed) => typeof value === 'string' && value.trim().length > 0;
function executable(script: Parsed) {
  let result = '';
  let quote = '';
  for (let index = 0; index < script.length; index++) {
    const character = script[index];
    if (character === '\\' && quote !== "'") { result += character + (script[++index] ?? ''); continue; }
    if (!quote && character === '#' && (index === 0 || /[\s;&|()]/.test(script[index - 1]))) {
      while (index < script.length && script[index] !== '\n') index++;
      result += '\n';
      continue;
    }
    if (character === quote) quote = '';
    else if (!quote && (character === "'" || character === '"')) quote = character;
    result += character;
  }
  return result.replace(/\\\r?\n/g, ' ');
}

function commands(script: Parsed) {
  const result = [];
  let quote = '';
  let start = 0;
  for (let index = 0; index < script.length; index++) {
    const character = script[index];
    if (character === '\\' && quote !== "'") { index++; continue; }
    if (character === quote) quote = '';
    else if (!quote && (character === "'" || character === '"')) quote = character;
    else if (!quote && /[\n;&|]/.test(character)) { result.push({ text: script.slice(start, index).trim(), start, end: index, separator: character }); start = index + 1; }
  }
  result.push({ text: script.slice(start).trim(), start });
  return result.filter((command) => command.text);
}

const commandBody = (command: string) => command.replace(/^(?:(?:sudo|env)\s+|[A-Za-z_]\w*=[^\s]+\s+)*/, '');

function entries(value: Parsed): Parsed {
  if (!value || typeof value !== 'object') return [];
  return Object.entries<Parsed>(value).flatMap(([key, member]): Parsed => [{ key, value: member }, ...entries(member)]);
}

const strings = (value: Parsed) => entries(value).filter((entry: Parsed) => typeof entry.value === 'string').map((entry: Parsed) => entry.value);
const activeSteps = (job: Parsed) => (Array.isArray(job.steps) ? job.steps : []).filter((step: Parsed) => record(step) && step.if !== false && step.if !== 'false' && !/^\$\{\{\s*false\s*\}\}$/.test(String(step.if ?? '')));
const scripts = (job: Parsed) => activeSteps(job).flatMap((step: Parsed) => [step.run, step.with?.script].filter(nonempty).map(executable));
const validEnvironment = (value: Parsed) => nonempty(value) || (record(value) && nonempty(value.name));
const validPermissions = (value: Parsed) => record(value) || value === 'read-all' || value === 'write-all';
const validConcurrency = (value: Parsed) => nonempty(value) || (record(value) && nonempty(value.group));
const deployName = (value: Parsed) => !/authorize[\s_.-]+deploy[\s_.-]+key/i.test(value) && /(?:^|[\s/_.-])deploy(?:[\s/_.-]|$)/i.test(value);
const materializeCommand = (script: Parsed) => commands(script).some(({ text }) => /^starci\s+app\s+secret\s+materialize\b/.test(commandBody(text)));
const DEPLOYMENT_COMMANDS = [
  /^starci\s+(?:app\s+)?(?:deploy|secret\s+materialize)\b/,
  /^(?:npx\s+(?:--no-install\s+)?)?starci\s+app\s+stack\s+(?:deploy|rollback|accept)\b/,
  /^docker\s+stack\s+deploy\b/,
  /^(?:ba?sh\s+)?(?:\.\/)?deploy\//,
  /^(?:ba?sh\s+)?(?:\.\/)?(?:scripts\/)?[\w.-]*deploy[\w.-]*\.sh\b/,
  /^npm\s+run\s+deploy(?=[:\s]|$)/,
];
const deploymentCommand = (script: Parsed) => commands(script).some(({ text }) => {
  const body = commandBody(text);
  return DEPLOYMENT_COMMANDS.some((pattern) => pattern.test(body));
});

function hasAgeIdentity(job: Parsed, doc: Parsed) {
  const steps = activeSteps(job);
  if ([doc.env, job.env, ...steps.map((step: Parsed) => step.env)].some((env) => record(env) && nonempty(env.SOPS_AGE_KEY))) return true;
  const reference = /\$\{\{\s*secrets\s*(?:\.\s*SOPS_AGE_KEY|\[\s*(['"])SOPS_AGE_KEY\1\s*\])/;
  return steps.some((step: Parsed) => strings(step.with).some((value: Parsed) => reference.test(value)) || (typeof step.run === 'string' && reference.test(executable(step.run))));
}

/** The release candidate branches: `starci app release push` waits for the ci.yml run of the release sha there. */
const CANDIDATE_BRANCHES = 'release/candidate-*';
const pushFilterValid = (options: Parsed, ci: Parsed, profiles: readonly string[]) => record(options) && Object.keys(options).length > 0 && Object.keys(options).every((key) => key === 'tags' || key === 'branches')
  && (options.tags === undefined || (Array.isArray(options.tags) && options.tags.length === 1 && options.tags[0] === 'v*'))
  && (options.branches === undefined || (Array.isArray(options.branches) && options.branches.length > 0 && new Set(options.branches).size === options.branches.length && options.branches.every((branch: Parsed) => branch === CANDIDATE_BRANCHES || (ci && (branch === 'main' || profiles.includes(branch))))));

const isCi = (file: string) => /(^|\/)ci\.ya?ml$/.test(file);
/** The managed nightly verify of the committed check cache, the one app workflow that runs on a schedule. */
export const isCacheVerify = (file: string): boolean => /(^|\/)cache-verify\.ya?ml$/.test(file);

/** A pull request to main in ci.yml: the checks of a change. Read-only workflow permissions, no environment on a job of the file itself (a call of a reusable workflow cannot have one). */
function pullRequestFindings(doc: Parsed, options: Parsed, refuse: Parsed, file: string) {
  if (!isCi(file)) return [refuse(TRIGGER, 'pull_request may start only ci.yml: no other app workflow runs the code of a pull request')];
  const findings = [];
  const filters = record(options) ? options : {};
  const branches = filters.branches;
  if (!Array.isArray(branches) || branches.length !== 1 || branches[0] !== 'main' || Object.keys(filters).some((key) => key !== 'branches')) findings.push(refuse(TRIGGER, "pull_request may contain only branches: ['main']"));
  const permissions = doc.permissions;
  const readOnly = record(permissions) && Object.values(permissions).every((value) => value === 'read' || value === 'none');
  if (!readOnly) findings.push(refuse(TRIGGER, 'a workflow that runs on pull_request declares read-only workflow permissions (permissions: contents: read); a job that needs more asks for it itself'));
  for (const [name, job] of Object.entries<Parsed>(record(doc.jobs) ? doc.jobs : {})) {
    if (record(job) && job.environment !== undefined) findings.push(refuse(TRIGGER, `job ${name} binds an environment in a workflow that runs on pull_request; a pull request run reads no environment secret`));
  }
  return findings;
}

function triggerFindings(doc: Parsed, refuse: Parsed, file = '', profiles: readonly string[] = []) {
  const on = workflowEventOptions(doc.on);
  if (!record(on) || !Object.keys(on).length) return [refuse(TRIGGER, 'declare release tags [v*] and/or workflow_dispatch')];
  const findings = [];
  if (isCi(file) && !(record(on.push) && Array.isArray(on.push.branches) && on.push.branches.includes(CANDIDATE_BRANCHES))) {
    findings.push(refuse(TRIGGER, `the release CI must run on push of branches ['${CANDIDATE_BRANCHES}']: starci app release push waits for that run (starci app sync renders it)`));
  }
  for (const [event, options] of Object.entries<Parsed>(on)) {
    if (event === 'workflow_dispatch' || event === 'workflow_call' || (event === 'schedule' && isCacheVerify(file))) continue;
    if (event === 'pull_request') {
      findings.push(...pullRequestFindings(doc, options, refuse, file));
      continue;
    }
    if (event !== 'push') {
      findings.push(refuse(TRIGGER, `trigger ${event} is forbidden; app CI starts only on release tags [v*], the release candidate branches, main and pull requests to main in ci.yml, workflow_call or workflow_dispatch, and the schedule of cache-verify.yml`));
      continue;
    }
    if (!pushFilterValid(options, isCi(file), profiles)) {
      findings.push(refuse(TRIGGER, `push may contain only tags: [v*] and branches: ['${CANDIDATE_BRANCHES}']; ci.yml may also name main and the branches with a branch profile (${profiles.join(', ') || 'none declared'}); other branch and path filters are forbidden`));
    }
  }
  return findings;
}

function secretProblems(doc: Parsed) {
  const problems = [];
  if (entries(doc).some(({ key, value }: { key: string; value: Parsed }) => key === 'secrets' && value === 'inherit')) problems.push('inherited secrets are forbidden');
  for (const value of strings(doc)) {
    for (const expression of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      const text = expression[1];
      const refs = [...text.matchAll(/\bsecrets\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*(['"])([^'"]+)\2\s*\])/g)];
      for (const ref of refs) if (!CI_SECRET_ENV_NAMES.has(ref[1] ?? ref[3])) problems.push('a secrets reference is outside the age-key/SSH transport allowlist');
      if (/\bsecrets\b/.test(text.replace(/\bsecrets\s*(?:\.\s*[A-Za-z_]\w*|\[\s*(['"])[^'"]+\1\s*\])/g, ''))) problems.push('dynamic or bulk secrets access is forbidden');
    }
  }
  return [...new Set(problems)];
}

function dotenvTarget(script: Parsed, start: number) {
  let index = start;
  while (index < script.length && /\s/.test(script[index])) index++;
  if (script[index] === '"' || script[index] === "'") index++;
  const from = index;
  while (index < script.length && !/[\s"';|<>]/.test(script[index])) index++;
  if (index < script.length && !/[\s"';|]/.test(script[index])) return false;
  const target = script.slice(from, index);
  const name = target.slice(target.lastIndexOf('/') + 1);
  if (name.startsWith('.env')) return /^[.\w-]*$/.test(name.slice(4));
  return name.endsWith('.env') && /^[\w.-]+$/.test(name.slice(0, -4));
}

function scriptWritesDotenv(value: Parsed) {
  const script = executable(value);
  for (const match of script.matchAll(/>{1,2}|\btee\s+(?:-a\s+)?/g)) {
    if (dotenvTarget(script, match.index + match[0].length)) return true;
  }
  return false;
}

function writesDotenv(doc: Parsed) {
  return entries(doc).some(({ key, value }: { key: string; value: Parsed }) => key === 'env_file' || key === 'env-file' || (['run', 'script'].includes(key) && typeof value === 'string' && scriptWritesDotenv(value)));
}

/** The job of a workflow that calls a reusable workflow of the app (`uses: ./.github/workflows/<file>`): a deployment caller when the callee deploys. */
const localCall = (job: Parsed) => typeof job.uses === 'string' && job.uses.startsWith('./.github/workflows/');

function deploymentJobs(doc: Parsed, file: string) {
  const jobs = record(doc.jobs) ? Object.entries<Parsed>(doc.jobs).filter(([, job]) => record(job)) : [];
  const identified = jobs.filter(([name, job]) => deployName(name) || deployName(String(job.name ?? '')) || scripts(job).some(deploymentCommand) || (typeof job.uses === 'string' && deployName(job.uses)));
  if (identified.length) return identified;
  if (deployName(file) || deployName(String(doc.name ?? ''))) return jobs;
  return [];
}

/** A deployment caller (ci.yml's deploy-<env>): permissions, concurrency and the environment it passes; the called job binds the environment and opens the key. */
function callerFindings(name: string, job: Parsed, doc: Parsed, refuse: Parsed) {
  const findings = [];
  const environment = record(job.with) ? job.with.environment : undefined;
  if (job.environment !== undefined) findings.push(refuse(DEPLOY, `job ${name} calls a reusable workflow, which cannot bind an environment itself; pass the name as with.environment and let the called job bind it`));
  if (!nonempty(environment)) findings.push(refuse(DEPLOY, `job ${name} must pass with.environment: the GitHub environment the called deploy job binds`));
  if (job.uses === STACK_DEPLOY && job.secrets !== 'inherit') findings.push(refuse(DEPLOY, `job ${name} calls stack-deploy.yml without \`secrets: inherit\`: a called workflow reads only the secrets its caller passes, an Environment secret included, so its SOPS_AGE_KEY would be empty (run starci app sync)`));
  if (!validPermissions(job.permissions ?? doc.permissions)) findings.push(refuse(DEPLOY, `job ${name} must declare permissions at job or workflow scope`));
  if (!validConcurrency(job.concurrency ?? doc.concurrency)) findings.push(refuse(DEPLOY, `job ${name} must declare concurrency at job or workflow scope`));
  return findings;
}

/** The binding stack-deploy.yml renders when an environment is declared ci-key: the name itself, or '' (no Environment) for each ci-key name it lists. */
const CI_KEY_BINDING = /^\$\{\{\s*\(\s*(inputs\.environment != '[a-z][a-z0-9-]*'(?:\s*&&\s*inputs\.environment != '[a-z][a-z0-9-]*')*)\s*\)\s*&&\s*inputs\.environment\s*\|\|\s*''\s*\}\}$/;
/** The names a job leaves without an environment through that binding, or null when its binding is not that one. */
function unboundNames(environment: Parsed): string[] | null {
  const match = typeof environment === 'string' ? environment.trim().match(CI_KEY_BINDING) : null;
  return match ? [...match[1]!.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((name) => name[1]!) : null;
}
const isStackDeploy = (file: string) => /(^|\/)stack-deploy\.ya?ml$/.test(file);
const isImages = (file: string) => /(^|\/)images\.ya?ml$/.test(file);
/** The sealed image job of images.yml: under a ci-key release environment it binds none and names that environment with `--env <name>`. */
const SEALED_IMAGE_JOB = 'image-sealed';
const RELEASE_REF_GUARD = /^\[\[\s*"\$GITHUB_REF"\s*==\s*refs\/tags\/v\*\s*\]\]\s*\|\|\s*exit\s+1$/;
const TAG_IS_VERSION = /process\.env\.GITHUB_REF_NAME\s*!==\s*'v'\s*\+\s*version\)\s*process\.exit\(1\)/;
const readsSecret = (value: Parsed) => strings(value).some((text: string) => /\$\{\{[^}]*\bsecrets\b/.test(text));
/**
 * The release-tag steps run before the job reads any secret: a line `[[ "$GITHUB_REF" == refs/tags/v* ]] || exit 1` in a step that runs whenever the
 * job does (no condition, or the job's own) and does not continue on error, so a run from a branch fails there, and the check that the tag is the
 * package version; neither the job's nor the workflow's env reads a secret.
 */
function releaseGuarded(job: Parsed, doc: Parsed): boolean {
  if (readsSecret(doc.env) || readsSecret(job.env)) return false;
  const steps = activeSteps(job);
  const first = steps.findIndex((step: Parsed) => readsSecret({ env: step.env, with: step.with, run: step.run }));
  const before = first === -1 ? steps : steps.slice(0, first);
  const run = (step: Parsed) => (nonempty(step.run) ? executable(step.run) : '');
  const always = (step: Parsed) => (step.if === undefined || (job.if !== undefined && String(step.if).trim() === String(job.if).trim())) && step['continue-on-error'] === undefined;
  return before.some((step: Parsed) => always(step) && run(step).split('\n').some((line: string) => RELEASE_REF_GUARD.test(line.trim())))
    && before.some((step: Parsed) => TAG_IS_VERSION.test(run(step)));
}
/**
 * The names a job leaves without an environment and the one place that may: stack-deploy.yml's ci-key binding, or images.yml's sealed job with
 * no binding, which names its environment with --env. Null for any other job; the other checks judge it then.
 */
function unboundOf(name: string, job: Parsed, file: string): { names: string[]; allowed: boolean; where: string } | null {
  const bound = unboundNames(job.environment);
  if (bound) return { names: bound, allowed: isStackDeploy(file), where: 'only stack-deploy.yml may leave a name unbound' };
  if (job.environment !== undefined || name !== SEALED_IMAGE_JOB || !isImages(file)) return null;
  const names: string[] = [...new Set<string>(scripts(job).flatMap((script: string) => [...script.matchAll(/--env\s+([a-z][a-z0-9-]*)/g)].map((match) => match[1]!)))];
  return names.length ? { names, allowed: true, where: '' } : null;
}
/**
 * A job that leaves names without an environment reads the repository's SOPS_AGE_KEY for them (the app's CI key, PROJECT-STACKS-7): accepted only
 * in stack-deploy.yml and images.yml's sealed job, behind the release-tag steps, for names the declaration gives deploy.custody ci-key.
 */
function unboundFindings(name: string, job: Parsed, doc: Parsed, file: string, ciKey: ReadonlySet<string>, refuse: Parsed) {
  const unbound = unboundOf(name, job, file);
  if (!unbound) return null;
  const { names, allowed, where } = unbound;
  const undeclared = names.filter((entry) => !ciKey.has(entry));
  if (allowed && releaseGuarded(job, doc) && undeclared.length === 0) return [];
  const why = !allowed ? where
    : undeclared.length ? `${undeclared.join(', ')} ${undeclared.length === 1 ? 'is' : 'are'} not declared deploy.custody ci-key in .starcistacks/application-stacks.yaml`
      : 'its first steps must be the release-tag guard ([[ "$GITHUB_REF" == refs/tags/v* ]] || exit 1) and the check that the tag is the package version, before any secret is read';
  return [refuse(DEPLOY, `job ${name} leaves ${names.join(', ')} without an environment and so reads the repository's SOPS_AGE_KEY; ${why}`)];
}

/**
 * A deployment caller of ci.yml that hands an environment to stack-deploy.yml passes its secrets on (`secrets: inherit`). A called workflow reads only
 * the secrets its caller passes, and that holds for an Environment secret too: without the inheritance the called job, bound to its Environment,
 * reads SOPS_AGE_KEY empty. Bound, the Environment's SOPS_AGE_KEY wins over the repository's; a ci-key environment (no Environment) reads the
 * repository's CI key the same way. Every other inheritance stays refused.
 */
const STACK_DEPLOY = './.github/workflows/stack-deploy.yml';
const stackDeployCaller = (job: Parsed) => job.uses === STACK_DEPLOY && job.secrets === 'inherit' && record(job.with) && nonempty(job.with.environment);

function deploymentJobFindings(name: string, job: Parsed, doc: Parsed, refuse: Parsed, file: string, ciKey: ReadonlySet<string>) {
  if (localCall(job)) return callerFindings(name, job, doc, refuse);
  const findings = [];
  const unbound = unboundFindings(name, job, doc, file, ciKey, refuse);
  if (unbound) findings.push(...unbound);
  else if (!validEnvironment(job.environment)) findings.push(refuse(DEPLOY, `job ${name} must declare its protected environment`));
  if (!validPermissions(job.permissions ?? doc.permissions)) findings.push(refuse(DEPLOY, `job ${name} must declare permissions at job or workflow scope`));
  if (!validConcurrency(job.concurrency ?? doc.concurrency)) findings.push(refuse(DEPLOY, `job ${name} must declare concurrency at job or workflow scope`));
  if (!hasAgeIdentity(job, doc) && !scripts(job).some(materializeCommand)) findings.push(refuse(DEPLOY, `job ${name} must inject SOPS_AGE_KEY or run starci app secret materialize`));
  return findings;
}

const AGE_KEY_REFERENCE = /\$\{\{[^}]*\bsecrets\s*(?:\.\s*SOPS_AGE_KEY\b|\[\s*(['"])SOPS_AGE_KEY\1\s*\])/;
const readsAgeKey = (value: Parsed) => strings(value).some((text: string) => AGE_KEY_REFERENCE.test(text));

/**
 * A job that reads secrets.SOPS_AGE_KEY opens the members of one environment, so it is bound to that GitHub Environment, whose
 * SOPS_AGE_KEY is the environment's server identity (PROJECT-STACKS-5/7); unbound, it would read a repository secret of that name.
 * Disabled steps do not count. A deployment job is judged by deploymentJobFindings, which already requires its environment.
 */
function ageKeyJobFindings(doc: Parsed, file: string, refuse: Parsed, ciKey: ReadonlySet<string>) {
  const deployment = new Set(deploymentJobs(doc, file).map(([name]) => name));
  const workflowWide = readsAgeKey(doc.env);
  const jobs = record(doc.jobs) ? Object.entries<Parsed>(doc.jobs).filter(([, job]) => record(job)) : [];
  return jobs
    .filter(([name, job]) => !deployment.has(name) && (unboundNames(job.environment) !== null || !validEnvironment(job.environment)))
    .filter(([, job]) => workflowWide || readsAgeKey({ env: job.env, with: job.with, secrets: job.secrets, steps: activeSteps(job).map((step: Parsed) => ({ env: step.env, with: step.with, run: nonempty(step.run) ? executable(step.run) : undefined })) }))
    .flatMap(([name, job]) => unboundFindings(name, job, doc, file, ciKey, refuse)
      ?? [refuse(DEPLOY, `job ${name} reads secrets.SOPS_AGE_KEY without an environment; bind it to the GitHub Environment whose members it opens (environment: <env>), which holds that environment's server key`)]);
}

function deploymentFindings(doc: Parsed, file: string, refuse: Parsed, ciKey: ReadonlySet<string>) {
  const deployment = deploymentJobs(doc, file);
  const named = deployName(file) || deployName(String(doc.name ?? ''));
  if (!deployment.length && !named) return [];
  const findings = [];
  if (!deployment.length) findings.push(refuse(DEPLOY, 'the deploy workflow must declare a deployment job'));
  for (const [name, job] of deployment) findings.push(...deploymentJobFindings(name, job, doc, refuse, file, ciKey));
  // The secrets and dotenv writes are judged where the deploy runs: the workflow-level env and the deployment jobs, not a check job beside them (the Sonar token of ci.yml).
  const judged = { env: doc.env, jobs: Object.fromEntries(deployment.map(([name, job]) => [name, stackDeployCaller(job) ? { ...job, secrets: undefined } : job])) };
  for (const problem of secretProblems(judged)) findings.push(refuse(DEPLOY, problem));
  if (writesDotenv(judged)) findings.push(refuse(DEPLOY, 'deploy workflows must never write dotenv files or use env_file blobs; materialize sealed custody'));
  return findings;
}

// A version label alone is not an integrity pin. The immutable reference or verified artifact must belong to this install.
function verifiedArtifact(artifact: Parsed, prior: Parsed) {
  if (!/^\.\/[\w./-]+\.(?:tgz|tar\.gz|whl)$/.test(artifact)) return false;
  return prior.split(/\r?\n/).some((line: string) => {
    const checksum = line.trim().match(/^echo\s+(['"])([a-f\d]{64})\s+\*?(\S+)\1\s*\|\s*sha256sum\s+(?:--check|-c)\s+-\s*(?:$|&&)/i);
    return checksum && checksum[3]!.replace(/^\.\//, '') === artifact.slice(2) && !line.includes('||');
  });
}

function pinnedInstall(command: string, prior: Parsed) {
  if (/^(?:python(?:3)?\s+-m\s+)?pip(?:3)?\s+install\b/.test(command)) {
    // pip's hash-checking mode refuses every unhashed direct or transitive requirement itself.
    if (/(?:^|\s)--require-hashes(?:\s|$)/.test(command)) return true;
    const targets = command.replace(/^(?:python(?:3)?\s+-m\s+)?pip(?:3)?\s+install\s*/, '').split(/\s+/).filter((token: Parsed) => !token.startsWith('-'));
    return targets.length > 0 && targets.every((target: Parsed) => /^git\+https:\/\/\S+@[a-f\d]{40}$/i.test(target) || verifiedArtifact(target, prior));
  }
  if (/^go\s+install\b/.test(command)) {
    const targets = command.replace(/^go\s+install\s*/, '').split(/\s+/).filter((token: Parsed) => !token.startsWith('-'));
    return targets.length > 0 && targets.every((target: Parsed) => /^[\w./-]+@[a-f\d]{40}$/i.test(target));
  }
  const targets = command.replace(/^npm\s+(?:(?:-g|--global|--location=global)\s+)*(?:i|install)\s*/, '').split(/\s+/).filter((token: Parsed) => !token.startsWith('-')).map((token: Parsed) => token.replace(/^["']|["']$/g, ''));
  return targets.length > 0 && targets.every((target: Parsed) => /^git\+https:\/\/\S+#[a-f\d]{40}$/i.test(target) || verifiedArtifact(target, prior));
}

function toolFindings(doc: Parsed, refuse: Parsed) {
  const findings = [];
  for (const { key, value } of entries(doc)) {
    if (!['run', 'script'].includes(key) || typeof value !== 'string') continue;
    const script = executable(value);
    const statements = commands(script);
    if (statements.some((command, index) => /^\b(?:curl|wget)\b/.test(commandBody(command.text)) && command.separator === '|' && /^(?:ba)?sh\b/.test(commandBody(statements[index + 1]?.text ?? '')) || /^(?:ba)?sh\s+<\(\s*(?:curl|wget)\b/.test(commandBody(command.text)))) findings.push(refuse(TOOL, 'a downloaded installer must be checksum-verified before execution; curl/wget piped to a shell is forbidden'));
    for (const command of statements) {
      const body = commandBody(command.text);
      const install = /^(?:go\s+install|(?:python(?:3)?\s+-m\s+)?pip(?:3)?\s+install)\b/.test(body) || /^npm\s+(?:(?:-g|--global|--location=global)\s+)*(?:i|install)\b/.test(body) && /(?:^|\s)(?:-g|--global|--location=global)(?:\s|$)/.test(body);
      if (install && !pinnedInstall(body, script.slice(0, command.start))) findings.push(refuse(TOOL, 'tool installs need an immutable hash or a verified artifact; use a SHA-pinned setup action instead of a version-only install'));
    }
  }
  return findings;
}

function perWorkflow({ path: file, text }: { path: string; text: string }, profiles: readonly string[] = [], ciKey: ReadonlySet<string> = new Set()) {
  const refuse = (code: string, message: string) => found(code, file, `${code} ${file}: ${message}`);
  const doc = parseWorkflow(text);
  if (!record(doc)) return [refuse(TRIGGER, 'the workflow must be valid YAML with a release-only on block'), ...(deployName(file) ? [refuse(DEPLOY, 'the deploy workflow must be valid YAML')] : [])];
  return [...triggerFindings(doc, refuse, file, profiles), ...deploymentFindings(doc, file, refuse, ciKey), ...ageKeyJobFindings(doc, file, refuse, ciKey), ...toolFindings(doc, refuse)];
}

/** Synchronous R251 findings over the tracked workflows of an app. */
export function deployWorkflowFindings(ctx: Parsed) {
  const declaration = findStackDeclaration(ctx.repoRoot).doc;
  const profiles = Object.keys(readBranchProfiles(declaration).profiles);
  return appWorkflowFindings(ctx, (workflow: { path: string; text: string }) => perWorkflow(workflow, profiles, ciKeyEnvironments(declaration)));
}

/** The environments the stack declaration gives deploy.custody ci-key. */
function ciKeyEnvironments(declaration: Parsed): ReadonlySet<string> {
  const environments = record(declaration) && record(declaration.environments) ? Object.entries<Parsed>(declaration.environments) : [];
  return new Set(environments.filter(([, environment]) => record(environment) && record(environment.deploy) && environment.deploy.custody === 'ci-key').map(([name]) => name));
}

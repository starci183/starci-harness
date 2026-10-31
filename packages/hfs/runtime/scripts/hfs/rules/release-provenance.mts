// R271: a product release keeps its v<semver> tag, root package version, image tags and database deployment ref together. The pushed images are named by the
// commit (sha-<sha>); the release name v<version> is a retag of that digest under a release guard. A migration runs in the stack deploy after the release tag.
// Ordinary untagged development trees have no release version to compare. Workflow checks still run there in both editions.
// YAML is parsed, so comments and unrelated jobs cannot supply a guard. Shell guards are deliberately a small, explicit form;
// opaque helper scripts and computed image metadata cannot prove provenance in this static check.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../../engine/yaml.mjs';
import { isPlainObject } from '../../../engine/plain-object.mjs';
import { revParseQuery } from '../../api/git/rev-parse-query.mjs';
import { tag } from '../../api/git/tag.mjs';
import type { GitOptions } from '../../api/git/lib.mjs';
import { gitOutputOf, withoutGitLocalEnv } from '../../lib/git.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

export const HFS_RELEASE_TAG_MISMATCH = 'HFS_RELEASE_TAG_MISMATCH';
export const HFS_DB_DEPLOY_UNGUARDED = 'HFS_DB_DEPLOY_UNGUARDED';
const SEMVER_NUMBER = String.raw`(?:0|[1-9]\d*)`;
const SEMVER_PRERELEASE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_BUILD_ID = '[0-9A-Za-z-]+';
const SEMVER = new RegExp(String.raw`^${SEMVER_NUMBER}\.${SEMVER_NUMBER}\.${SEMVER_NUMBER}(?:-${SEMVER_PRERELEASE_ID}(?:\.${SEMVER_PRERELEASE_ID})*)?(?:\+${SEMVER_BUILD_ID}(?:\.${SEMVER_BUILD_ID})*)?$`);
const WORKFLOW = /^\.github\/workflows\/(images|db-deploy)\.ya?ml$/;
const TAG = 1;
const VERSION_PREFIX = 2;
const RELEASE_REF = TAG | VERSION_PREFIX;

function gitTags(repoRoot: string, env: Parsed): string[] {
  const options: GitOptions = { cwd: repoRoot, env: withoutGitLocalEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true };
  try {
    // A nested example belongs to its own product, never to an ancestor runtime's tags.
    const top = gitOutputOf(revParseQuery(['--show-toplevel'], options)).trim();
    if (path.relative(fs.realpathSync(top), fs.realpathSync(repoRoot)) !== '') return [];
    const tags = gitOutputOf(tag(['--points-at', 'HEAD'], options)).trim().split(/\r?\n/).filter((value: Parsed) => value.startsWith('v'));
    if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF?.startsWith('refs/tags/v')) tags.push(env.GITHUB_REF.slice('refs/tags/'.length));
    return [...new Set<string>(tags)];
  } catch { return []; }
}

function tagFindings(repoRoot: string, version: string, env: Parsed) {
  return gitTags(repoRoot, env).filter((tag) => !SEMVER.test(tag.slice(1)) || tag.slice(1) !== version)
    .map((tag) => found(HFS_RELEASE_TAG_MISMATCH, 'package.json', 'the release tag at HEAD must be v<semver> and equal the root package.json version; align the version before cutting the release', { tag, version: typeof version === 'string' ? version : null }));
}

// Split only outside strings/function calls; arbitrary expressions remain unproved atoms.
function splitBoolean(expression: Parsed, operator: Parsed) {
  const parts = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (quote) { if (char === quote) { quote = ''; } continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && expression.slice(i, i + 2) === operator) { parts.push(expression.slice(start, i)); start = i + 2; i += 1; }
  }
  parts.push(expression.slice(start));
  return parts;
}

function enclosingParentheses(text: string) {
  let depth = 0, quote = '';
  for (let i = 0; i < text.length - 1; i += 1) {
    const char = text[i];
    if (quote) { if (char === quote) { quote = ''; } continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) return false;
  }
  return true;
}

function unwrap(expression: Parsed) {
  let text = expression.trim();
  while (text.startsWith('(') && text.endsWith(')') && enclosingParentheses(text)) text = text.slice(1, -1).trim();
  return text;
}

function workflowExpression(value: Parsed) {
  const text = value.trim();
  return text.startsWith('${{') && text.endsWith('}}') ? text.slice(3, -2).trim() : text;
}

function refProof(value: Parsed): Parsed {
  if (typeof value !== 'string') return 0;
  const expression = unwrap(workflowExpression(value));
  const alternatives = splitBoolean(expression, '||');
  if (alternatives.length > 1) return alternatives.map(refProof).reduce((a, b) => a & b, RELEASE_REF);
  const conjuncts = splitBoolean(expression, '&&');
  if (conjuncts.length > 1) return conjuncts.map(refProof).reduce((a, b) => a | b, 0);
  if (/^startsWith\(\s*github\.ref\s*,\s*(['"])refs\/tags\/v\1\s*\)$/.test(expression)) return RELEASE_REF;
  const exact = /^github\.ref\s*==\s*(['"])refs\/tags\/v([^'"\s]+)\1$/.exec(expression);
  if (exact && SEMVER.test(exact[2]!)) return RELEASE_REF;
  if (/^(?:github\.ref_type\s*==\s*(['"])tag\1|(['"])tag\2\s*==\s*github\.ref_type)$/.test(expression)) return TAG;
  if (/^startsWith\(\s*github\.ref_name\s*,\s*(['"])v\1\s*\)$/.test(expression)) return VERSION_PREFIX;
  return 0;
}

function tagOnlyTrigger(workflow: Parsed) {
  const events = workflow.on;
  if (!events || typeof events !== 'object' || Array.isArray(events) || Object.keys(events).join() !== 'push') return false;
  const push = events.push;
  if (!push || typeof push !== 'object' || push.branches || push['branches-ignore'] || push['tags-ignore']) return false;
  const tags = Array.isArray(push.tags) ? push.tags : [];
  const included = tags.filter((tag: string) => typeof tag === 'string' && !tag.startsWith('!'));
  return included.length > 0 && included.every((tag: string) => tag.startsWith('v'));
}

function shellTagGuard(step: Parsed) {
  if (step.if !== undefined || step['continue-on-error'] || typeof step.run !== 'string') return false;
  const command = step.run.trim().replace(/^set -[a-z]+(?:\s+pipefail)?\s*\n/, '').trim();
  // The whole guard step must reject a non-release ref; a nested, commented or later guard is insufficient.
  return /^\[\[\s*["']?\$(?:GITHUB_REF|\{GITHUB_REF\})["']?\s*==\s*refs\/tags\/v\*\s*\]\]\s*\|\|\s*exit\s+[1-9]\d*\s*;?$/.test(command)
    || /^case\s+["']?\$(?:GITHUB_REF|\{GITHUB_REF\})["']?\s+in\s+refs\/tags\/v\*\)\s*;;\s*\*\)\s*exit\s+[1-9]\d*\s*;;\s*esac\s*;?$/.test(command);
}

function checkoutPreservesRef(job: Parsed) {
  return (job.steps ?? []).filter((step: Parsed) => (step.uses ?? '').startsWith('actions/checkout@')).every((step: Parsed) => {
    const ref = step.with?.ref;
    return ref === undefined || /^\$\{\{\s*github\.(?:ref|ref_name|sha)\s*\}\}$/.test(String(ref));
  });
}

function setupStep(step: Parsed) {
  return /^(?:actions\/checkout|actions\/setup-node)@/.test(step.uses ?? '')
    || (typeof step.run === 'string' && /^npm ci --ignore-scripts\s*$/.test(step.run.trim()));
}

function unguardedDeployStep(step: Parsed, shellGuarded: Parsed, guarded: Parsed) {
  // Checkout, Node setup and script-disabled npm install may precede the guard. Opaque commands may deploy.
  // A later always()/failure() step can run despite the rejecting shell guard's failure.
  const shellConstrained = shellGuarded && !/\b(?:always|failure|cancelled)\s*\(/.test(String(step.if ?? ''));
  return (step.run || step.uses) && !setupStep(step) && !guarded && !shellConstrained && refProof(step.if) !== RELEASE_REF;
}

function dbJobConstrained(job: Parsed, guarded: Parsed) {
  let shellGuarded = false;
  let constrained = !job.uses || guarded;
  for (const step of job.steps ?? []) {
    if (shellTagGuard(step)) { shellGuarded = true; continue; }
    if (unguardedDeployStep(step, shellGuarded, guarded)) constrained = false;
  }
  if (!job.uses && !(job.steps ?? []).some((step: Parsed) => step.run || step.uses)) constrained = false;
  return constrained;
}

// The database deploy workflow is retired in a lite app: its migrations are the migrate phase of the stack deploy (starci app stack deploy, tag-gated by
// stack-deploy.yml). A full app that keeps its own db-deploy.yml, and a lite app that has not synced yet, are still judged here.
function dbFindings(file: string, workflow: Parsed) {
  const jobs = Object.entries<Parsed>(workflow.jobs ?? {});
  if (!jobs.length) return [found(HFS_DB_DEPLOY_UNGUARDED, file, `${file} has no verifiable database deploy job; require a release tag before migration (a lite app's migrations are the migrate phase of the stack deploy: run starci app sync --execute to retire this file)`)];
  const findings = [];
  for (const [name, job] of jobs) {
    if (!job || typeof job !== 'object') continue;
    const guarded = tagOnlyTrigger(workflow) || refProof(job.if) === RELEASE_REF;
    const constrained = dbJobConstrained(job, guarded);
    if (!constrained || !checkoutPreservesRef(job)) findings.push(found(HFS_DB_DEPLOY_UNGUARDED, file, `${file} job ${name} can deploy a non-release ref; require refs/tags/v at the job or before any deploy command, and check out that ref`, { job: name }));
  }
  return findings;
}

function validJob(job: Parsed) {
  return isPlainObject(job) && (job.steps === undefined || (Array.isArray(job.steps) && job.steps.every(isPlainObject)));
}

function validWorkflow(workflow: Parsed) {
  return isPlainObject(workflow) && isPlainObject(workflow.jobs) && Object.values<Parsed>(workflow.jobs).every(validJob);
}

function imageTagIsRelease(value: Parsed, version: string) {
  if (typeof value !== 'string') return false;
  const tags = value.split(/[\n,]+/).map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 && tags.every((tag) => {
    const ref = tag.replace(/\$\{\{\s*github\.ref_name\s*\}\}/g, '<release-ref>');
    if (ref.endsWith(':<release-ref>')) return true;
    return SEMVER.test(String(version)) && ref.endsWith(`:v${version}`);
  });
}

/** A commit tag: `<repo>:sha-${{ github.sha }}`, immutable and per commit, so any ref may push it. */
const COMMIT_TAG = /^.+:sha-\$\{\{\s*github\.sha\s*\}\}$/;
function imageTagsAreCommit(value: Parsed) {
  if (typeof value !== 'string') return false;
  const tags = value.split(/[\n,]+/).map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 && tags.every((tag) => COMMIT_TAG.test(tag));
}

/** The release guard of a reusable images workflow: a step under `if: ${{ inputs.release }}` whose script rejects a ref that is not refs/tags/v*. */
function inputReleaseGuard(step: Parsed) {
  if (typeof step.run !== 'string' || step['continue-on-error'] || !/^\$\{\{\s*inputs\.release\s*\}\}$/.test(String(step.if ?? '').trim())) return false;
  const first = step.run.trim().split(/\r?\n/)[0]!.trim();
  return /^\[\[\s*["']?\$(?:GITHUB_REF|\{GITHUB_REF\})["']?\s*==\s*refs\/tags\/v\*\s*\]\]\s*\|\|\s*exit\s+[1-9]\d*\s*;?$/.test(first);
}

/** The release name v<version> is a retag of the commit digest (`imagetools create --tag <repo>:$GITHUB_REF_NAME <repo>:sha-...`): only after the guard, only on a release run. */
function retagIsGuarded(job: Parsed, step: Parsed) {
  const steps: Parsed[] = job.steps ?? [];
  const guard = steps.findIndex(inputReleaseGuard);
  return guard >= 0 && guard < steps.indexOf(step) && /^\$\{\{\s*inputs\.release\s*&&/.test(String(step.if ?? '').trim());
}

function imageFindings(file: string, workflow: Parsed, version: string) {
  const findings = [];
  let builds = 0;
  for (const [name, job] of Object.entries<Parsed>(workflow.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.run === 'string' && /\bimagetools\s+create\b/.test(step.run) && !retagIsGuarded(job, step)) {
        findings.push(found(HFS_RELEASE_TAG_MISMATCH, file, `${file} job ${name} retags an image outside a release guard; put it after a step \`if: \${{ inputs.release }}\` that rejects a ref other than refs/tags/v*, and under \`if: \${{ inputs.release && ... }}\``, { job: name }));
      }
      if (!(step.uses ?? '').startsWith('docker/build-push-action@')) continue;
      builds += 1;
      const guarded = tagOnlyTrigger(workflow) || refProof(job.if) === RELEASE_REF || refProof(step.if) === RELEASE_REF;
      // An immutable commit tag (sha-<sha>) is pushed by any ref; a release name must come from the checked-out release ref under a guard.
      if (!checkoutPreservesRef(job) || !(imageTagsAreCommit(step.with?.tags) || (guarded && imageTagIsRelease(step.with?.tags, version)))) findings.push(found(HFS_RELEASE_TAG_MISMATCH, file, `${file} job ${name} must build the checked-out ref and tag every image with sha-\${{ github.sha }} (the release name v<package.json version> is a guarded retag of that digest), or tag with v<version> or github.ref_name under a release-tag guard`, { job: name }));
    }
  }
  if (!builds) findings.push(found(HFS_RELEASE_TAG_MISMATCH, file, `${file} has no verifiable release image tags; declare docker/build-push-action tags from the release ref`));
  return findings;
}

function productRoot(repo: Repo, isRoot: boolean) {
  return isRoot !== false && !['be', 'fe', 'runtime'].some((value) => value === repo.profile)
    && (!repo.kind || repo.kind === 'app') && ['lite', 'full'].includes(repo.edition ?? 'full');
}

/** Synchronous product-root provenance findings; root and workflows are judged in lite and full, never a side or runtime. */
export function releaseProvenanceFindings({ repoRoot, files = [], repo = {}, isRoot, inScope = () => true, env = process.env }: { repoRoot?: string; files?: string[]; repo?: Repo; isRoot?: boolean; inScope?: (file: string) => boolean; env?: NodeJS.ProcessEnv } = {}) {
  if (!productRoot(repo, isRoot!)) return [];
  const version = readJson(repoRoot!, 'package.json')?.version;
  const packageInScope = files.includes('package.json') && inScope('package.json');
  const findings = packageInScope ? tagFindings(repoRoot!, version, env) : [];
  for (const file of files) {
    const match = WORKFLOW.exec(file);
    if (!match || (!inScope(file) && !packageInScope)) continue;
    const code = match[1] === 'images' ? HFS_RELEASE_TAG_MISMATCH : HFS_DB_DEPLOY_UNGUARDED;
    let workflow;
    try { workflow = parseYaml(readText(repoRoot!, file) ?? ''); } catch { /* unreadable YAML cannot prove a release */ }
    if (!validWorkflow(workflow)) {
      findings.push(found(code, file, `${file} cannot be parsed as a workflow; restore its release tag checks`));
      continue;
    }
    findings.push(...(match[1] === 'images' ? imageFindings(file, workflow, version) : dbFindings(file, workflow)));
  }
  return findings;
}

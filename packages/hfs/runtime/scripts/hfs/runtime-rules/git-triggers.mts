// CI_TRIGGERS_RELEASE_ONLY: runtime workflows and app ci.yml may judge main; release candidates, v* tags and manual dispatch retain their scope.
import { parseWorkflow, workflowFindings } from './workflow-source.mjs';
import { workflowEventOptions } from '../../lib/workflow-events.mjs';
import type { Parsed } from '../rules/rule-types.mjs';

export const CODE = 'CI_TRIGGERS_RELEASE_ONLY';
const RELEASE_TAGS = 'v*';
const RUNTIME_BRANCH = 'main';
/** The branch pattern of the release candidate refs (refs/heads/release/candidate-<version>), shared with the release flows. */
export const CANDIDATE_BRANCHES = 'release/candidate-*';
/** The workflows that judge an app release (every app ci.yml): they must run on the candidate refs. The runtime's own workflows judge each push to main instead. */
const RELEASE_WORKFLOW = /(^|\/)ci\.ya?ml$/;

const isReleaseTagFilter = (tags: Parsed) => Array.isArray(tags) && tags.length === 1 && String(tags[0]) === RELEASE_TAGS;
/** The branches a filter may name: main (runtime workflows and app ci.yml) and the candidate pattern. */
const allowedBranches = (ownBranch: Parsed) => (ownBranch ? [RUNTIME_BRANCH, CANDIDATE_BRANCHES] : [CANDIDATE_BRANCHES]);
const isBranchFilter = (ownBranch: Parsed, branches: Parsed) => Array.isArray(branches) && branches.length > 0 && new Set(branches.map(String)).size === branches.length
  && branches.every((branch) => allowedBranches(ownBranch).includes(String(branch)));
const namesCandidate = (branches: Parsed) => Array.isArray(branches) && branches.map(String).includes(CANDIDATE_BRANCHES);

const missingFilterMessage = (ownBranch: Parsed) => (ownBranch
  ? `\`push\` must be filtered to \`tags: ['${RELEASE_TAGS}']\` and/or \`branches\` of [${RUNTIME_BRANCH}, '${CANDIDATE_BRANCHES}'] (no other branch starts CI)`
  : `\`push\` must be filtered to \`tags: ['${RELEASE_TAGS}']\` and/or \`branches: ['${CANDIDATE_BRANCHES}']\` (no other branch starts an app's CI)`);

const branchFilterMessage = (ownBranch: Parsed) => (ownBranch
  ? `\`push.branches\` may name only ${RUNTIME_BRANCH} and '${CANDIDATE_BRANCHES}', each once`
  : `\`push.branches\` may name only '${CANDIDATE_BRANCHES}' in an example or an app template: its CI runs on the release candidate and the release tag`);

function pushFindings({ ownBranch, config, refuse, release }: { ownBranch: Parsed; config: Parsed; refuse: Parsed; release: Parsed }) {
  const filters = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const { tags, branches } = filters;
  const found = [];
  if (tags === undefined && branches === undefined) found.push(refuse(missingFilterMessage(ownBranch)));
  if (tags !== undefined && !isReleaseTagFilter(tags)) found.push(refuse(`\`push.tags\` must be exactly ['${RELEASE_TAGS}']`));
  if (branches !== undefined && !isBranchFilter(ownBranch, branches)) found.push(refuse(branchFilterMessage(ownBranch)));
  if (release && !namesCandidate(branches)) found.push(refuse(`\`push.branches\` must name '${CANDIDATE_BRANCHES}': starci app release push waits for the CI run of the release sha on its candidate ref`));
  for (const other of Object.keys(filters).filter((key) => key !== 'tags' && key !== 'branches')) found.push(refuse(`\`push.${other}\` is not allowed beside the trigger filters`));
  return found;
}

function eventFindings({ event, config, ownBranch, refuse, release }: { event: Parsed; config: Parsed; ownBranch: Parsed; refuse: Parsed; release: Parsed }) {
  if (event === 'workflow_dispatch') return [];
  if (event !== 'push') return [refuse(`the trigger \`${event}\` is not allowed: only a push of release tags [${RELEASE_TAGS}], of '${CANDIDATE_BRANCHES}' (and, in runtime workflows or app ci.yml, of branch ${RUNTIME_BRANCH}) and workflow_dispatch may start CI`)];
  return pushFindings({ ownBranch, config, refuse, release });
}

/** The CI_TRIGGERS_RELEASE_ONLY findings of one workflow text; a text that is not YAML yields none (the other checks name it). Runtime workflows and app ci.yml may also push on main. */
function workflowTriggerFindings({ path: file, text }: { path: string; text: string }) {
  const doc = parseWorkflow(text);
  if (!doc || typeof doc !== 'object') return [];
  const ownBranch = file.startsWith('.github/workflows/') || RELEASE_WORKFLOW.test(file);
  const refuse = (why: string) => ({ code: CODE, level: 'error', path: file, message: `${CODE} ${file}: ${why}` });
  const on = doc.on;
  if (on === undefined || on === null) return [refuse('the workflow has no `on` trigger block: it must declare push of tags [v*] and/or workflow_dispatch')];
  const events = workflowEventOptions(on, String);
  const release = !file.startsWith('.github/workflows/') && RELEASE_WORKFLOW.test(file);
  const missingPush = release && !Object.hasOwn(events, 'push') ? [refuse(`the app release workflow must run on a push of '${CANDIDATE_BRANCHES}' and of tags [${RELEASE_TAGS}]`)] : [];
  return [...missingPush, ...Object.entries(events).flatMap(([event, config]) => eventFindings({ event, config, ownBranch, refuse, release }))];
}

/** CI_TRIGGERS_RELEASE_ONLY over every tracked workflow (ctx of scripts/hfs/runtime-check.mjs). */
export const gitTriggerFindings = (ctx: Parsed) => workflowFindings(ctx, workflowTriggerFindings);

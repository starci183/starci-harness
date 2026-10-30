// R269: app repositories in both editions declare dependency updates, a production audit gate, and image SBOM/provenance.
import { parseWorkflow, workflowFindings } from '../runtime-rules/workflow-source.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const DEPENDABOT = '.github/dependabot.yml';
const CI = '.github/workflows/ci.yml';
const IMAGES = '.github/workflows/images.yml';
const ECOSYSTEMS = ['npm', 'github-actions', 'docker'];
const enabled = (entry: Parsed) => entry && (entry.if === undefined || entry.if === true || entry.if === 'true') && !entry['continue-on-error'];

function shellSeparator(line: string, index: number, quote: Parsed) {
  if (quote) return null;
  if (line[index] === ';') return ';';
  const pair = line.slice(index, index + 2);
  return pair === '&&' || pair === '||' ? pair : null;
}

function isShellComment(line: string, index: number, quote: Parsed) {
  return !quote && line[index] === '#' && (index === 0 || /\s/.test(line[index - 1]!));
}

function shellQuote(char: Parsed, quote: Parsed) {
  if (char === quote) return null;
  return !quote && (char === '"' || char === "'") ? char : quote;
}

function appendShellCommand(commands: Parsed, state: Parsed, next: Parsed) {
  const tokens = state.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token: Parsed) => token.replace(/^["']|["']$/g, '')) ?? [];
  if (tokens.length) commands.push({ tokens, separator: state.separator, next });
  state.separator = next;
  state.command = '';
}

function shellLineCommands(line: string, commands: Parsed) {
  /** @type {{quote: string | null, command: string, separator: string | null}} */
  const state = { quote: null, command: '', separator: null };
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && state.quote !== "'") {
      i++;
      state.command += char + (line[i] ?? '');
      continue;
    }
    if (isShellComment(line, i, state.quote)) break;
    const next = shellSeparator(line, i, state.quote);
    if (next) {
      appendShellCommand(commands, state, next);
      if (next.length === 2) i++;
      continue;
    }
    state.quote = shellQuote(char, state.quote);
    state.command += char;
  }
  appendShellCommand(commands, state, null);
}

/** Shell evidence is an executable command, never quoted text, a comment or a heredoc body. */
function shellCommands(run: Parsed) {
  if (typeof run !== 'string') return [];
  const commands: Parsed[] = [];
  let heredoc = null;
  for (const line of run.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(line)?.[1] ?? null;
    shellLineCommands(line, commands);
  }
  return commands;
}

function executableCommands(run: Parsed) {
  const commands = shellCommands(run);
  const uncheckedErrors = commands.some(({ tokens }) => tokens[0] === 'set' && tokens.includes('+e'));
  if (uncheckedErrors) return [];
  return commands.filter((command, index) => {
    if (command.separator === '||' || command.next === '||') return false;
    if (command.separator === '&&' && commands.slice(0, index).some(({ tokens }) => ['false', 'exit', 'return'].includes(tokens[0]))) return false;
    return !commands.slice(index + 1).some(({ tokens }) => tokens[0] === 'exit' && tokens[1] === '0');
  });
}

/** Only enabled jobs and steps can provide a supply-chain gate. Comments, labels and disabled steps are no evidence. */
function stepsOf(workflow: Parsed) {
  return Object.values<Parsed>(workflow?.jobs ?? {}).filter(enabled).flatMap((job) => Array.isArray(job.steps) ? job.steps.filter(enabled) : []);
}

/** npm groups admit only minor and patch updates; canon packages are ignored for every update type. */
function hasNpmPolicy(update: Parsed) {
  const groups = update.groups && typeof update.groups === 'object' && !Array.isArray(update.groups) ? Object.values<Parsed>(update.groups) : [];
  const minorPatch = (group: Parsed) => Array.isArray(group?.['update-types']) && group['update-types'].includes('minor') && group['update-types'].includes('patch');
  return groups.length > 0 && groups.every((group) => Array.isArray(group?.['update-types']) && group['update-types'].length > 0 && group['update-types'].every((type) => ['minor', 'patch'].includes(type))) &&
    groups.some((group) => minorPatch(group) && [undefined, 'version-updates'].includes(group['applies-to'])) &&
    groups.some((group) => group['applies-to'] === 'security-updates') &&
    Array.isArray(update.ignore) && update.ignore.some((entry: Parsed) => entry?.['dependency-name'] === '@starci/*' && entry.versions === undefined && entry['update-types'] === undefined);
}

function hasDependabot(document: Parsed) {
  const directory = (value: Parsed) => typeof value === 'string' && value.startsWith('/');
  return document?.version === 2 && Array.isArray(document.updates) && ECOSYSTEMS.every((ecosystem) => document.updates.some((update: Parsed) =>
    update?.['package-ecosystem'] === ecosystem &&
    (directory(update.directory) || Array.isArray(update.directories) && update.directories.length > 0 && update.directories.every(directory)) &&
    ['daily', 'weekly', 'monthly'].includes(update.schedule?.interval))) &&
    document.updates.filter((update: Parsed) => update?.['package-ecosystem'] === 'npm').every(hasNpmPolicy);
}

function pinnedAction(value: Parsed) {
  return typeof value === 'string' && (/^\.\/[\w./-]+$/.test(value) ||
    /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f\d]{40}$/i.test(value) ||
    /^docker:\/\/[^\s@]+@sha256:[a-f\d]{64}$/i.test(value));
}

/** Mark YAML keys before parsing so comments and script scalars are ignored while flow maps and quoted keys retain their source lines. */
function workflowPinFindings({ path: file, text }: { path: string; text: string }) {
  const marked = text.replace(/(^|[\s{,])(?:"uses"|'uses'|uses)([ \t]*:)/gm, (_match: Parsed, prefix: string, colon: Parsed, offset: number) => {
    const line = text.slice(0, offset + prefix.length).split('\n').length;
    return `${prefix}__hfs_action_uses_line_${line}__${colon}`;
  });
  const findings: Finding[] = [];
  function visit(value: Parsed) {
    if (!value || typeof value !== 'object') return;
    for (const [key, member] of Object.entries<Parsed>(value)) {
      const line = /^__hfs_action_uses_line_(\d+)__$/.exec(key)?.[1];
      if (line && !pinnedAction(member)) findings.push(found('HFS_WORKFLOW_PIN', file, `${file}:${line}: every remote uses entry needs a full 40-hex commit SHA; container actions need a sha256 digest.`, { line: Number(line) }));
      visit(member);
    }
  }
  visit(parseWorkflow(marked));
  return findings;
}

function hasAudit(steps: Parsed) {
  return steps.some((step: Parsed) => executableCommands(step.run).some(({ tokens }) =>
    tokens[0] === 'npm' && tokens[1] === 'audit' &&
    (tokens.includes('--omit=dev') || tokens.some((token: Parsed, index: number) => token === '--omit' && tokens[index + 1] === 'dev'))));
}

const asserted = (value: Parsed) => value === true || value === 'true';
const provenanceEnabled = (value: Parsed) => asserted(value) || typeof value === 'string' && /^mode=(?:min|max)$/.test(value);

function imageActionEvidence(step: Parsed) {
  const action = step.uses ?? '';
  if (action.startsWith('docker/build-push-action@')) {
    return { sbom: asserted(step.with?.sbom), provenance: provenanceEnabled(step.with?.provenance) };
  }
  return {
    sbom: action.startsWith('actions/attest-sbom@') && Boolean(step.with?.['sbom-path']),
    provenance: action.startsWith('actions/attest-build-provenance@') && Boolean(step.with?.['subject-path'] || step.with?.['subject-digest']),
  };
}

function attestationType(value: Parsed, type: Parsed) {
  return value === `type=${type}` || value?.startsWith(`type=${type},`) === true;
}

function hasAttestation(tokens: Parsed, type: Parsed) {
  return tokens.some((token: Parsed, index: number) =>
    token.startsWith('--attest=') && attestationType(token.slice('--attest='.length), type) ||
    token === '--attest' && attestationType(tokens[index + 1], type));
}

function isSbomCommand(tokens: Parsed) {
  if (tokens[0] === 'syft') {
    return tokens.length > 1 && !tokens.some((token: Parsed) => ['--help', '--version', 'help', 'version'].includes(token));
  }
  return tokens[0] === 'docker' && tokens[1] === 'sbom' && tokens.length > 2 && !tokens.includes('--help');
}

function imageCommandEvidence(tokens: Parsed) {
  if (tokens.slice(0, 3).join(' ') !== 'docker buildx build') return { sbom: isSbomCommand(tokens), provenance: false };
  return {
    sbom: tokens.includes('--sbom') || tokens.includes('--sbom=true') || hasAttestation(tokens, 'sbom'),
    provenance: tokens.some((token: Parsed) => /^--provenance(?:=(?:true|mode=(?:min|max)))?$/.test(token)) || hasAttestation(tokens, 'provenance'),
  };
}

function imageEvidence(steps: Parsed) {
  let sbom = false;
  let provenance = false;
  for (const step of steps) {
    const action = imageActionEvidence(step);
    sbom ||= action.sbom;
    provenance ||= action.provenance;
    for (const { tokens } of executableCommands(step.run)) {
      const command = imageCommandEvidence(tokens);
      sbom ||= command.sbom;
      provenance ||= command.provenance;
    }
  }
  return sbom && provenance;
}

/** Synchronous judge of R269 at the app root; root-wide gates run only when their paths are in scope. */
export function supplyChainFindings({ repoRoot, files, all = files, repo, isRoot, inScope = () => true }: { repoRoot: string; files: string[]; all?: string[]; repo: Repo; isRoot: boolean; inScope?: (file: string) => boolean }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const tracked = new Set(all);
  const parsed = (file: string) => tracked.has(file) ? parseWorkflow(readText(repoRoot, file) ?? '') : null;
  const findings = [];
  if (inScope(DEPENDABOT) && !hasDependabot(parsed(DEPENDABOT))) findings.push(found('HFS_DEPENDABOT_MISSING', DEPENDABOT, 'Declare Dependabot version 2 updates for npm, github-actions and docker, each with a directory and schedule; every npm update must group minor+patch version updates, restrict every group to minor/patch (never major), include a security-updates group, and ignore all @starci/* updates (canon pins move only by starci upgrade).'));
  if (inScope(CI) && !hasAudit(stepsOf(parsed(CI)))) findings.push(found('HFS_AUDIT_STEP_MISSING', CI, 'CI must run npm audit --omit=dev in an enabled step whose failure stops the job.'));
  if (inScope(IMAGES) && !imageEvidence(stepsOf(parsed(IMAGES)))) findings.push(found('HFS_SBOM_MISSING', IMAGES, 'The images workflow must generate an SBOM and provenance for its release images in enabled steps.'));
  findings.push(...workflowFindings({ files: [...tracked].filter((file) => inScope(file)), read: (file: string) => readText(repoRoot, file) }, workflowPinFindings));
  return findings;
}

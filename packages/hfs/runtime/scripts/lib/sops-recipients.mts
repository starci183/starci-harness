// sops-recipients.mts - the recipient policy of every app's sealed members (owner, 2026-11-21, model B; contexts/project/stacks.md PROJECT-STACKS-5):
// which public age recipients each environment's `.sops.yaml` rule and members hold, exactly. The policy is data, knowledge/hfs/sops-recipients.yaml
// (the shipped copy of the harness repository's ops/vps/recipients.yaml): `harness` (the public half of the harness SOPS_AGE_KEY), the managed
// servers with their server and backup recipients, and per environment the tokens of its set (`harness`, `server`, `backup`; `otherwise` for an
// environment it does not name). Public halves only: nothing here reads, derives or needs a private key.
import fs from 'node:fs';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { parseYaml } from '../../engine/yaml.mjs';

/** The shipped policy file. */
export const RECIPIENT_POLICY_FILE = new URL('../../knowledge/hfs/sops-recipients.yaml', import.meta.url);
/** Where the policy is owned, for the messages that tell the owner what to change. */
export const RECIPIENT_POLICY_OWNER = 'ops/vps/recipients.yaml of the harness repository';

const RECIPIENT = /^age1[a-z0-9]+$/u;
/** The tokens an environment's set is written in. */
export const RECIPIENT_TOKENS = ['harness', 'server', 'backup'] as const;
export type RecipientToken = (typeof RECIPIENT_TOKENS)[number];

/** One managed server: its own recipient and its backup recipient (null until minted). */
export interface ServerRecipients { server: string | null; backup: string | null; enforce: boolean | null }

/** The recipient policy. */
export interface RecipientPolicy {
  harness: string;
  /** Whether R451 blocks (error) or only warns; a server's own `enforce` overrides it for its environments. */
  enforce: boolean;
  servers: Record<string, ServerRecipients>;
  environments: Record<string, RecipientToken[]>;
  otherwise: RecipientToken[];
}

const recipientOrNull = (value: unknown): string | null => (typeof value === 'string' && RECIPIENT.test(value) ? value : null);
const tokens = (value: unknown, where: string): RecipientToken[] => {
  if (!Array.isArray(value) || value.length === 0 || value.some((token) => !RECIPIENT_TOKENS.includes(token as RecipientToken)))
    throw new Error(`the recipient policy ${where} must be a non-empty list of ${RECIPIENT_TOKENS.join(', ')}`);
  return value as RecipientToken[];
};

/** The policy a document states; throws naming what is malformed. */
export function recipientPolicyOf(doc: unknown): RecipientPolicy {
  if (!plain(doc) || (doc as Record<string, unknown>).schema !== 'starci/sops-recipients@1') throw new Error('the recipient policy must be schema starci/sops-recipients@1');
  const record = doc as Record<string, unknown>;
  const harness = recipientOrNull(record.harness);
  if (harness === null) throw new Error('the recipient policy must name the harness recipient (age1...)');
  const servers: Record<string, ServerRecipients> = {};
  for (const [id, entry] of Object.entries(plain(record.servers) ? record.servers as Record<string, unknown> : {})) {
    const server = plain(entry) ? entry as Record<string, unknown> : {};
    servers[id] = { server: recipientOrNull(server.server), backup: recipientOrNull(server.backup), enforce: typeof server.enforce === 'boolean' ? server.enforce : null };
  }
  const environments: Record<string, RecipientToken[]> = {};
  for (const [env, list] of Object.entries(plain(record.environments) ? record.environments as Record<string, unknown> : {})) environments[env] = tokens(list, `environments.${env}`);
  if (record.enforce !== undefined && typeof record.enforce !== 'boolean') throw new Error('the recipient policy enforce must be true or false');
  return { harness, enforce: record.enforce === true, servers, environments, otherwise: tokens(record.otherwise, 'otherwise') };
}

let cached: RecipientPolicy | undefined;
/** The shipped policy, read once. */
export function recipientPolicy(): RecipientPolicy {
  cached ??= recipientPolicyOf(parseYaml(fs.readFileSync(RECIPIENT_POLICY_FILE, 'utf8')));
  return cached;
}

/** The tokens of `env`'s set. */
export const tokensOf = (policy: RecipientPolicy, env: string): RecipientToken[] => policy.environments[env] ?? policy.otherwise;

/** True when `env`'s set is the harness recipient alone: a dev environment, which this machine opens with the harness key. */
export const isHarnessEnvironment = (policy: RecipientPolicy, env: string): boolean => {
  const set = tokensOf(policy, env);
  return set.length === 1 && set[0] === 'harness';
};

/** What one recipient is to the policy: the harness key, a declared server's own or backup key, or an identity only this app knows. */
export type RecipientKind = { kind: 'harness' } | { kind: 'server' | 'backup'; server: string } | { kind: 'app-only' };
export function recipientKind(policy: RecipientPolicy, recipient: string): RecipientKind {
  if (recipient === policy.harness) return { kind: 'harness' };
  for (const [id, entry] of Object.entries(policy.servers)) {
    if (entry.server === recipient) return { kind: 'server', server: id };
    if (entry.backup === recipient) return { kind: 'backup', server: id };
  }
  return { kind: 'app-only' };
}

/** Whether R451 blocks for an environment deploying to `server` (null: dev, a catch-all, or no known server): the server's own switch, else the global one. */
export const enforcedFor = (policy: RecipientPolicy, server: string | null): boolean => (server === null ? null : policy.servers[server]?.enforce ?? null) ?? policy.enforce;

/** The set an environment must hold: the recipients resolved so far, and why any token could not be resolved (public facts only). */
export interface ExpectedRecipients {
  env: string;
  tokens: RecipientToken[];
  recipients: string[];
  /** The managed server the environment deploys to, when its recorded server recipient is a declared one. */
  server: string | null;
  /** One line per token that has no recipient yet; empty when the set is complete. */
  unresolved: string[];
}

/** The deploy server recipient `env` records (`environments.<env>.deploy.remote.serverRecipient`), or null. */
export function serverRecipientOf(stackDoc: unknown, env: string): string | null {
  const environments = plain(stackDoc) ? (stackDoc as Record<string, unknown>).environments : null;
  const spec = plain(environments) ? (environments as Record<string, unknown>)[env] : null;
  const deploy = plain(spec) ? (spec as Record<string, unknown>).deploy : null;
  const remote = plain(deploy) ? (deploy as Record<string, unknown>).remote : null;
  return plain(remote) ? recipientOrNull((remote as Record<string, unknown>).serverRecipient) : null;
}

/** The exact set `env` must hold under `policy`, given the server recipient it records. */
export function expectedRecipients(policy: RecipientPolicy, env: string, recorded: string | null): ExpectedRecipients {
  const set = tokensOf(policy, env);
  const recipients: string[] = [];
  const unresolved: string[] = [];
  const known = recorded === null ? null : recipientKind(policy, recorded);
  const server = known?.kind === 'server' ? known.server : null;
  for (const token of set) {
    if (token === 'harness') { recipients.push(policy.harness); continue; }
    if (recorded === null) { unresolved.push(`${env} records no deploy server (environments.${env}.deploy.remote.serverRecipient): make the server key with \`starci app secret server-key --env ${env} --execute\``); break; }
    if (server === null) { unresolved.push(`the server recipient ${recorded} that ${env} records is no server of ${RECIPIENT_POLICY_OWNER}: declare the server there (public half only)`); break; }
    const entry = policy.servers[server] as ServerRecipients;
    const value = token === 'server' ? entry.server : entry.backup;
    if (value === null) unresolved.push(`server ${server} has no ${token} recipient in ${RECIPIENT_POLICY_OWNER} yet${token === 'backup' ? ' (owed: the backup key of the server, its private half only in a GitHub Environment secret of the harness repository)' : ''}`);
    else recipients.push(value);
  }
  return { env, tokens: set, recipients, server, unresolved };
}

/** One creation rule of a `.sops.yaml`, as written. */
export interface CreationRule { path_regex?: unknown; age?: unknown; [name: string]: unknown }

/** The creation rules of a `.sops.yaml` text; null when it is not YAML or holds no list. */
export function creationRulesOf(text: string | null): CreationRule[] | null {
  if (text === null) return null;
  let doc: unknown;
  try { doc = parseYaml(text); } catch { return null; }
  const rules = plain(doc) ? (doc as Record<string, unknown>).creation_rules : null;
  return Array.isArray(rules) ? rules.filter((rule): rule is CreationRule => plain(rule)) : null;
}

/** The public recipients a rule names. */
export const ruleRecipients = (rule: CreationRule): string[] => (typeof rule.age === 'string' ? rule.age.split(',').map((value) => value.trim()).filter(Boolean) : []);

/** Whether `rule` matches the app-relative `file` as sops reads it (the path as written, or with backslashes); a rule with no path_regex matches all. */
export function ruleMatches(rule: CreationRule, file: string): boolean {
  if (typeof rule.path_regex !== 'string') return rule.path_regex === undefined;
  try {
    const regex = new RegExp(rule.path_regex, 'u');
    return regex.test(file) || regex.test(file.replaceAll('/', '\\'));
  } catch { return false; }
}

/** The index of the first rule sops uses for `file`, or -1. */
export const firstRuleFor = (rules: readonly CreationRule[], file: string): number => rules.findIndex((rule) => ruleMatches(rule, file));

/** The path of a member of `env`, the probe a rule is matched against. */
export const memberProbe = (env: string): string => `.starcistacks/${env}/secrets/member.enc.yaml`;
/** An environment name no app declares: a rule that matches its member reaches every environment without a rule of its own. */
export const UNDECLARED_PROBE_ENV = 'an-undeclared-environment';

/** The sorted, de-duplicated copy of a recipient list, for comparing sets. */
export const recipientSet = (values: readonly string[]): string[] => [...new Set(values)].sort();
/** Whether two recipient lists hold the same set. */
export const sameRecipients = (left: readonly string[], right: readonly string[]): boolean => recipientSet(left).join(',') === recipientSet(right).join(',');

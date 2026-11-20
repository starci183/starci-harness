// sops-recipients.mts - R451: every app's sealed members follow the one recipient policy (owner, 2026-11-21, model B; contexts/project/stacks.md
// PROJECT-STACKS-5; the policy is knowledge/hfs/sops-recipients.yaml, owned by ops/vps/recipients.yaml of the harness repository). Public halves only:
// the rule reads `.sops.yaml` and the cleartext `sops.age` recipients of each member, never a value and never a key.
//   HFS_SOPS_RECIPIENTS            the rule sops uses for an environment's members does not name exactly the environment's set: dev holds the harness
//                                  recipient alone; staging and production hold the key of the VPS they deploy to plus that server's backup, and never
//                                  the harness key. A recipient that is no declared key is an app-only identity.
//   HFS_SOPS_RECIPIENT_UNDECLARED  an environment's set cannot be resolved: it records no deploy server, its server is not declared, or the server's
//                                  backup recipient is not minted yet.
//   HFS_SOPS_CATCH_ALL             a rule reaches the members of an environment the app does not declare (a catch-all), so a new environment would be
//                                  sealed to whatever it names; each environment keeps a rule of its own.
//   HFS_SOPS_MEMBER_RECIPIENTS     a sealed member is not sealed to exactly its environment's set (a member keeps its recipients until it is sealed again).
// Each is report-only in `--env local` and blocks in `--env prod` (localOnly in modules/kernel/failure-codes.yaml).
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { envelopeOf } from '../secret-document.mjs';
import {
  RECIPIENT_POLICY_OWNER, UNDECLARED_PROBE_ENV, creationRulesOf, expectedRecipients, firstRuleFor, isHarnessEnvironment, memberProbe,
  recipientKind, recipientPolicy, ruleRecipients, serverRecipientOf,
  type CreationRule, type ExpectedRecipients, type RecipientPolicy,
} from '../../lib/sops-recipients.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const SOPS_RECIPIENTS = 'HFS_SOPS_RECIPIENTS';
export const SOPS_RECIPIENT_UNDECLARED = 'HFS_SOPS_RECIPIENT_UNDECLARED';
export const SOPS_CATCH_ALL = 'HFS_SOPS_CATCH_ALL';
export const SOPS_MEMBER_RECIPIENTS = 'HFS_SOPS_MEMBER_RECIPIENTS';

const SOPS_FILE = '.sops.yaml';
const STACK_FILE = '.starcistacks/application-stacks.yaml';
const MEMBER = /^\.starcistacks\/([a-z0-9][a-z0-9-]*)\/secrets\/[^/]+\.enc(?:\.yaml)?$/u;
const local = { local: true };
const short = (recipient: string): string => `${recipient.slice(0, 12)}…`;

/** What each recipient that does not belong in `env`'s set is, in words. */
function strangers(policy: RecipientPolicy, expected: ExpectedRecipients, actual: readonly string[]): string[] {
  const harnessEnv = isHarnessEnvironment(policy, expected.env);
  return actual.filter((recipient) => !expected.recipients.includes(recipient)).map((recipient) => {
    const kind = recipientKind(policy, recipient);
    if (kind.kind === 'harness') return `${short(recipient)} is the harness key, which must never open ${expected.env}`;
    if (kind.kind === 'app-only') return `${short(recipient)} is an app-only identity (no key of ${RECIPIENT_POLICY_OWNER})`;
    if (harnessEnv) return `${short(recipient)} is the ${kind.kind} key of server ${kind.server}, which a dev environment never holds`;
    return `${short(recipient)} is the ${kind.kind} key of server ${kind.server}, not of ${expected.server ?? 'the server this environment deploys to'}`;
  });
}

/** How the owner moves `env` to its set. */
function fixOf(policy: RecipientPolicy, expected: ExpectedRecipients, actual: readonly string[]): string {
  const wanted = expected.recipients.join(',');
  if (isHarnessEnvironment(policy, expected.env)) {
    const add = expected.recipients.filter((recipient) => !actual.includes(recipient)).map((recipient) => ` --add ${recipient}`).join('');
    const remove = actual.filter((recipient) => !expected.recipients.includes(recipient)).map((recipient) => ` --remove ${recipient}`).join('');
    return `set the ${expected.env} rule to \`age: ${wanted}\` (\`starci app secret recipients --env ${expected.env}${add}${remove} --execute\`), then seal each member again with an identity that opens it (\`starci app secret migrate --env ${expected.env} <member> --execute\`)`;
  }
  const target = expected.unresolved.length ? `the server key plus the server's backup (${expected.unresolved.join('; ')})` : `\`age: ${wanted}\``;
  return `set the ${expected.env} rule to ${target} and reseal its members ON the server with the server key (sops rotate, a new data key, no plaintext on disk; a value a dev-side key ever opened is rotated, not only resealed; PROJECT-STACKS-5 "Moving an environment to the recipient policy"); this machine holds the public halves only`;
}

/** The environments to judge: the ones the stack declares and every one that tracks a sealed member. */
function environmentsOf(stackDoc: unknown, members: readonly string[]): string[] {
  const environments = plain(stackDoc) ? (stackDoc as Record<string, unknown>).environments : null;
  const declared = plain(environments) ? Object.keys(environments as Record<string, unknown>) : [];
  const sealed = members.map((file) => MEMBER.exec(file)?.[1]).filter((env): env is string => env !== undefined);
  return [...new Set([...declared, ...sealed])].sort();
}

/** R451 over a parsed `.sops.yaml`, a parsed stack declaration and the tracked members with their text. Pure. */
export function sopsRecipientFindings({ rules, stackDoc, members, policy }: {
  rules: readonly CreationRule[];
  stackDoc: unknown;
  members: ReadonlyArray<{ file: string; text: string | null }>;
  policy: RecipientPolicy;
}): Finding[] {
  const findings: Finding[] = [];
  const environments = environmentsOf(stackDoc, members.map((member) => member.file));
  const expectedByEnv = new Map(environments.map((env) => [env, expectedRecipients(policy, env, serverRecipientOf(stackDoc, env))]));
  for (const env of environments) {
    const expected = expectedByEnv.get(env) as ExpectedRecipients;
    if (expected.unresolved.length) findings.push(found(SOPS_RECIPIENT_UNDECLARED, STACK_FILE, `${env} cannot be sealed to its recipient set (${expected.tokens.join(' + ')}): ${expected.unresolved.join('; ')} (R451, PROJECT-STACKS-5)`, { ...local, env }));
    const at = firstRuleFor(rules, memberProbe(env));
    if (at < 0) {
      findings.push(found(SOPS_RECIPIENTS, SOPS_FILE, `no rule of .sops.yaml reaches the members of ${env}: ${fixOf(policy, expected, [])} (R451)`, { ...local, env }));
      continue;
    }
    const actual = ruleRecipients(rules[at] as CreationRule);
    const off = strangers(policy, expected, actual);
    const missing = expected.recipients.filter((recipient) => !actual.includes(recipient));
    if (off.length === 0 && missing.length === 0) continue;
    const what = [...missing.map((recipient) => `it lacks ${short(recipient)} (${recipientKind(policy, recipient).kind})`), ...off].join('; ');
    findings.push(found(SOPS_RECIPIENTS, SOPS_FILE, `the rule sops uses for ${env} (creation_rules[${String(at)}]) names ${actual.map(short).join(', ') || 'no recipient'}: ${what}. Fix: ${fixOf(policy, expected, actual)} (R451, PROJECT-STACKS-5)`, { ...local, env }));
  }
  const catchAll = firstRuleFor(rules, memberProbe(UNDECLARED_PROBE_ENV));
  if (catchAll >= 0) {
    const names = ruleRecipients(rules[catchAll] as CreationRule);
    findings.push(found(SOPS_CATCH_ALL, SOPS_FILE, `creation_rules[${String(catchAll)}] reaches the members of any environment without a rule of its own (sealed to ${names.map(short).join(', ') || 'no recipient'}), so a new environment would be sealed to it: remove it and keep one rule per environment, dev to the harness recipient and every deployed environment to its server key plus the server's backup (R451, PROJECT-STACKS-5)`, local));
  }
  for (const member of members) {
    const env = MEMBER.exec(member.file)?.[1];
    if (env === undefined || member.text === null) continue;
    let recipients: string[];
    try { recipients = envelopeOf(member.text).recipients; } catch { continue; }
    const expected = expectedByEnv.get(env) as ExpectedRecipients;
    const off = strangers(policy, expected, recipients);
    const missing = expected.unresolved.length ? [] : expected.recipients.filter((recipient) => !recipients.includes(recipient));
    if (off.length === 0 && missing.length === 0) continue;
    const what = [...missing.map((recipient) => `it lacks ${short(recipient)} (${recipientKind(policy, recipient).kind})`), ...off].join('; ');
    findings.push(found(SOPS_MEMBER_RECIPIENTS, member.file, `${member.file} is sealed to ${recipients.map(short).join(', ') || 'no age recipient'}: ${what}. Fix: ${fixOf(policy, expected, recipients)} (R451)`, { ...local, env }));
  }
  return findings;
}

/** Findings of R451 at the app root of an app. */
export function appSopsRecipientFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const members = all.filter((file) => MEMBER.test(file));
  const sops = readText(repoRoot, SOPS_FILE);
  if (sops === null && members.length === 0) return [];
  const rules = creationRulesOf(sops) ?? [];
  let stackDoc: unknown = null;
  try { stackDoc = parseYaml(readText(repoRoot, STACK_FILE) ?? ''); } catch { stackDoc = null; }
  return sopsRecipientFindings({ rules, stackDoc, members: members.map((file) => ({ file, text: readText(repoRoot, file) })), policy: recipientPolicy() });
}

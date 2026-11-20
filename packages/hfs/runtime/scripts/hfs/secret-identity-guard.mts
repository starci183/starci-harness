// secret-identity-guard.mts - the SOPS_AGE_KEY guard (owner, 2026-11-21; contexts/project/stacks.md PROJECT-STACKS-5): before sops opens a dev
// member, the public recipient of every SOPS_AGE_KEY the lookup could take (the environment, the app's `.claude/secret.env`, its main checkout's,
// the harness secret.env) is compared with the member's cleartext `sops.age` recipients. When the one the lookup takes opens nothing, the refusal
// names the file it was read from, the recipient prefix that file holds and the prefix expected, and any later place that would have matched,
// instead of sops' opaque error. It guards dev environments only (the policy's harness environments): a deployed environment is opened on its
// server, so a dev machine holding no identity for it is expected. Only public recipients are derived (age-keygen -y), and none is printed whole.
//
// The incident it answers: on 2026-11-21 a package key pasted over SOPS_AGE_KEY in an app's `.claude/secret.env` hid the identity that opened its
// dev members. A package key lives under its own variable name (e.g. NIVO_PACKAGE_AGE_KEY), never SOPS_AGE_KEY.
import fs from "node:fs";
import path from "node:path";
import { secretEnv } from "../../engine/secrets.mjs";
import { resolveRealTool } from "../api/process/resolve-real-tool.mjs";
import { runProgram } from "../api/process/run-program.mjs";
import { selectedAgeRecipient } from "../api/sops/selected-age-recipient.mjs";
import { isHarnessEnvironment, recipientPolicy, type RecipientPolicy } from "../lib/sops-recipients.mjs";
import { envelopeOf } from "./secret-document.mjs";
import { mainCheckout } from "./secret-files.mjs";
import type { AgeHost, SecretToolOverrides } from "./secret-init.mjs";

/** One place a SOPS_AGE_KEY may come from, in lookup order, with the public recipient it holds (null when none could be derived). */
export interface IdentityCandidate {
  source: string;
  recipient: string | null;
}

const INLINE = /^SOPS_AGE_KEY$/iu;
const FILE_SELECTION = /^SOPS_AGE_KEY_FILE$/iu;
const MEMBER = /\.starcistacks[/\\]([a-z0-9][a-z0-9-]*)[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$/u;
const prefix = (recipient: string): string => `${recipient.slice(0, 12)}…`;

/** The public recipient of one inline identity, derived without the value leaving this process; null when it cannot be derived. */
function publicOf(value: string, env: NodeJS.ProcessEnv, cwd: string, tools: SecretToolOverrides | undefined): string | null {
  const isolated: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !INLINE.test(name) && !FILE_SELECTION.test(name)));
  const result = selectedAgeRecipient({
    env: { ...isolated, SOPS_AGE_KEY: value.trim() },
    cwd: path.resolve(cwd),
    invocation: { runProgram: tools?.runProgram ?? runProgram, resolveRealTool: tools?.resolveRealTool ?? resolveRealTool },
  });
  return result.ok ? result.publicRecipient : null;
}

/**
 * Every SOPS_AGE_KEY the lookup (secret-init.mts localAgeIdentity) could take, in its order. A place that selects SOPS_AGE_KEY_FILE ends the list
 * with a null recipient: the key file is sops' to read, so the guard does not judge it.
 */
export function identityCandidates(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  { tools, host = null }: { tools?: SecretToolOverrides | undefined; host?: AgeHost | null | undefined } = {},
): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  const consider = (source: string, values: NodeJS.ProcessEnv): boolean => {
    const inline = Object.entries(values).find(([name, value]) => INLINE.test(name) && typeof value === "string" && value.trim() !== "");
    if (inline) { candidates.push({ source, recipient: publicOf(String(inline[1]), env, repoRoot, tools) }); return false; }
    if (Object.entries(values).some(([name, value]) => FILE_SELECTION.test(name) && value)) { candidates.push({ source, recipient: null }); return true; }
    return false;
  };
  if (consider("the environment (SOPS_AGE_KEY)", env)) return candidates;
  const load = tools?.secretEnv ?? secretEnv;
  for (const root of [...new Set([repoRoot, mainCheckout(repoRoot)].map((each) => path.resolve(each)))]) {
    let values: NodeJS.ProcessEnv;
    try { values = load(path.join(root, ".claude"), {}) ?? {}; } catch { continue; }
    if (consider(path.join(root, ".claude", "secret.env"), values)) return candidates;
  }
  if (host) {
    let value: unknown;
    try { value = host.read(); } catch { value = undefined; }
    if (typeof value === "string" && value.trim()) candidates.push({ source: host.label, recipient: publicOf(value, env, repoRoot, tools) });
  }
  return candidates;
}

/** The environment of a member path, when it is one. */
export const memberEnvironment = (file: string): string | null => MEMBER.exec(file)?.[1] ?? null;

/**
 * The refusal text for `file` when the identity the lookup takes is not one it is sealed to, or null when the guard has nothing to say: the file
 * is no dev member, its recipients cannot be read, the selected identity is a key file or underivable, or it matches.
 */
export function identityMismatch(
  file: string,
  candidates: readonly IdentityCandidate[],
  policy: RecipientPolicy = recipientPolicy(),
): string | null {
  const env = memberEnvironment(file);
  if (env === null || !isHarnessEnvironment(policy, env)) return null;
  let recipients: string[];
  try { recipients = envelopeOf(fs.readFileSync(file, "utf8")).recipients; } catch { return null; }
  if (recipients.length === 0) return null;
  const selected = candidates[0];
  if (!selected || selected.recipient === null || recipients.includes(selected.recipient)) return null;
  const later = candidates.slice(1).find((candidate) => candidate.recipient !== null && recipients.includes(candidate.recipient));
  const looked = candidates.map((candidate) => `${candidate.source}: ${candidate.recipient === null ? "no recipient derived" : prefix(candidate.recipient)}`).join("; ");
  const expected = recipients.map(prefix).join(" or ");
  const way = later
    ? `${later.source} holds a matching identity, but the SOPS_AGE_KEY of ${selected.source} is read first and shadows it: remove that line, or rename it if it is another key (a package key lives under its own name, e.g. NIVO_PACKAGE_AGE_KEY, never SOPS_AGE_KEY)`
    : `no place here holds it: put the harness SOPS_AGE_KEY (the recipient ${prefix(policy.harness)}) in the harness secret.env, and keep any other key under its own name (e.g. NIVO_PACKAGE_AGE_KEY), never SOPS_AGE_KEY`;
  return `SECRET_IDENTITY_MISMATCH: the SOPS_AGE_KEY read from ${selected.source} is the recipient ${prefix(selected.recipient)}, but ${path.basename(file)} (${env}) is sealed to ${expected}; looked in ${looked}. Fix: ${way}`;
}

/** One finding of the guard in `starci app check --env local`. */
export interface IdentityGuardFinding { code: "HFS_SOPS_IDENTITY_MISMATCH"; level: "warning"; path: string; message: string }

/**
 * `starci app check --env local`: the guard over the first sealed member of every dev environment the app tracks, as `stack up` would meet it,
 * reported as a warning (the host's identity is no property of the tree). Nothing is decrypted.
 */
export function identityGuardFindings(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  { tools, host = null, policy = recipientPolicy() }: { tools?: SecretToolOverrides | undefined; host?: AgeHost | null | undefined; policy?: RecipientPolicy } = {},
): IdentityGuardFinding[] {
  const stacks = path.join(repoRoot, ".starcistacks");
  let environments: string[] = [];
  try { environments = fs.readdirSync(stacks, { withFileTypes: true }).filter((entry) => entry.isDirectory() && isHarnessEnvironment(policy, entry.name)).map((entry) => entry.name).sort(); } catch { return []; }
  const findings: IdentityGuardFinding[] = [];
  let candidates: IdentityCandidate[] | undefined;
  for (const environment of environments) {
    const directory = path.join(stacks, environment, "secrets");
    let first: string | undefined;
    try { first = fs.readdirSync(directory).filter((name) => /\.enc(?:\.yaml)?$/u.test(name)).sort()[0]; } catch { first = undefined; }
    if (first === undefined) continue;
    candidates ??= identityCandidates(repoRoot, env, { tools, host });
    const file = path.join(directory, first);
    const mismatch = identityMismatch(file, candidates, policy);
    if (mismatch !== null) findings.push({ code: "HFS_SOPS_IDENTITY_MISMATCH", level: "warning", path: path.relative(repoRoot, file).split(path.sep).join("/"), message: `${mismatch} (stack up would refuse; R451)` });
  }
  return findings;
}

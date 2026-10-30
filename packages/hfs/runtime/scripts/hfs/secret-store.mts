// secret-store.mjs - sealed secret paths and atomic named-value updates.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { claimFile } from "../api/fs/claim-file.mjs";
import { isSopsEnvelope } from "../lib/sops-envelope.mjs";
import { byCodeUnit } from "../lib/list.mjs";
import { LEGACY_SUFFIX, isLegacyName, isSealedName, memberFile } from "../lib/sealed-member.mjs";
import {
  type SecretEnvelope,
  envelopeOf,
  plaintextOf,
  validateKey,
  validateMap,
} from "./secret-document.mjs";
import { type SecretSops, defaultSops } from "./secret-sops.mjs";
import { SecretError } from "./secret-errors.mjs";

const SLUG = /^[a-z0-9][a-z0-9-]*$/u;

/** The directory of the sealed secrets of the app at `repoRoot` for `env`; the one env that has secrets when none is named. */
export function secretsDirectory(
  repoRoot: string,
  env?: string | null,
): string {
  const stacks = path.join(repoRoot, ".starcistacks");
  if (env) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(env))
      throw new SecretError(`--env ${env} is not an environment name`);
    return path.join(stacks, env, "secrets");
  }
  if (!fs.existsSync(stacks))
    throw new SecretError(
      "this app has no .starcistacks; run starci app secret at the app root, or pass --cwd",
    );
  const withSecrets = fs
    .readdirSync(stacks, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(stacks, entry.name, "secrets")),
    )
    .map((entry) => entry.name);
  if (withSecrets.length === 1)
    return path.join(stacks, withSecrets[0] as string, "secrets");
  throw new SecretError(
    withSecrets.length === 0
      ? "no environment of .starcistacks has a secrets folder; pass --env to create the first secret"
      : `more than one environment has secrets (${withSecrets.join(", ")}); pass --env`,
  );
}

export const fileOf = (directory: string, slug: string | undefined): string => {
  if (!SLUG.test(slug ?? ""))
    throw new SecretError(
      `${slug === undefined ? "a secret name" : slug} is not a secret slug: lowercase letters, digits and dashes`,
    );
  try { return memberFile(directory, slug as string); } // SLUG matched above, so slug is a non-empty string
  catch (error) { throw new SecretError((error as Error).message); }
};

/**
 * Build and validate a replacement envelope without publishing it. An existing member is decrypted only when it holds a key
 * `values` does not replace; a member whose every key is replaced (the one-key member a `set` re-seals) needs no age identity.
 */
function sealSecretMap({
  file,
  values,
  age,
  sops,
}: {
  file: string;
  values: Record<string, string>;
  age: string[];
  sops: SecretSops;
}): string {
  let map: Record<string, string> = Object.create(null);
  let recipients = age;
  const legacy = isLegacyName(path.basename(file));
  if (fs.existsSync(file)) {
    const envelope = envelopeOf(fs.readFileSync(file, "utf8"));
    if (!envelope.keys.every((key) => Object.hasOwn(values, key)))
      map = sops.decrypt(file, envelope.format);
    if (!age.length && legacy) recipients = envelope.recipients;
  }
  validateMap(map);
  map = { ...map, ...values };
  // A member is sops YAML, its values double-quoted scalars kept byte for byte, sealed to the recipients its environment's
  // .sops.yaml rule names (so a re-seal follows a recipients change); a legacy member stays dotenv to its own recipients.
  const format = legacy ? "dotenv" : "yaml";
  const sealed = sops.seal({ inputType: format, plaintext: plaintextOf(format, map), recipients, filenameOverride: file });
  let parsed: SecretEnvelope;
  try { parsed = envelopeOf(sealed); }
  catch { throw new SecretError("sops returned an invalid sealed document"); }
  if (!isSopsEnvelope(sealed) || parsed.keys.length !== Object.keys(map).length || !parsed.keys.every((key) => Object.hasOwn(map, key)))
    throw new SecretError("sops returned an invalid sealed document");
  return sealed;
}

/** Publish through an explicit file owner, or the canonical atomic replace. */
function publishSealed(
  file: string,
  sealed: string,
  write?: ((file: string, sealed: string) => void) | undefined,
): void {
  if (write) { write(file, sealed); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), "." + path.basename(file) + "-" + randomUUID() + ".tmp");
  try {
    fs.writeFileSync(temporary, sealed, { flag: "wx", mode: 0o600, flush: true });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function underClaim(file: string, action: () => void): void {
  const held = claimFile(path.resolve(file));
  if (!held.ok)
    throw new SecretError("the sealed secret is being updated; retry after that write settles");
  try {
    action();
  } finally { held.release(); }
}

/** Replace one existing sealed member with an already validated envelope: same claim and atomic publish as set. */
export const replaceSealed = (file: string, sealed: string): void => underClaim(file, () => publishSealed(file, sealed));

/** Delete one sealed member under the writer claim. */
export const deleteSealed = (file: string): void => underClaim(file, () => fs.unlinkSync(file));

/** Seal named values; a supplied writer owns its own claim and rollback (the fresh-app scaffold). */
export function writeSecret({
  file,
  values,
  age,
  sops,
  write,
}: {
  file: string;
  values: Record<string, string>;
  age: string[];
  sops: SecretSops;
  write?: ((file: string, sealed: string) => void) | undefined;
}): void {
  for (const key of Object.keys(values)) validateKey(key);
  const held = write ? { ok: true, release() {} } : claimFile(path.resolve(file));
  if (!held.ok)
    throw new SecretError("the sealed secret is being updated; retry after that write settles");
  try {
    publishSealed(file, sealSecretMap({ file, values, age, sops }), write);
  } finally { held.release(); }
}

/**
 * Update named keys through the same canonical sealed-secret owner used by the CLI. `legacy` creates a new member as a dotenv
 * `.enc`, for the sops-free bootstrap sealer of a fresh scaffold, which writes only that format; `migrate` moves it later.
 */
export function setSecretValues(
  repoRoot: string,
  {
    slug,
    values,
    env = null,
  }: {
    slug: string;
    values: Record<string, string>;
    env?: string | null | undefined;
  },
  {
    sops = null,
    age = [],
    processEnv = process.env,
    write,
    legacy = false,
  }: {
    sops?: SecretSops | null | undefined;
    age?: string[] | undefined;
    processEnv?: NodeJS.ProcessEnv | undefined;
    write?: ((file: string, sealed: string) => void) | undefined;
    legacy?: boolean | undefined;
  } = {},
): { file: string; via: string } {
  const directory = secretsDirectory(repoRoot, env);
  const existing = fileOf(directory, slug);
  const file = legacy && !fs.existsSync(existing) ? path.join(directory, `${slug}${LEGACY_SUFFIX}`) : existing;
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    !Object.keys(values).length
  )
    throw new SecretError("secret update requires named values");
  for (const value of Object.values(values))
    if (typeof value !== "string" || value === "")
      throw new SecretError("secret values must be nonempty strings");
  writeSecret({
    file,
    values,
    age,
    sops: sops ?? defaultSops(processEnv, repoRoot),
    write,
  });
  return { file, via: "sealed-secret" };
}

export function sealedFiles(directory: string): string[] {
  return fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter(isSealedName)
        .sort(byCodeUnit)
    : [];
}

export function readMap(file: string, sops: Pick<SecretSops, "decrypt">): Record<string, string> {
  if (!fs.existsSync(file))
    throw new SecretError(
      "the requested secret is not sealed in this environment",
    );
  const map = sops.decrypt(
    file,
    envelopeOf(fs.readFileSync(file, "utf8")).format,
  );
  validateMap(map);
  return map;
}

// secret-dev-init.mjs - `starci app secret init --env <dev env> [--execute]`: creates the dev-only values the environment's `local.custody`
// declares (PROJECT-STACKS-5: sealed only, owner-armed, created once, never replaced). It refuses an environment that is not a docker-compose
// dev environment (vps and production never get generated values), skips a key its member already holds, and refuses a half-present pair
// instead of minting a replacement. Values are generated in memory and sealed in one write per member; names are all it prints.
import fs from "node:fs";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { envelopeOf } from "./secret-document.mjs";
import { SecretError } from "./secret-errors.mjs";
import type { SecretSops } from "./secret-sops.mjs";
import { fileOf, secretsDirectory, writeSecret } from "./secret-store.mjs";
import { declareKeys } from "./secret-standard.mjs";
import { isLocalEnvironment, loadLocalConfig } from "../../../stack/local-config.mjs";
import type { CustodyGenerator } from "./stack-local-config.mjs";

/** One generated value (or a private/public pair) by its kind; the `password` kind is URL- and SQL-safe. */
export function generateValues(entry: CustodyGenerator, random: (bytes: number) => Buffer = randomBytes): Record<string, string> {
  if (entry.kind === "hex") return { [entry.key]: random(entry.bytes).toString("hex") };
  if (entry.kind === "base64") return { [entry.key]: random(entry.bytes).toString("base64") };
  if (entry.kind === "password") return { [entry.key]: random(entry.bytes).toString("base64url") };
  if (entry.kind === "uuid") return { [entry.key]: randomUUID() };
  if (entry.kind === "rsa-pem" || entry.kind === "ec-pem" || entry.kind === "ed25519-pem") {
    const encodings = { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } } as const;
    const pair = entry.kind === "rsa-pem"
      ? generateKeyPairSync("rsa", { modulusLength: 2048, ...encodings })
      : entry.kind === "ec-pem" ? generateKeyPairSync("ec", { namedCurve: "P-256", ...encodings }) : generateKeyPairSync("ed25519", encodings);
    return { [entry.key]: pair.privateKey, ...(entry.publicKey ? { [entry.publicKey]: pair.publicKey } : {}) };
  }
  throw new SecretError(`the generator ${entry.kind} is unknown`);
}

/** Seals the missing dev values of `environment`; a dry run unless `execute`. Returns the exit code. */
export function seedDevCustody(
  repoRoot: string,
  environment: string,
  { execute, sops, stdout, random = randomBytes }: { execute: boolean; sops: () => SecretSops; stdout: (text: string) => unknown; random?: (bytes: number) => Buffer },
): number {
  if (!isLocalEnvironment(repoRoot, environment))
    throw new SecretError(`secret init --env ${environment}: only a docker-compose dev environment gets generated values; a vps or production value is set by the owner with secret set (PROJECT-STACKS-5)`);
  const local = loadLocalConfig({ repoRoot, env: environment });
  if (local.custody.length === 0)
    throw new SecretError(`environment ${environment} declares no local.custody: nothing to generate; the owner seals its values with secret set`);
  const directory = secretsDirectory(repoRoot, environment);
  const byMember = new Map<string, CustodyGenerator[]>();
  for (const entry of local.custody) byMember.set(entry.member, [...(byMember.get(entry.member) ?? []), entry]);
  const writes: Array<{ file: string; member: string; values: Record<string, string> }> = [];
  for (const [member, entries] of byMember) {
    const file = fileOf(directory, member);
    const held = fs.existsSync(file) ? envelopeOf(fs.readFileSync(file, "utf8")).keys : [];
    const values: Record<string, string> = {};
    for (const entry of entries) {
      const names = [entry.key, ...(entry.publicKey ? [entry.publicKey] : [])];
      const have = names.filter((name) => held.includes(name));
      if (have.length === names.length) { stdout(`kept ${environment}/${member} ${entry.key} (already sealed, never replaced)\n`); continue; }
      if (have.length > 0) throw new SecretError(`${environment}/${member} holds ${have.join(", ")} but not the rest of its pair ${names.join(", ")}: a replacement is never minted for an existing sealed value; the owner removes the pair with secret unset and runs init again`);
      Object.assign(values, generateValues(entry, random));
    }
    if (Object.keys(values).length) writes.push({ file, member, values });
  }
  for (const write of writes) {
    const names = Object.keys(write.values);
    if (!execute) { stdout(`would seal ${environment}/${write.member} (${names.join(", ")})\n`); continue; }
    writeSecret({ file: write.file, values: write.values, age: [], sops: sops() });
    stdout(`sealed ${environment}/${write.member} (${names.join(", ")})\n`);
    const declaration = declareKeys(repoRoot, environment, write.member, names);
    if (declaration.declared.length) stdout(`declared ${declaration.declared.join(", ")} in environments.${environment}.secrets of application-stacks.yaml\n`);
  }
  if (writes.length === 0) stdout("nothing to create: every declared dev value is sealed\n");
  else if (!execute) stdout("dry run: nothing was written; arm it with --execute (the owner's yes)\n");
  return 0;
}

// secret-ext.mts - `starci app secret set|unset|list --env <env> --ext <target>` (PROJECT-STACKS-5): the sealed file of a secret target the project's
// ext/manifest.json declares (`secretTargets`, starci/project-ext@1), such as a package's seed standard keeping its credentials in
// `secrets.<env>.enc.yaml` of its own checkout. The target resolves through the extension (root, file per environment, the .sops.yaml whose creation
// rule names the recipients, the mapping path and key depth); everything else is the verb's own: the masked prompt, redirected stdin, `--from-file`,
// `--generate`, the sops seam, the writer claim, "never printed". Nothing here knows what the file means, and no value reaches the stack.
// A key is `a/b` of `depth` segments below `under` (depth 1 and no `under`: a flat KEY). unset is a dry run until --execute, as it is for a member.
import fs from "node:fs";
import path from "node:path";
import { isSopsEnvelope } from "../lib/sops-envelope.mjs";
import { loadProjectExt, secretTargetPaths } from "../lib/project-ext.mjs";
import type { SecretTarget } from "../lib/project-ext.mjs";
import { type SecretSops } from "./secret-sops.mjs";
import { SecretError } from "./secret-errors.mjs";
import { replaceSealed } from "./secret-store.mjs";
import { ENVIRONMENT_TOKENS } from "./rules/env-parity.mjs";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const isMap = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** What `--ext <id>` resolved to: the declared target, its checkout, its sealed file for the environment and its .sops.yaml. */
export interface ResolvedTarget { target: SecretTarget; root: string; file: string; sopsFile: string }

/** The target `id` of the project's extension for `environment`; a typed refusal listing the declared targets (or the environments it seals) otherwise. */
export function resolveSecretTarget(repoRoot: string, id: string, environment: string): ResolvedTarget {
  const ext = loadProjectExt(repoRoot);
  if (ext.problems.length > 0) throw new SecretError(`SECRET_TARGET_EXT_INVALID: ext/manifest.json is refused (${ext.problems[0]?.message ?? "invalid"}); run starci app check`);
  const target = ext.secretTargets.find((entry) => entry.id === id);
  if (target === undefined) {
    const declared = ext.secretTargets.map((entry) => entry.id);
    throw new SecretError(`SECRET_TARGET_UNKNOWN: ${id} is no secret target of this project's ext/manifest.json (${declared.length ? `declared: ${declared.join(", ")}` : "it declares none"})`);
  }
  const where = secretTargetPaths(repoRoot, target, environment);
  if (where.file === null) throw new SecretError(`SECRET_TARGET_ENVIRONMENT: the target ${id} seals ${Object.keys(target.environments).join(", ")}, not ${environment}`);
  return { target, root: where.root, file: where.file, sopsFile: where.sopsFile };
}

/** The refusal of a key that is not a path of the target's depth, or whose segment names an environment (the environment is the file, never the name). */
export function validateTargetKey(target: SecretTarget, key: string): string[] {
  const segments = key.split("/");
  if (segments.length !== target.depth || segments.some((segment) => !SEGMENT.test(segment)))
    throw new SecretError(`SECRET_TARGET_KEY: ${JSON.stringify(key)} is not a key of ${target.id}: ${target.depth} segment${target.depth === 1 ? "" : "s"} of letters, digits, dot, dash and underscore joined by /${segments.length === 1 && target.depth > 1 ? "; a provider slug belongs to the member form (set --env <env> <slug> <KEY>) and cannot be combined with --ext, which takes only keys" : ""}`);
  for (const segment of segments) {
    const upper = segment.toUpperCase();
    if (ENVIRONMENT_TOKENS.some((token) => upper.startsWith(`${token}_`) || upper.startsWith(`${token}-`)))
      throw new SecretError(`SECRET_TARGET_KEY: ${JSON.stringify(key)} carries an environment (a leading ${ENVIRONMENT_TOKENS.join(", ")}): the environment is the file (--env), never the name`);
  }
  return segments;
}

/** The mapping the keys live below, created on the way when `create`; null when it is absent and not created. */
function below(tree: Record<string, unknown>, target: SecretTarget, create: boolean): Record<string, unknown> | null {
  let node = tree;
  for (const name of target.under) {
    const next = node[name];
    if (next === undefined && create) node[name] = {};
    else if (!isMap(next) && next !== undefined) throw new SecretError(`SECRET_TARGET_SHAPE: ${name} of the sealed file of ${target.id} is not a mapping`);
    else if (next === undefined) return null;
    node = node[name] as Record<string, unknown>;
  }
  return node;
}

/** Every key path of the target a decrypted tree holds, names only. */
export function targetKeys(tree: unknown, target: SecretTarget): string[] {
  if (!isMap(tree)) return [];
  const root = below(tree, target, false);
  if (root === null) return [];
  const out: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string[]): void => {
    for (const [name, value] of Object.entries(node)) {
      if (prefix.length + 1 === target.depth) { if (typeof value === "string") out.push([...prefix, name].join("/")); } else if (isMap(value)) walk(value, [...prefix, name]);
    }
  };
  walk(root, []);
  return out.sort();
}

/** The YAML plaintext of a tree: every scalar is a JSON value (a double-quoted string kept byte for byte), every mapping name quoted. */
export function treeYaml(tree: Record<string, unknown>): string {
  const lines: string[] = [];
  const emit = (node: Record<string, unknown>, indent: string): void => {
    for (const [name, value] of Object.entries(node)) {
      if (isMap(value) && Object.keys(value).length > 0) { lines.push(`${indent}${JSON.stringify(name)}:`); emit(value, `${indent}  `); } else lines.push(`${indent}${JSON.stringify(name)}: ${JSON.stringify(value)}`);
    }
  };
  emit(tree, "");
  return `${lines.join("\n")}\n`;
}

/** The decrypted tree of an existing file (identity checked first), or an empty one for a file this write creates. */
function openTree(resolved: ResolvedTarget, sops: SecretSops): Record<string, unknown> {
  if (!fs.existsSync(resolved.file)) return {};
  sops.requireIdentity?.(resolved.file);
  if (sops.decryptTree === undefined) throw new SecretError("SECRET_TARGET_SOPS: this sops seam cannot open a nested file");
  const tree = sops.decryptTree(resolved.file);
  if (!isMap(tree)) throw new SecretError(`SECRET_TARGET_SHAPE: the sealed file of ${resolved.target.id} is not a mapping`);
  return tree;
}

function requireRecipients(resolved: ResolvedTarget): void {
  if (!fs.existsSync(resolved.root)) throw new SecretError(`SECRET_TARGET_ROOT: the checkout of ${resolved.target.id} is not at ${resolved.root}; clone it there (the project's ext/manifest.json declares the folder)`);
  if (!fs.existsSync(resolved.sopsFile)) throw new SecretError(`SECRET_TARGET_RECIPIENTS: ${resolved.sopsFile} is absent: the file of ${resolved.target.id} is sealed to the creation rule of that .sops.yaml`);
}

/** Seals `tree` to the file's recipients and publishes it (replaceSealed takes the writer claim). */
function seal(resolved: ResolvedTarget, tree: Record<string, unknown>, sops: SecretSops): void {
  const sealed = sops.seal({ inputType: "yaml", plaintext: treeYaml(tree), recipients: [], filenameOverride: resolved.file });
  if (!isSopsEnvelope(sealed)) throw new SecretError("sops returned an invalid sealed document");
  replaceSealed(resolved.file, sealed);
}

/** `set`: the values (already read from the prompt, stdin, a file or --generate) written into the target's file, in one seal. */
export function setTargetValues(resolved: ResolvedTarget, values: Record<string, string>, sops: SecretSops): string[] {
  requireRecipients(resolved);
  const keys = Object.keys(values);
  for (const key of keys) validateTargetKey(resolved.target, key);
  for (const value of Object.values(values)) if (typeof value !== "string" || value === "") throw new SecretError("secret values must be nonempty strings");
  const tree = openTree(resolved, sops);
  const root = below(tree, resolved.target, true) as Record<string, unknown>;
  for (const key of keys) {
    const segments = key.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const next = node[segment];
      if (next !== undefined && !isMap(next)) throw new SecretError(`SECRET_TARGET_SHAPE: ${segment} of ${key} holds a value, not a mapping`);
      node = (node[segment] ??= {}) as Record<string, unknown>;
    }
    node[segments.at(-1) as string] = values[key];
  }
  seal(resolved, tree, sops);
  return keys;
}

/** `unset`: one key out of the file; a dry run until `execute`. An account left with no key leaves with it. */
export function unsetTargetKey(resolved: ResolvedTarget, key: string, { execute, sops, stdout }: { execute: boolean; sops: () => SecretSops; stdout: (text: string) => unknown }): number {
  const segments = validateTargetKey(resolved.target, key);
  const label = `${path.basename(resolved.file)} of ${resolved.target.id}`;
  if (!fs.existsSync(resolved.file)) throw new SecretError(`SECRET_TARGET_FILE: ${label} does not exist`);
  const seam = sops();
  const tree = openTree(resolved, seam);
  const root = below(tree, resolved.target, false);
  const chain: Array<Record<string, unknown>> = [];
  let node = root;
  for (const segment of segments.slice(0, -1)) { if (node === null) break; chain.push(node); const next: unknown = node[segment]; node = isMap(next) ? next : null; }
  if (node === null || typeof node[segments.at(-1) as string] !== "string") throw new SecretError(`SECRET_TARGET_KEY: ${label} has no key ${key}`);
  if (!execute) { stdout(`dry run: would remove ${key} from ${label}; run again with --execute\n`); return 0; }
  delete node[segments.at(-1) as string];
  for (let at = segments.length - 2; at >= 0; at -= 1) {
    const parent = chain[at] as Record<string, unknown>;
    if (Object.keys(parent[segments[at] as string] as object).length === 0) delete parent[segments[at] as string]; else break;
  }
  if (Object.keys(tree).length === 0) throw new SecretError(`SECRET_TARGET_SHAPE: removing ${key} would leave ${label} with nothing to seal`);
  seal(resolved, tree, seam);
  stdout(`removed ${key} from ${label}\n`);
  return 0;
}

/** `list`: the key names of the file (names only, never a value); the file is opened in memory to read them. */
export function listTargetKeys(resolved: ResolvedTarget, sops: () => SecretSops, stdout: (text: string) => unknown): number {
  if (!fs.existsSync(resolved.file)) throw new SecretError(`SECRET_TARGET_FILE: ${path.basename(resolved.file)} of ${resolved.target.id} does not exist; set a key to create it`);
  for (const key of targetKeys(openTree(resolved, sops()), resolved.target)) stdout(`${key}\n`);
  return 0;
}

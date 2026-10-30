// secret-edit.mjs - app secret unset|rename|remove: edit the key set of one sealed member without ever printing a value.
// Each verb is a dry run until --execute. The dry run reads only the envelope's public key names and recipients, so it needs no
// age identity. An executed edit decrypts the member in memory, re-seals it to the SAME recipients in the SAME sops format
// (the one exception is a binary `data` envelope, which a rename re-seals as a JSON envelope), checks the sealed result and
// publishes it atomically under the writer claim. Output names environments, members and keys only.
import fs from "node:fs";
import { isSopsEnvelope } from "../lib/sops-envelope.mjs";
import {
  type SecretEnvelope,
  type SecretFormat,
  envelopeOf,
  plaintextOf,
  validateKey,
  validateMap,
} from "./secret-document.mjs";
import { deleteSealed, fileOf, replaceSealed } from "./secret-store.mjs";
import { SecretError } from "./secret-errors.mjs";
import type { SecretSops } from "./secret-sops.mjs";

const BINARY_PROPERTY = "data";
const NOT_PRESERVED = /\r|\\n/u;

const sameNames = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((name) => right.includes(name));

/** True for the sops binary store: a JSON envelope whose only property is `data` (the ssh key and known_hosts members). */
const isBinaryEnvelope = (envelope: SecretEnvelope): boolean =>
  envelope.format === "json" &&
  envelope.keys.length === 1 &&
  envelope.keys[0] === BINARY_PROPERTY;

function inspectMember(file: string, label: string): SecretEnvelope {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new SecretError(`${label} is not a sealed member of this environment`);
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new SecretError(`${label} must be an ordinary sealed file`);
  const text = fs.readFileSync(file, "utf8");
  if (!isSopsEnvelope(text))
    throw new SecretError(`${label} is not a sops envelope`);
  return envelopeOf(text);
}

function requireKey(envelope: SecretEnvelope, key: string, label: string): void {
  if (!envelope.keys.includes(key))
    throw new SecretError(`${label} has no KEY ${key}`);
}

/** Decrypt the member in memory and check that it holds exactly the keys its envelope declares. */
function openMap(
  file: string,
  envelope: SecretEnvelope,
  sops: SecretSops,
): Record<string, string> {
  const map = sops.decrypt(file, envelope.format);
  validateMap(map);
  if (!sameNames(Object.keys(map), envelope.keys))
    throw new SecretError("sops returned keys that differ from the envelope");
  if (
    envelope.format !== "dotenv" &&
    Object.values(map).some((value) => NOT_PRESERVED.test(value))
  )
    throw new SecretError(
      "a value holds a carriage return or literal backslash-n that this edit cannot preserve losslessly",
    );
  return map;
}

/** Seal the replacement map to the original recipients and prove the result before anything is published. */
function sealReplacement({
  file,
  format,
  map,
  envelope,
  sops,
}: {
  file: string;
  format: SecretFormat;
  map: Record<string, string>;
  envelope: SecretEnvelope;
  sops: SecretSops;
}): string {
  const sealed = sops.seal({
    inputType: format,
    plaintext: plaintextOf(format, map),
    recipients: envelope.recipients,
    filenameOverride: file,
  });
  let parsed: SecretEnvelope;
  try {
    parsed = envelopeOf(sealed);
  } catch {
    throw new SecretError("sops returned an invalid sealed document");
  }
  const recipientsKept =
    !envelope.recipients.length ||
    sameNames(parsed.recipients, envelope.recipients);
  if (
    !isSopsEnvelope(sealed) ||
    parsed.format !== format ||
    !sameNames(parsed.keys, Object.keys(map))
  )
    throw new SecretError("sops returned an invalid sealed document");
  if (!recipientsKept)
    throw new SecretError("sops returned a document sealed to different recipients");
  return sealed;
}

/** What every edit verb is handed: the member, its display label, whether to execute, the sops thunk and the output. */
interface EditContext {
  file: string;
  label: string;
  execute?: boolean | undefined;
  sops: () => SecretSops;
  stdout: (text: string) => unknown;
}

const keyCount = (count: number): string => `${count} key${count === 1 ? "" : "s"}`;

function unsetKey({
  file,
  label,
  key,
  execute,
  sops,
  stdout,
}: EditContext & { key: string }): number {
  const envelope = inspectMember(file, label);
  requireKey(envelope, key, label);
  if (envelope.keys.length === 1)
    throw new SecretError(
      `${key} is the last KEY of ${label}; a sealed member cannot be empty, use remove ${label.replace("/", " ")} --force-nonempty to delete it`,
    );
  const remaining = envelope.keys.length - 1;
  if (!execute) {
    stdout(`dry run: would unset ${key} from ${label} (${keyCount(remaining)} remain); add --execute\n`);
    return 0;
  }
  const seam = sops();
  const map = openMap(file, envelope, seam);
  delete map[key];
  replaceSealed(file, sealReplacement({ file, format: envelope.format, map, envelope, sops: seam }));
  stdout(`unset ${label} (${key}); ${keyCount(remaining)} remain\n`);
  return 0;
}

/** The replacement map and format of a rename: the key keeps its position and value; a binary envelope becomes a JSON one. */
function renamedMap({
  file,
  envelope,
  from,
  to,
  sops,
}: {
  file: string;
  envelope: SecretEnvelope;
  from: string;
  to: string;
  sops: SecretSops;
}): { format: SecretFormat; map: Record<string, string> } {
  if (isBinaryEnvelope(envelope)) {
    const value = sops.decryptBinary(file);
    if (typeof value !== "string" || value === "")
      throw new SecretError("the binary envelope holds no content");
    return { format: "json", map: { [to]: value } };
  }
  const map = openMap(file, envelope, sops);
  const entries = Object.entries(map).map(([name, value]): [string, string] => [name === from ? to : name, value]);
  return { format: envelope.format, map: Object.fromEntries(entries) };
}

function renameKey({
  file,
  label,
  key,
  to,
  execute,
  sops,
  stdout,
}: EditContext & { key: string; to: string }): number {
  const envelope = inspectMember(file, label);
  requireKey(envelope, key, label);
  if (key === to) throw new SecretError("the new KEY equals the old KEY");
  if (envelope.keys.includes(to))
    throw new SecretError(`${label} already has KEY ${to}`);
  const binary = isBinaryEnvelope(envelope);
  if (!execute) {
    const note = binary ? "; the binary envelope is re-sealed as a JSON envelope" : "";
    stdout(`dry run: would rename ${key} to ${to} in ${label}${note}; add --execute\n`);
    return 0;
  }
  const seam = sops();
  const { format, map } = renamedMap({ file, envelope, from: key, to, sops: seam });
  replaceSealed(file, sealReplacement({ file, format, map, envelope, sops: seam }));
  stdout(`renamed ${key} to ${to} in ${label}${binary ? " (re-sealed as a JSON envelope)" : ""}\n`);
  return 0;
}

function removeMember({
  file,
  label,
  execute,
  force,
  stdout,
}: EditContext & { force?: boolean | undefined }): number {
  const envelope = inspectMember(file, label);
  if (envelope.keys.length && !force)
    throw new SecretError(
      `${label} still holds ${keyCount(envelope.keys.length)} (${envelope.keys.join(", ")}); unset them first, or pass --force-nonempty to delete the whole member`,
    );
  if (!execute) {
    stdout(`dry run: would remove ${label}.enc (${keyCount(envelope.keys.length)}); add --execute\n`);
    return 0;
  }
  deleteSealed(file);
  stdout(`removed ${label}.enc (${keyCount(envelope.keys.length)})\n`);
  return 0;
}

/** Validate every name of an edit verb before anything touches the file system. */
export function validateEditNames(verb: string, names: string[]): void {
  for (const name of names) validateKey(name);
  if (verb === "remove" && names.length) throw new SecretError("remove takes no KEY");
}

/** unset, rename and remove; `sops` is a thunk so a dry run never needs the sops tool or an age identity. */
export function editSecret(
  verb: string,
  {
    directory,
    environment,
    slug,
    names,
    execute,
    force,
    sops,
    stdout,
  }: {
    directory: string;
    environment: string;
    slug: string;
    names: string[];
    execute?: boolean | undefined;
    force?: boolean | undefined;
    sops: () => SecretSops;
    stdout: (text: string) => unknown;
  },
): number {
  const file = fileOf(directory, slug);
  const common = { file, label: `${environment}/${slug}`, execute, sops, stdout };
  if (verb === "unset") return unsetKey({ ...common, key: names[0] as string });
  if (verb === "rename") return renameKey({ ...common, key: names[0] as string, to: names[1] as string });
  return removeMember({ ...common, force });
}

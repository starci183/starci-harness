// secret-output.mjs - list and materialize secret names and private KEY files.
import fs from "node:fs";
import path from "node:path";
import { byCodeUnit } from "../lib/list.mjs";
import { materializedDirectory, writeSecretFile } from "./secret-files.mjs";
import { envelopeOf, validateKey } from "./secret-document.mjs";
import { fileOf, readMap, sealedFiles } from "./secret-store.mjs";
import { memberOfName } from "../lib/sealed-member.mjs";
import { SecretError, publicStorage } from "./secret-errors.mjs";
import type { SecretSops } from "./secret-sops.mjs";

/** Where the values of a secret go: stdout for `reveal`, private KEY files (their paths on `fileOutput`) for `toFile`. */
export interface SecretOutput {
  repoRoot: string;
  environment: string;
  env?: NodeJS.ProcessEnv | undefined;
  platform?: NodeJS.Platform | undefined;
  stdout: (text: string) => unknown;
  fileOutput?: ((text: string) => unknown) | undefined;
  reveal?: boolean | undefined;
  toFile?: boolean | undefined;
}

function validateWindowsKeys(map: Record<string, string>): void {
  const names = new Set();
  for (const key of Object.keys(map)) {
    const normalized = key.toUpperCase();
    if (names.has(normalized))
      throw new SecretError(
        "KEY names differing only by case cannot be materialized on Windows",
      );
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(normalized))
      throw new SecretError(
        "a KEY uses a reserved Windows file name and cannot be materialized",
      );
    names.add(normalized);
  }
}

function exportValues(
  map: Record<string, string>,
  {
    repoRoot,
    environment,
    env,
    platform,
    stdout,
    fileOutput = stdout,
    reveal = false,
    toFile = true,
  }: SecretOutput,
): number {
  if (toFile && platform === "win32") validateWindowsKeys(map);
  const directory = toFile
    ? publicStorage(() =>
        materializedDirectory(repoRoot, environment, env, platform),
      )
    : null;
  for (const key of Object.keys(map).sort(byCodeUnit)) {
    if (toFile) {
      const file = publicStorage(() =>
        writeSecretFile(directory as string, key, map[key] as string),
      );
      fileOutput(`${key}_FILE=${file}\n`);
    }
    if (reveal) stdout(`${key}=${map[key]}\n`);
  }
  return 0;
}

export function listSecrets(
  directory: string,
  stdout: (text: string) => unknown,
): number {
  const keys = new Set<string>();
  for (const name of sealedFiles(directory)) {
    for (const item of envelopeOf(
      fs.readFileSync(path.join(directory, name), "utf8"),
    ).keys) {
      validateKey(item);
      keys.add(item);
    }
  }
  for (const item of [...keys].sort(byCodeUnit)) stdout(`${item}\n`);
  return 0;
}

export function materializeSecrets(
  directory: string,
  sops: SecretSops,
  output: SecretOutput,
): number {
  const map: Record<string, string> = Object.create(null);
  for (const name of sealedFiles(directory)) {
    for (const [item, value] of Object.entries(
      readMap(fileOf(directory, memberOfName(name)), sops),
    )) {
      if (Object.hasOwn(map, item))
        throw new SecretError(
          `duplicate KEY ${item} across secret slugs; each materialized KEY needs one owner`,
        );
      map[item] = value;
    }
  }
  return exportValues(map, output);
}

export function getSecret(
  file: string,
  key: string | undefined,
  sops: SecretSops,
  opts: { reveal?: boolean | undefined; "to-file"?: unknown },
  output: SecretOutput,
  stderr: (text: string) => unknown,
): number {
  let map = readMap(file, sops);
  if (key !== undefined) {
    if (!Object.hasOwn(map, key))
      throw new SecretError(`the secret has no KEY ${key}`);
    map = { [key]: map[key] as string };
  }
  return exportValues(map, {
    ...output,
    fileOutput: stderr,
    reveal: opts.reveal,
    toFile: opts["to-file"] === true,
  });
}

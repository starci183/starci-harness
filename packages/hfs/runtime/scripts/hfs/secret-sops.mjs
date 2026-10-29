// secret-sops.mjs - runtime SOPS adapter and age identity selection.
import fs from "node:fs";
import path from "node:path";
import { runProgram } from "../api/process/run-program.mjs";
import { resolveRealTool } from "../api/process/resolve-real-tool.mjs";
import { decrypt as sopsDecrypt } from "../api/sops/decrypt.mjs";
import { seal as sopsSeal } from "../api/sops/seal.mjs";
import { updateKeys as sopsUpdateKeys } from "../api/sops/update-keys.mjs";
import { isLegacyName } from "../lib/sealed-member.mjs";
import { invocationDir } from "../lib/roots.mjs";
import { envelopeOf } from "./secret-document.mjs";
import { configuredRecipients, localAgeIdentity, secretTools } from "./secret-init.mjs";
import { outsideRepository, secretRoots } from "./secret-files.mjs";
import { SecretError, publicStorage } from "./secret-errors.mjs";

const sopsInvocation = Object.freeze({ runProgram, resolveRealTool });
const AGE_IDENTITY_NAME = /^SOPS_AGE_KEY(?:_FILE)?$/i;

/** The environment with no age identity selected: what a seal runs with. */
const withoutIdentity = (env) =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !AGE_IDENTITY_NAME.test(name)));

/** The KEY map of sops' JSON output: a flat object of string values, else refused naming no value. */
function exactMap(stdout) {
  let document;
  try { document = JSON.parse(String(stdout)); }
  catch { throw new SecretError("sops returned an invalid JSON document"); }
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new SecretError("sops returned an invalid JSON document");
  const map = Object.create(null);
  for (const [key, value] of Object.entries(document)) {
    if (typeof value !== "string") throw new SecretError(`${key} is not a string value; a member holds string values only`);
    map[key] = value;
  }
  return map;
}

/** The public age recipients a sealed member names, read without decrypting; none when it cannot be read. */
function recipientsOf(file) {
  try { return envelopeOf(fs.readFileSync(file, "utf8")).recipients; }
  catch { return []; }
}

/**
 * The refusal of a decrypt whose selected identity is not one `file` is sealed to: names where the identity came from and the
 * member's recipients, and the two ways out. It carries no value.
 */
function identityMismatch(repoRoot, identity, file) {
  const recipients = recipientsOf(file);
  return new SecretError(
    `the age identity of ${identity.source ?? "the environment"} does not open ${path.basename(file)}, ` +
      `sealed to ${recipients.join(", ") || "another recipient"}. Fix: put that recipient's age secret key in ${path.join(repoRoot, ".claude", "secret.env")} as SOPS_AGE_KEY, ` +
      "or, when no one holds it any more, seal the member's keys again (remove it and set them) after .sops.yaml names this identity's recipient",
  );
}

/**
 * The refusal of an operation that must decrypt `file` with no age identity selected: it names the recipient the member is
 * sealed to, every place looked, and the one line that fixes it. It carries no value.
 */
function identityMissing(repoRoot, identity, file) {
  const recipients = recipientsOf(file);
  const sealedTo = recipients.length ? `, sealed to ${recipients.join(", ")}` : "";
  const places = ["the environment (SOPS_AGE_KEY, SOPS_AGE_KEY_FILE)", ...identity.looked].join(", ");
  return new SecretError(
    `no age identity opens ${path.basename(file)}${sealedTo}; looked in ${places}. ` +
      `Fix: add the line SOPS_AGE_KEY=<the age secret key of that recipient> to ${path.join(repoRoot, ".claude", "secret.env")} (git-ignored), ` +
      "or set SOPS_AGE_KEY_FILE to the absolute path of its key file",
  );
}

/**
 * The default sops seam: the runtime's sops api, which finds the binary on this machine; the age identity is localAgeIdentity's
 * (`host` its last source), then the legacy sops keys.txt. `identity` says where the age identity
 * was found (`source`, null when nowhere) and where it was looked for; `requireIdentity(file)` refuses, before any value is
 * read, an operation that must decrypt `file` with no identity.
 */
export function defaultSops(
  env = process.env,
  repoRoot = invocationDir(),
  platform = process.platform,
  tools = undefined,
  host = null,
) {
  const { sops: binary } = publicStorage(() => secretTools(env, tools));
  const local = localAgeIdentity(repoRoot, env, tools, host);
  const selectedEnv = local.env;
  const identity = { source: local.source, looked: [...local.looked] };
  const invocation = {
    runProgram: tools?.runProgram ?? sopsInvocation.runProgram,
    resolveRealTool: tools?.resolveRealTool ?? sopsInvocation.resolveRealTool,
  };
  const checkIdentity = (file) =>
    publicStorage(() => {
      outsideRepository(repoRoot, file);
      if (fs.existsSync(file)) {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw new Error(
            "the age identity must be an ordinary private file without hard links",
          );
      }
    });
  for (const [name, value] of Object.entries(selectedEnv))
    if (/^SOPS_AGE_KEY_FILE$/i.test(name) && value) {
      if (!path.isAbsolute(value))
        throw new SecretError(
          "SOPS_AGE_KEY_FILE must be an absolute path outside the repository",
        );
      checkIdentity(value);
    }
  if (
    !Object.keys(selectedEnv).some((name) => AGE_IDENTITY_NAME.test(name))
  ) {
    const keys = secretRoots(env, platform).identity;
    checkIdentity(keys);
    identity.looked.push(keys);
    if (fs.existsSync(keys)) {
      selectedEnv.SOPS_AGE_KEY_FILE = keys;
      identity.source = keys;
    }
  }
  const requireIdentity = (file) => {
    if (identity.source === null) throw identityMissing(repoRoot, identity, file);
  };
  const refuse = (what, result, file) => {
    if (result.error?.identityRefusal === "identity-not-supplied" && file)
      return identityMissing(repoRoot, identity, file);
    if (result.error?.identityRefusal === "recipient-mismatch" && file)
      return identityMismatch(repoRoot, identity, file);
    if (result.error?.identityRefusal)
      return Object.assign(new SecretError(result.error.message), {
        identityRefusal: result.error.identityRefusal,
      });
    if (result.error?.code === "SOPS_MISSING")
      return new SecretError(result.error.message);
    return new SecretError(
      `sops could not ${what} (exit ${String(result.status)})`,
    );
  };
  return {
    identity,
    requireIdentity,
    /**
     * The KEY map of a member. A YAML or JSON member decrypts to JSON, so every value comes back byte for byte (a multi-line
     * key, a trailing newline, a carriage return); a legacy dotenv member decrypts to dotenv, whose LF is escaped.
     */
    decrypt(file, format) {
      const exact = format === "yaml" || format === "json";
      const result = sopsDecrypt(
        binary,
        ["decrypt", "--input-type", format, "--output-type", exact ? "json" : "dotenv", file],
        { env: selectedEnv, cwd: repoRoot, invocation },
      );
      if (result.status !== 0)
        throw refuse(
          `decrypt ${path.basename(file)}; is the age identity installed?`,
          result,
          file,
        );
      if (exact) return exactMap(result.stdout);
      const map = Object.create(null);
      for (const line of String(result.stdout).split(/\r?\n/u)) {
        if (!line || line.startsWith("#")) continue;
        const match = /^([A-Za-z_]\w*)=(.*)$/u.exec(line);
        if (!match || Object.hasOwn(map, match[1]))
          throw new SecretError("sops returned an invalid dotenv document");
        map[match[1]] = match[2].replaceAll(String.raw`\n`, "\n");
      }
      return map;
    },
    /**
     * The ssh key and known_hosts of the deploy custody. A classic sops BINARY envelope (one `data` property) yields the file itself;
     * a JSON envelope under another property name (privateKey, knownHosts, ciPrivateKey) yields the JSON text of its properties,
     * which the stack remote code unwraps by name.
     */
    decryptBinary(file) {
      const envelope = envelopeOf(fs.readFileSync(file, "utf8"));
      const classic =
        envelope.format === "json" &&
        envelope.keys.length === 1 &&
        envelope.keys[0] === "data";
      const types = classic
        ? ["binary", "binary"]
        : [envelope.format, "json"];
      const result = sopsDecrypt(
        binary,
        ["decrypt", "--input-type", types[0], "--output-type", types[1], file],
        { env: selectedEnv, cwd: repoRoot, invocation },
      );
      if (result.status !== 0)
        throw refuse(
          `decrypt ${path.basename(file)}; is the age identity installed?`,
          result,
          file,
        );
      return String(result.stdout);
    },
    /**
     * Wraps member `file` again to the recipients its environment's rule of the app's .sops.yaml names (sops updatekeys): the
     * selected identity opens the data key only, no value is decrypted, nothing is printed.
     */
    updateKeys(file) {
      const result = sopsUpdateKeys(
        binary,
        { file: path.resolve(file), config: path.join(path.resolve(repoRoot), ".sops.yaml"), inputType: isLegacyName(file) ? "dotenv" : "yaml" },
        { env: selectedEnv, cwd: repoRoot, invocation },
      );
      if (result.status !== 0)
        throw refuse(`update the keys of ${path.basename(file)}; is the age identity a recipient of it?`, result, file);
    },
    seal(request) {
      const recipients = request.recipients.length
        ? request.recipients
        : publicStorage(() =>
            configuredRecipients(repoRoot, request.filenameOverride),
          );
      // Sealing needs only public recipients, so it runs with no identity selected and may name several (an environment's
      // server key and the owner key both).
      const result = sopsSeal(
        binary,
        { ...request, recipients },
        { env: withoutIdentity(selectedEnv), cwd: repoRoot, invocation },
      );
      if (result.status !== 0) throw refuse("seal the secret", result);
      return result.stdout;
    },
  };
}

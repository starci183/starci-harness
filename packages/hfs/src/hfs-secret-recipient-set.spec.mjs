// A member sealed to an environment's whole recipient set (the owner key and the deploy server's key, the production standard),
// opened through the one age identity lookup (decryptionIdentity) with the real sops and age: test keys generated in the spec's
// temp dir (removed with it), the identity handed in as the harness CLI's secret.env (`hostIdentity`), never exported. Either key
// alone opens the member, `set` keeps both recipients, the deploy's sealed SSH members open through the same identity, and an
// identity outside the set is refused naming the member, its format, its recipients and the identity's source and recipient.
// Skipped where sops or age-keygen is not installed. Every value here is a fake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "./helpers/hfs-secret-fixture.mjs";
import { secretMain } from "../runtime/scripts/hfs/secret.mjs";
import { defaultSops } from "../runtime/scripts/hfs/secret-sops.mjs";
import { envelopeOf } from "../runtime/scripts/hfs/secret-document.mjs";
import { resolveSops } from "../runtime/scripts/api/sops/lib.mjs";
import { resolveRealTool } from "../runtime/scripts/api/process/resolve-real-tool.mjs";
import { stackContext } from "../stack/context.mjs";
import { loadDeployConfig } from "../stack/config.mjs";
import { SEALED_SSH_KEYS, openSealedSession } from "../stack/remote.mjs";
import { selectedAgeEnvelope } from "../runtime/scripts/lib/sops-envelope.mjs";

const sops = resolveSops(process.env);
const keygen = resolveRealTool("age-keygen", { env: process.env });
const skip = !sops || !keygen ? "sops or age-keygen is not installed" : false;
const VALUE = "fake-value-sealed-to-two-recipients";
const ADDED = "fake-value-added-by-a-later-set";
// A fake PEM body, assembled so the tree holds no private key header literal.
const PEM = [["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" "), "ZmFrZS1rZXk=", ["-----END", "OPENSSH", "PRIVATE", "KEY-----"].join(" ")].join("\n");
const KNOWN = "203.0.113.7 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFake";

/** A test identity made with age-keygen in `dir`: its public recipient and secret key, and the host port that reads it. */
function testKey(dir, name) {
  const file = path.join(dir, `${name}.txt`);
  assert.equal(spawnSync(keygen, ["-o", file], { stdio: "ignore" }).status, 0);
  const recipient = spawnSync(keygen, ["-y", file], { encoding: "utf8" }).stdout.trim();
  const secret = fs.readFileSync(file, "utf8").split(/\r?\n/u).find((line) => line.startsWith("AGE-SECRET-KEY-"));
  return { recipient, secret, host: { label: `/harness/${name}/secret.env`, read: () => secret } };
}

/** A production app whose rule names `recipients`, with an empty .claude so no app secret.env selects an identity. */
async function productionApp(t, recipients) {
  const fixture = app(t, {}, "production");
  const keys = path.join(path.dirname(fixture.root), "test-keys");
  fs.mkdirSync(keys);
  const made = Object.fromEntries(["owner", "server", "stranger"].map((name) => [name, testKey(keys, name)]));
  const quiet = { cwd: fixture.root, env: fixture.env, stdout: () => {}, stderr: () => {} };
  for (const name of recipients) assert.equal(await secretMain(["recipients", "--env", "production", "--add", made[name].recipient, "--execute"], quiet), 0);
  return { ...fixture, keys: made, quiet };
}

const recipientsOf = (file) => envelopeOf(fs.readFileSync(file, "utf8")).recipients.sort();

test("a member sealed to the owner and server keys opens with either alone, and set keeps both recipients", { skip }, async (t) => {
  const fixture = await productionApp(t, ["owner", "server"]);
  const { owner, server } = fixture.keys;
  const file = path.join(fixture.dir, "app.enc.yaml");
  assert.equal(await secretMain(["set", "--env", "production", "app", "API_KEY"], { ...fixture.quiet, stdin: () => VALUE }), 0);
  assert.deepEqual(recipientsOf(file), [owner.recipient, server.recipient].sort());

  for (const key of [owner, server]) {
    const seam = defaultSops(fixture.env, fixture.root, process.platform, undefined, key.host);
    assert.equal(seam.identity.source, `${key.host.label} (SOPS_AGE_KEY)`);
    assert.equal(seam.decrypt(file, "yaml").API_KEY === VALUE, true, "the member opens with this key alone");
  }

  const err = [];
  const added = await secretMain(["set", "--env", "production", "app", "ADDED_KEY"], { ...fixture.quiet, stderr: (text) => err.push(text), stdin: () => ADDED, hostIdentity: owner.host });
  assert.equal(added, 0, err.join(""));
  assert.deepEqual(recipientsOf(file), [owner.recipient, server.recipient].sort(), "set kept the server recipient");
  const map = defaultSops(fixture.env, fixture.root, process.platform, undefined, server.host).decrypt(file, "yaml");
  assert.deepEqual(Object.keys(map).sort(), ["ADDED_KEY", "API_KEY"]);
  assert.equal(map.ADDED_KEY === ADDED && map.API_KEY === VALUE, true, "the server key opens the re-sealed member");
});

test("a rewrite with no rule for the member keeps the member's own recipient set", { skip }, async (t) => {
  const fixture = await productionApp(t, ["owner", "server"]);
  const { owner, server } = fixture.keys;
  const file = path.join(fixture.dir, "app.enc.yaml");
  assert.equal(await secretMain(["set", "--env", "production", "app", "API_KEY"], { ...fixture.quiet, stdin: () => VALUE }), 0);
  fs.writeFileSync(path.join(fixture.root, ".sops.yaml"), `creation_rules:\n  - path_regex: \\.starcistacks[/\\\\]dev[/\\\\]secrets[/\\\\][^/\\\\]+\\.enc(?:\\.yaml)?$\n    age: ${owner.recipient}\n`);
  const err = [];
  const code = await secretMain(["set", "--env", "production", "app", "ADDED_KEY"], { ...fixture.quiet, stderr: (text) => err.push(text), stdin: () => ADDED, hostIdentity: owner.host });
  assert.equal(code, 0, err.join(""));
  assert.deepEqual(recipientsOf(file), [owner.recipient, server.recipient].sort());
});

test("an identity outside the member's set is refused naming the member, its format, its recipients and the identity", { skip }, async (t) => {
  const fixture = await productionApp(t, ["owner", "server"]);
  const { owner, server, stranger } = fixture.keys;
  assert.equal(await secretMain(["set", "--env", "production", "app", "API_KEY"], { ...fixture.quiet, stdin: () => VALUE }), 0);
  const seam = defaultSops(fixture.env, fixture.root, process.platform, undefined, stranger.host);
  assert.throws(() => seam.decrypt(path.join(fixture.dir, "app.enc.yaml"), "yaml"), (error) => {
    for (const fact of ["app.enc.yaml", owner.recipient, server.recipient, stranger.recipient, stranger.host.label]) assert.ok(error.message.includes(fact), `${fact} in: ${error.message}`);
    assert.doesNotMatch(error.message, /AGE-SECRET-KEY|not qualified/u);
    return true;
  });
});

/** A production deploy whose owner-machine transport opens its one sealed SSH member `vps` (VPS_HOST, VPS_USER, privateKey, knownHosts). */
async function sealedRemoteApp(t) {
  const fixture = await productionApp(t, ["owner", "server"]);
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), [
    "environments:", "  production:", "    runtime: docker-swarm", "    composeFiles: [stack.yml]", "    deploy:", "      remote:",
    "        sealed: vps", "",
  ].join("\n"));
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "production", "stack.yml"), "services:\n  api:\n    image: x\n");
  // Adding a key to the existing member opens it, so the later writes carry the owner's identity.
  const set = async (member, keys, value, more = {}) => { const err = []; assert.equal(await secretMain(["set", "--env", "production", member, ...keys], { ...fixture.quiet, ...more, stderr: (text) => err.push(text), stdin: () => value }), 0, err.join("")); };
  await set("vps", ["VPS_HOST", "VPS_USER"], "VPS_HOST=203.0.113.7\nVPS_USER=deploy\n");
  await set("vps", [SEALED_SSH_KEYS.sshKey], PEM, { hostIdentity: fixture.keys.owner.host });
  await set("vps", [SEALED_SSH_KEYS.knownHosts], KNOWN, { hostIdentity: fixture.keys.owner.host });
  return fixture;
}

test("the deploy's sealed SSH members open through the harness identity alone", { skip }, async (t) => {
  const fixture = await sealedRemoteApp(t);
  const ctx = stackContext({ cwd: fixture.root, env: fixture.env, platform: "linux", hostIdentity: fixture.keys.owner.host, stdout: () => {}, stderr: () => {} });
  const session = openSealedSession(ctx, loadDeployConfig({ repoRoot: fixture.root, env: "production" }));
  try {
    assert.equal(session.account, "deploy@203.0.113.7");
    assert.equal(session.strict, "yes");
    assert.equal(fs.readFileSync(session.keyFile, "utf8") === `${PEM}\n`, true, "the private key reaches the session file");
    assert.equal(fs.readFileSync(session.knownFile, "utf8") === `${KNOWN}\n`, true);
  } finally {
    session.cleanup();
  }
  assert.equal(fs.existsSync(session.dir), false);
});

test("a sealed SSH member the host's identity cannot open is refused naming the member, its recipients and the identity tried", { skip }, async (t) => {
  const fixture = await sealedRemoteApp(t);
  const { owner, server, stranger } = fixture.keys;
  const ctx = stackContext({ cwd: fixture.root, env: fixture.env, platform: "linux", hostIdentity: stranger.host, stdout: () => {}, stderr: () => {} });
  assert.throws(() => openSealedSession(ctx, loadDeployConfig({ repoRoot: fixture.root, env: "production" })), (error) => {
    assert.match(error.message, /^STACK_REMOTE_SEALED: cannot open the sealed member vps: /u);
    for (const fact of ["vps.enc.yaml", owner.recipient, server.recipient, stranger.recipient, stranger.host.label]) assert.ok(error.message.includes(fact), `${fact} in: ${error.message}`);
    return true;
  });
});

const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const AGE_BLOCK = "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n";
const A = `age1${"q".repeat(58)}`;
const B = `age1${"p".repeat(58)}`;
const yamlMember = (recipients) => [`API_KEY: ${ENC}`, "sops:", "  age:",
  ...recipients.flatMap((recipient) => [`    - recipient: ${recipient}`, "      enc: |", ...AGE_BLOCK.trimEnd().split("\n").map((line) => `        ${line}`)]),
  "  lastmodified: \"2026-10-29T10:15:02Z\"", `  mac: ${ENC}`, "  version: 3.13.2", ""].join("\n");
const dotenvMember = (entries) => [`API_KEY=${ENC}`,
  ...entries.flatMap(([index, recipient]) => [`sops_age__list_${index}__map_enc=${AGE_BLOCK.replaceAll("\n", String.raw`\n`)}`, `sops_age__list_${index}__map_recipient=${recipient}`]),
  "sops_lastmodified=2026-10-29T10:15:02Z", `sops_mac=${ENC}`, "sops_version=3.13.2", ""].join("\n");

test("the selected decrypt admits an age set that holds the selected recipient, and refuses a duplicate, a gap or a stranger", () => {
  assert.deepEqual(selectedAgeEnvelope(yamlMember([A, B]), "yaml", A), { ok: true });
  assert.deepEqual(selectedAgeEnvelope(yamlMember([A, B]), "yaml", B), { ok: true });
  assert.deepEqual(selectedAgeEnvelope(yamlMember([A]), "yaml", A), { ok: true });
  assert.deepEqual(selectedAgeEnvelope(yamlMember([A, A]), "yaml", A), { ok: false, reason: "duplicate-age-recipient" });
  assert.deepEqual(selectedAgeEnvelope(yamlMember([A, B]), "yaml", `age1${"z".repeat(58)}`), { ok: false, reason: "recipient-mismatch" });
  assert.deepEqual(selectedAgeEnvelope(dotenvMember([[0, A], [1, B]]), "dotenv", B), { ok: true });
  assert.deepEqual(selectedAgeEnvelope(dotenvMember([[0, A], [2, B]]), "dotenv", A), { ok: false, reason: "invalid-age-entry" });
  assert.deepEqual(selectedAgeEnvelope(dotenvMember([[0, A], [1, A]]), "dotenv", A), { ok: false, reason: "duplicate-age-recipient" });
});

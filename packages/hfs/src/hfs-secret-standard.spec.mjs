// The app secrets standard (ruling app-secrets-one-standard): a member is `<provider>.enc.yaml`, sops YAML whose values keep
// every byte; --from-file reads a key byte for byte; recipients manages one .sops.yaml rule per environment; audit names every
// deviation; migrate and split move members without printing a value. Every value here is a fake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app, run, privateAbsent } from "./helpers/hfs-secret-fixture.mjs";
import { parseYaml } from "../runtime/engine/yaml.mjs";
import { envelopeOf } from "../runtime/scripts/hfs/secret-document.mjs";
import { memberFile } from "../runtime/scripts/lib/sealed-member.mjs";

const OWNER = `age1${"q".repeat(58)}`;
const SERVER = `age1${"s".repeat(58)}`;
const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const PEM = "-----BEGIN FAKE KEY-----\nAAAA\r\n-----END FAKE KEY-----\n";
const FAKE = ["fake-merchant-1", "fake-ipn-2", "fake-signing-3"];

/** A sops YAML envelope naming `keys`, sealed to `recipients`. */
const sealedYaml = (keys, recipients = [OWNER]) =>
  `${keys.map((key) => `${key}: ${ENC}`).join("\n")}\nsops:\n  age:\n${recipients.map((recipient) => `    - recipient: ${recipient}\n      enc: |\n        -----BEGIN AGE ENCRYPTED FILE-----\n        YWdl\n        -----END AGE ENCRYPTED FILE-----\n`).join("")}  lastmodified: "2026-10-29T00:00:00Z"\n  mac: ${ENC}\n  version: 3.13.2\n`;

/** A legacy sops dotenv envelope naming `keys`. */
const sealedDotenv = (keys) =>
  `${keys.map((key) => `${key}=${ENC}`).join("\n")}\nsops_age__list_0__map_recipient=${OWNER}\nsops_age__list_0__map_enc=-----BEGIN AGE ENCRYPTED FILE-----\\nYWdl\\n-----END AGE ENCRYPTED FILE-----\nsops_mac=${ENC}\nsops_version=3.13.2\n`;

/** The keys of a YAML plaintext the fake seal received, parsed as sops would read it. */
const plainMap = (plaintext) => parseYaml(plaintext);

/** A sops seam double: records each seal (format, the parsed plaintext, recipients, file) and decrypts to `stored`. */
const fakeSops = (seals, stored = {}) => ({
  decrypt: () => ({ ...stored }),
  seal: (request) => {
    const map = request.inputType === "yaml" ? plainMap(request.plaintext) : Object.fromEntries(request.plaintext.split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    seals.push({ format: request.inputType, map, recipients: request.recipients, file: path.basename(request.filenameOverride) });
    return request.inputType === "yaml" ? sealedYaml(Object.keys(map)) : sealedDotenv(Object.keys(map));
  },
});

const sopsConfig = (root, rules) =>
  fs.writeFileSync(path.join(root, ".sops.yaml"), `creation_rules:\n${rules.map(([regex, age]) => `  - path_regex: '${regex}'\n    age: ${age}\n`).join("")}`);
const APP_WIDE = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;

test("set creates <member>.enc.yaml as sops YAML whose values keep every byte, and --from-file reads a key byte for byte", async (t) => {
  const { root, dir, env } = app(t);
  const pem = path.join(root, "..", "fake.pem");
  fs.writeFileSync(pem, PEM);
  const seals = [];
  const result = await run(["set", "--env", "dev", "sepay", "SEPAY_MERCHANT_ID", "SEPAY_SIGNING_KEY", "--from-file", `SEPAY_SIGNING_KEY=${pem}`], {
    cwd: root, env, stdin: () => FAKE[0], sops: fakeSops(seals),
  });
  assert.equal(result.code, 0, result.err);
  assert.equal(seals.length, 1);
  assert.equal(seals[0].format, "yaml");
  assert.equal(seals[0].file, "sepay.enc.yaml");
  assert.deepEqual(seals[0].map, { SEPAY_MERCHANT_ID: FAKE[0], SEPAY_SIGNING_KEY: PEM }, "a multi-line value with CR and its trailing newline round-trips");
  assert.ok(fs.existsSync(path.join(dir, "sepay.enc.yaml")));
  privateAbsent(result, [FAKE[0], PEM]);
});

test("--from-file names a key of this set once, and an empty file seals nothing", async (t) => {
  const { root, dir, env } = app(t);
  const empty = path.join(root, "..", "empty.txt");
  fs.writeFileSync(empty, "");
  const other = await run(["set", "--env", "dev", "sepay", "K1", "--from-file", `K2=${empty}`], { cwd: root, env, stdin: () => "x", sops: fakeSops([]) });
  assert.match(other.err, /--from-file names K2, which this set does not/u);
  const blank = await run(["set", "--env", "dev", "sepay", "K1", "--from-file", `K1=${empty}`], { cwd: root, env, sops: fakeSops([]) });
  assert.match(blank.err, /the file is empty; nothing was sealed/u);
  assert.equal(fs.existsSync(path.join(dir, "sepay.enc.yaml")), false);
});

test("a legacy dotenv member stays dotenv to its own recipients until migrate moves it", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["SEPAY_MERCHANT_ID"]));
  const seals = [];
  const result = await run(["set", "--env", "dev", "sepay", "SEPAY_IPN_SECRET_KEY"], { cwd: root, env, stdin: () => FAKE[1], sops: fakeSops(seals, { SEPAY_MERCHANT_ID: FAKE[0] }) });
  assert.equal(result.code, 0, result.err);
  assert.equal(seals[0].format, "dotenv");
  assert.equal(seals[0].file, "sepay.enc");
  assert.deepEqual(seals[0].recipients, [OWNER]);
  assert.equal(memberFile(dir, "sepay"), path.join(dir, "sepay.enc"));
});

test("recipients writes one rule per environment before the app-wide rule, public keys only, and refuses an emptied rule", async (t) => {
  const { root, env } = app(t);
  sopsConfig(root, [[APP_WIDE, OWNER]]);
  const shown = await run(["recipients", "--env", "production"], { cwd: root, env });
  assert.equal(shown.out, `production: ${OWNER}\n`, "an existing app-wide rule written for .enc matches an .enc.yaml member");
  const dry = await run(["recipients", "--env", "production", "--add", SERVER], { cwd: root, env });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^dry run: would set the production recipients of \.sops\.yaml to .*; add --execute\n$/u);
  assert.equal(parseYaml(fs.readFileSync(path.join(root, ".sops.yaml"), "utf8")).creation_rules.length, 1, "the dry run leaves .sops.yaml as it was");
  const added = await run(["recipients", "--env", "production", "--add", SERVER, "--execute"], { cwd: root, env });
  assert.equal(added.code, 0, added.err);
  const rules = parseYaml(fs.readFileSync(path.join(root, ".sops.yaml"), "utf8")).creation_rules;
  assert.equal(rules.length, 2);
  assert.match(rules[0].path_regex, /production/u);
  assert.equal(rules[0].age, `${OWNER},${SERVER}`);
  assert.equal(rules[1].age, OWNER, "the app-wide rule keeps covering dev");
  assert.equal((await run(["recipients", "--env", "dev"], { cwd: root, env })).out, `dev: ${OWNER}\n`);
  const bad = await run(["recipients", "--env", "production", "--add", "not-a-key"], { cwd: root, env });
  assert.match(bad.err, /not a public age recipient/u);
  const emptied = await run(["recipients", "--env", "dev", "--remove", OWNER], { cwd: root, env });
  assert.match(emptied.err, /dev keeps at least one recipient/u);
});

test("a member is sealed to its environment's rule, so a set after a recipients change follows it", async (t) => {
  const { root, dir, env } = app(t);
  sopsConfig(root, [[APP_WIDE, OWNER]]);
  await run(["recipients", "--env", "production", "--add", SERVER, "--execute"], { cwd: root, env });
  fs.mkdirSync(path.join(root, ".starcistacks", "production", "secrets"), { recursive: true });
  const seals = [];
  const result = await run(["set", "--env", "production", "api", "OPENROUTER_API_KEY"], { cwd: root, env, stdin: () => FAKE[2], sops: fakeSops(seals) });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(seals[0].recipients, [], "no recipients are pinned: the seam reads the environment's rule for the file");
  assert.ok(dir);
});

test("audit names legacy members, mixed providers, recipient drift and undeclared keys, names only", async (t) => {
  const { root, dir, env } = app(t);
  sopsConfig(root, [[APP_WIDE, OWNER]]);
  fs.writeFileSync(path.join(root, ".starcistacks", "application-stacks.yaml"),
    "schema: starci/application-stacks@1\nenvironments:\n  dev:\n    secrets:\n      - {name: sepay-merchant-id, member: sepay, key: SEPAY_MERCHANT_ID, where: secrets/sepay, recipientPolicy: rule, keyCustody: harness}\n");
  fs.writeFileSync(path.join(dir, "sepay.enc.yaml"), sealedYaml(["SEPAY_MERCHANT_ID", "SEPAY_IPN_SECRET_KEY"]));
  fs.writeFileSync(path.join(dir, "ai.enc"), sealedDotenv(["OPENROUTER_API_KEY"]));
  fs.writeFileSync(path.join(dir, "ops.enc.yaml"), sealedYaml(["VPS_HOST", "SUPABASE_TOKEN"], [SERVER]));
  const result = await run(["audit", "--env", "dev"], { cwd: root, env });
  assert.equal(result.code, 1);
  const codes = result.out.trim().split("\n").map((line) => line.split(":")[0]);
  assert.ok(codes.includes("LEGACY_MEMBER dev/ai.enc"), result.out);
  assert.ok(codes.includes("MIXED_PROVIDERS dev/ops.enc.yaml"), result.out);
  assert.ok(codes.includes("RECIPIENT_DRIFT dev/ops.enc.yaml"), result.out);
  assert.ok(result.out.includes("UNDECLARED_KEY dev/sepay.enc.yaml: holds SEPAY_IPN_SECRET_KEY"), result.out);
  assert.ok(!result.out.includes("SEPAY_MERCHANT_ID,"), "a declared key is not named undeclared");
});

test("the sealed VPS member and a member whose entry lists its keys are groups, not mixed providers; an unlisted key still is", async (t) => {
  const { root, dir, env } = app(t);
  sopsConfig(root, [[APP_WIDE, OWNER]]);
  fs.writeFileSync(path.join(root, ".starcistacks", "application-stacks.yaml"), [
    "schema: starci/application-stacks@1", "environments:", "  dev:", "    deploy:", "      remote: {sealed: vps}", "    secrets:",
    "      - {name: ai, where: secrets/ai, keys: [AI_ROUTER_TOKEN, OPENROUTER_API_KEY], recipientPolicy: rule, keyCustody: harness}",
    "      - {name: mail, where: secrets/mail, keys: [MAIL_FROM], recipientPolicy: rule, keyCustody: harness}", "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "vps.enc.yaml"), sealedYaml(["VPS_HOST", "VPS_USER", "privateKey", "knownHosts"]));
  fs.writeFileSync(path.join(dir, "ai.enc.yaml"), sealedYaml(["AI_ROUTER_TOKEN", "OPENROUTER_API_KEY"]));
  fs.writeFileSync(path.join(dir, "mail.enc.yaml"), sealedYaml(["MAIL_FROM", "SMTP_PASSWORD"]));
  const result = await run(["audit", "--env", "dev"], { cwd: root, env });
  const mixed = result.out.split("\n").filter((line) => line.startsWith("MIXED_PROVIDERS"));
  assert.deepEqual(mixed.map((line) => line.split(":")[0]), ["MIXED_PROVIDERS dev/mail.enc.yaml"], result.out);
});

test("migrate is a dry run naming keys only, then moves a legacy member to <slug>.enc.yaml and removes the old file", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "ai.enc"), sealedDotenv(["OPENROUTER_API_KEY"]));
  const seals = [];
  const sops = fakeSops(seals, { OPENROUTER_API_KEY: FAKE[2] });
  const dry = await run(["migrate", "--env", "dev", "ai", "--to", "openrouter"], { cwd: root, env, sops });
  assert.equal(dry.out, "dry run: would move dev/ai.enc to dev/openrouter.enc.yaml (OPENROUTER_API_KEY); add --execute\n");
  assert.equal(seals.length, 0);
  const done = await run(["migrate", "--env", "dev", "ai", "--to", "openrouter", "--execute"], { cwd: root, env, sops });
  assert.equal(done.code, 0, done.err);
  assert.deepEqual(seals.map((seal) => [seal.format, seal.file, seal.map]), [["yaml", "openrouter.enc.yaml", { OPENROUTER_API_KEY: FAKE[2] }]]);
  assert.equal(fs.existsSync(path.join(dir, "ai.enc")), false);
  assert.deepEqual(envelopeOf(fs.readFileSync(path.join(dir, "openrouter.enc.yaml"), "utf8")).keys, ["OPENROUTER_API_KEY"]);
  privateAbsent(done, [FAKE[2]]);
});

test("split divides a member by provider into one <provider>.enc.yaml each and merges into an existing member only when asked", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc.yaml"), sealedYaml(["SEPAY_MERCHANT_ID", "OPENROUTER_API_KEY"]));
  const seals = [];
  const sops = fakeSops(seals, { SEPAY_MERCHANT_ID: FAKE[0], OPENROUTER_API_KEY: FAKE[2] });
  const done = await run(["split", "--env", "dev", "sepay", "--execute"], { cwd: root, env, sops });
  assert.equal(done.code, 0, done.err);
  assert.deepEqual(envelopeOf(fs.readFileSync(path.join(dir, "sepay.enc.yaml"), "utf8")).keys, ["SEPAY_MERCHANT_ID"]);
  assert.deepEqual(envelopeOf(fs.readFileSync(path.join(dir, "openrouter.enc.yaml"), "utf8")).keys, ["OPENROUTER_API_KEY"]);
  assert.equal(fs.existsSync(path.join(dir, "sepay-staged.enc.yaml")), false, "the staged member is moved over the old one");
  privateAbsent(done, FAKE);
  fs.writeFileSync(path.join(dir, "mixed.enc.yaml"), sealedYaml(["SEPAY_X", "OPENROUTER_Y"]));
  const refused = await run(["split", "--env", "dev", "mixed", "--execute"], { cwd: root, env, sops });
  assert.match(refused.err, /already exists; split merges into it only with --into-existing/u);
});

test("a member sealed twice (.enc.yaml and a legacy .enc) is refused rather than read from either", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc.yaml"), sealedYaml(["K1"]));
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["K1"]));
  const result = await run(["get", "--env", "dev", "sepay", "K1", "--to-file"], { cwd: root, env, sops: fakeSops([]) });
  assert.match(result.err, /sepay is sealed twice/u);
});

test("set declares each key of a compose environment in its stack secrets: once, and names a swarm environment's keys to wire by hand", async (t) => {
  const { root, env } = app(t);
  const stacks = path.join(root, ".starcistacks", "application-stacks.yaml");
  fs.writeFileSync(stacks, "schema: starci/application-stacks@1\n# kept comment\nenvironments:\n  dev:\n    runtime: docker-compose\n    # custody\n    secrets: []\n  production:\n    runtime: docker-swarm\n    secrets: []\n");
  fs.mkdirSync(path.join(root, ".starcistacks", "production", "secrets"), { recursive: true });
  const first = await run(["set", "--env", "dev", "sepay", "SEPAY_MERCHANT_ID", "SEPAY_IPN_SECRET_KEY"], { cwd: root, env, stdin: () => `SEPAY_MERCHANT_ID=${FAKE[0]}\nSEPAY_IPN_SECRET_KEY=${FAKE[1]}\n`, sops: fakeSops([]) });
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /declared SEPAY_MERCHANT_ID, SEPAY_IPN_SECRET_KEY in environments\.dev\.secrets/u);
  const again = await run(["set", "--env", "dev", "sepay", "SEPAY_SIGNING_SECRET_KEY", "SEPAY_MERCHANT_ID"], { cwd: root, env, stdin: () => `SEPAY_SIGNING_SECRET_KEY=${FAKE[2]}\nSEPAY_MERCHANT_ID=${FAKE[0]}\n`, sops: fakeSops([], { SEPAY_IPN_SECRET_KEY: FAKE[1] }) });
  assert.equal(again.code, 0, again.err);
  const text = fs.readFileSync(stacks, "utf8");
  assert.ok(text.includes("# kept comment") && text.includes("# custody"), "comments survive the edit");
  const declared = parseYaml(text).environments.dev.secrets;
  assert.deepEqual(declared.map((entry) => [entry.name, entry.member, entry.key, entry.where]), [
    ["sepay-merchant-id", "sepay", "SEPAY_MERCHANT_ID", "secrets/sepay"],
    ["sepay-ipn-secret-key", "sepay", "SEPAY_IPN_SECRET_KEY", "secrets/sepay"],
    ["sepay-signing-secret-key", "sepay", "SEPAY_SIGNING_SECRET_KEY", "secrets/sepay"],
  ]);
  const swarm = await run(["set", "--env", "production", "openrouter", "OPENROUTER_API_KEY"], { cwd: root, env, stdin: () => FAKE[2], sops: fakeSops([]) });
  assert.match(swarm.out, /declare OPENROUTER_API_KEY in environments\.production\.secrets .*by hand/u);
  assert.deepEqual(parseYaml(fs.readFileSync(stacks, "utf8")).environments.production.secrets, []);
  privateAbsent(first, FAKE);
});

/** A sops seam double whose decrypt answers per member file (`byFile` keyed by file name); seals are recorded as fakeSops does. */
const filesSops = (seals, byFile) => ({ ...fakeSops(seals), decrypt: (file) => ({ ...byFile[path.basename(file)] }) });

test("split --group sends keys to the owner's members, merges an identical key into an existing member with --into-existing, then removes the source", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "api.enc.yaml"), sealedYaml(["OTP_PEPPER", "WEBHOOK_SIGNING_SECRET", "PRIMARY_DB_URL", "N8N_API_KEY"]));
  fs.writeFileSync(path.join(dir, "n8n.enc.yaml"), sealedYaml(["N8N_API_KEY", "N8N_HOST"]));
  const seals = [];
  const sops = filesSops(seals, {
    "api.enc.yaml": { OTP_PEPPER: FAKE[0], WEBHOOK_SIGNING_SECRET: FAKE[1], PRIMARY_DB_URL: FAKE[2], N8N_API_KEY: "fake-n8n" },
    "n8n.enc.yaml": { N8N_API_KEY: "fake-n8n", N8N_HOST: "fake-host" },
  });
  const args = ["split", "--env", "dev", "api", "--group", "OTP_PEPPER=nivo", "--group", "WEBHOOK_SIGNING_SECRET=nivo", "--group", "PRIMARY_DB_URL=postgres"];
  const refused = await run([...args, "--execute"], { cwd: root, env, sops });
  assert.match(refused.err, /dev\/n8n\.enc\.yaml already exists; split merges into it only with --into-existing/u);
  const dry = await run([...args, "--into-existing"], { cwd: root, env, sops });
  assert.equal(dry.out, "dry run: would split dev/api.enc.yaml into dev/nivo.enc.yaml (OTP_PEPPER, WEBHOOK_SIGNING_SECRET), dev/postgres.enc.yaml (PRIMARY_DB_URL), dev/n8n.enc.yaml (N8N_API_KEY) merged into the existing member; it already holds N8N_API_KEY, which must be identical; add --execute\n");
  assert.equal(seals.length, 0, "a dry run seals nothing");
  const done = await run([...args, "--into-existing", "--execute"], { cwd: root, env, sops });
  assert.equal(done.code, 0, done.err);
  assert.deepEqual(seals.map((seal) => [seal.file, seal.map]), [
    ["nivo.enc.yaml", { OTP_PEPPER: FAKE[0], WEBHOOK_SIGNING_SECRET: FAKE[1] }],
    ["postgres.enc.yaml", { PRIMARY_DB_URL: FAKE[2] }],
    ["n8n.enc.yaml", { N8N_API_KEY: "fake-n8n", N8N_HOST: "fake-host" }],
  ], "each target is written once, the existing one with its own keys kept");
  assert.equal(fs.existsSync(path.join(dir, "api.enc.yaml")), false, "the source goes only after every target is written");
  privateAbsent(done, [...FAKE, "fake-n8n", "fake-host"]);
});

test("a merge whose target holds a key with another value is refused naming the key, and nothing is written or removed", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "stack.enc.yaml"), sealedYaml(["OPENCLAW_TOKEN", "OPENCLAW_URL"]));
  fs.writeFileSync(path.join(dir, "openclaw.enc.yaml"), sealedYaml(["OPENCLAW_TOKEN"]));
  const seals = [];
  const sops = filesSops(seals, { "stack.enc.yaml": { OPENCLAW_TOKEN: FAKE[0], OPENCLAW_URL: FAKE[1] }, "openclaw.enc.yaml": { OPENCLAW_TOKEN: FAKE[2] } });
  const result = await run(["migrate", "--env", "dev", "stack", "--to", "openclaw", "--into-existing", "--execute"], { cwd: root, env, sops });
  assert.equal(result.code, 2);
  assert.match(result.err, /refused, nothing was written: dev\/openclaw\.enc\.yaml already holds OPENCLAW_TOKEN with another value/u);
  assert.equal(seals.length, 0);
  assert.ok(fs.existsSync(path.join(dir, "stack.enc.yaml")));
  privateAbsent(result, FAKE);
  const same = filesSops(seals, { "stack.enc.yaml": { OPENCLAW_TOKEN: FAKE[0], OPENCLAW_URL: FAKE[1] }, "openclaw.enc.yaml": { OPENCLAW_TOKEN: FAKE[0] } });
  const merged = await run(["migrate", "--env", "dev", "stack", "--to", "openclaw", "--into-existing", "--execute"], { cwd: root, env, sops: same });
  assert.equal(merged.code, 0, merged.err);
  assert.deepEqual(seals.map((seal) => [seal.file, seal.map]), [["openclaw.enc.yaml", { OPENCLAW_TOKEN: FAKE[0], OPENCLAW_URL: FAKE[1] }]]);
  assert.equal(fs.existsSync(path.join(dir, "stack.enc.yaml")), false);
});

test("--group-file reads KEY: member, and a group naming a key the member does not hold, or a key twice, is refused", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "api.enc.yaml"), sealedYaml(["OTP_PEPPER", "QUEUE_REDIS_PASSWORD"]));
  const groups = path.join(root, "..", "groups.yaml");
  fs.writeFileSync(groups, "OTP_PEPPER: nivo\nQUEUE_REDIS_PASSWORD: redis\n");
  const dry = await run(["split", "--env", "dev", "api", "--group-file", groups], { cwd: root, env, sops: fakeSops([]) });
  assert.equal(dry.out, "dry run: would split dev/api.enc.yaml into dev/nivo.enc.yaml (OTP_PEPPER), dev/redis.enc.yaml (QUEUE_REDIS_PASSWORD); add --execute\n");
  const stray = await run(["split", "--env", "dev", "api", "--group", "OTHER_KEY=nivo"], { cwd: root, env, sops: fakeSops([]) });
  assert.match(stray.err, /--group names OTHER_KEY, which dev\/api does not hold/u);
  const twice = await run(["split", "--env", "dev", "api", "--group-file", groups, "--group", "OTP_PEPPER=other"], { cwd: root, env, sops: fakeSops([]) });
  assert.match(twice.err, /--group names OTP_PEPPER twice/u);
  const wrongVerb = await run(["migrate", "--env", "dev", "api", "--group", "OTP_PEPPER=nivo"], { cwd: root, env, sops: fakeSops([]) });
  assert.match(wrongVerb.err, /--group and --group-file are only valid for split/u);
});

test("audit accepts a member the stack groups on purpose (every key declared in it) and still names an ungrouped mix", async (t) => {
  const { root, dir, env } = app(t);
  const entry = (key, member) => `      - {name: ${key.toLowerCase().replaceAll("_", "-")}, member: ${member}, key: ${key}, where: secrets/${member}}\n`;
  const declared = ["PRIMARY_DB_URL", "APP_BE_DB_PASSWORD", "POSTGRES_PASSWORD"].map((key) => entry(key, "postgres")).join("");
  fs.writeFileSync(path.join(root, ".starcistacks", "application-stacks.yaml"),
    `schema: starci/application-stacks@1\nenvironments:\n  dev:\n    secrets:\n${declared}${entry("OTP_PEPPER", "mixed")}`);
  fs.writeFileSync(path.join(dir, "postgres.enc.yaml"), sealedYaml(["PRIMARY_DB_URL", "APP_BE_DB_PASSWORD", "POSTGRES_PASSWORD"]));
  fs.writeFileSync(path.join(dir, "mixed.enc.yaml"), sealedYaml(["OTP_PEPPER", "QUEUE_REDIS_PASSWORD"]));
  const result = await run(["audit", "--env", "dev"], { cwd: root, env });
  assert.ok(!result.out.includes("dev/postgres.enc.yaml"), result.out);
  assert.ok(result.out.includes("MIXED_PROVIDERS dev/mixed.enc.yaml"), result.out);
});

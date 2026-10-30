// The re-seal of `starci app secret server-key` with the real sops and age: test keys generated in the spec's temp dir (removed
// with it), a member sealed to the owner key, the server reached through an injected runner that answers with the test server
// key's public recipient, then `sops updatekeys` under the owner identity. The server key alone must open the member afterwards,
// and the owner identity was used only as an existing recipient. Skipped where sops or age-keygen is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "./helpers/hfs-secret-fixture.mjs";
import { secretMain } from "../runtime/scripts/hfs/secret.mjs";
import { envelopeOf } from "../runtime/scripts/hfs/secret-document.mjs";
import { resolveSops } from "../runtime/scripts/api/sops/lib.mjs";
import { resolveRealTool } from "../runtime/scripts/api/process/resolve-real-tool.mjs";
import { SERVER_AGE_IDENTITY, ageKeygenScript, ensureIdentityScript } from "../stack/server-key.mjs";

const sops = resolveSops(process.env);
const keygen = resolveRealTool("age-keygen", { env: process.env });
const VALUE = "fake-value-sealed-in-a-scratch-app";

/** A test identity made with age-keygen in `dir`: its file and public recipient. */
function testKey(dir, name) {
  const file = path.join(dir, `${name}.txt`);
  assert.equal(spawnSync(keygen, ["-o", file], { stdio: "ignore" }).status, 0);
  const recipient = spawnSync(keygen, ["-y", file], { encoding: "utf8" }).stdout.trim();
  return { file, recipient, secret: fs.readFileSync(file, "utf8").split(/\r?\n/u).find((line) => line.startsWith("AGE-SECRET-KEY-")) };
}

test("server-key wraps a real member to the server recipient with sops updatekeys, and the server key alone opens it", { skip: !sops || !keygen ? "sops or age-keygen is not installed" : false }, async (t) => {
  const fixture = app(t, {}, "production");
  const keys = path.join(path.dirname(fixture.root), "test-keys");
  fs.mkdirSync(keys);
  const owner = testKey(keys, "owner");
  const server = testKey(keys, "server");
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "environments:\n  production:\n    runtime: docker-swarm\n    composeFiles: [stack.yml]\n    deploy:\n      remote:\n        host: vps\n");
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "production", "stack.yml"), "services:\n  api:\n    image: x\n");
  const env = { ...fixture.env, SOPS_AGE_KEY: owner.secret };
  const quiet = { cwd: fixture.root, env, stdout: () => {}, stderr: () => {}, tools: { secretEnv: () => ({}) } };
  assert.equal(await secretMain(["recipients", "--env", "production", "--add", owner.recipient, "--execute"], quiet), 0);
  assert.equal(await secretMain(["set", "--env", "production", "app", "API_KEY"], { ...quiet, stdin: () => VALUE }), 0);
  const file = path.join(fixture.dir, "app.enc.yaml");
  assert.deepEqual(envelopeOf(fs.readFileSync(file, "utf8")).recipients, [owner.recipient]);

  const ssh = Object.assign((command, { input } = {}) => {
    if (input === ageKeygenScript()) return { status: 0, stdout: "/usr/local/bin/age-keygen\n", stderr: "" };
    if (input === ensureIdentityScript(SERVER_AGE_IDENTITY)) return { status: 0, stdout: `${server.recipient}\n`, stderr: "identity created\n" };
    return { status: 127, stdout: "", stderr: "" };
  }, { cleanup: () => {}, notes: [] });
  const out = [];
  const err = [];
  const code = await secretMain(["server-key", "--env", "production", "--execute"], { ...quiet, stdout: (text) => out.push(text), stderr: (text) => err.push(text), serverKeyIo: { deps: { ssh } } });
  assert.equal(code, 0, err.join(""));
  assert.doesNotMatch(out.join("") + err.join(""), new RegExp(`${VALUE}|AGE-SECRET-KEY`, "u"));
  assert.deepEqual(envelopeOf(fs.readFileSync(file, "utf8")).recipients.sort(), [owner.recipient, server.recipient].sort());

  const isolated = { ...fixture.env, SOPS_AGE_KEY_FILE: server.file };
  const opened = spawnSync(sops, ["decrypt", "--input-type", "yaml", "--output-type", "json", file], { env: isolated, encoding: "utf8" });
  assert.equal(opened.status, 0, "the server key opens the member");
  assert.equal(JSON.parse(opened.stdout).API_KEY, VALUE);
});

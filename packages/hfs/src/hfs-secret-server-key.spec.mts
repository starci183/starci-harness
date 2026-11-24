// `starci app secret server-key` (stack/server-key.mts) over an injected ssh runner: the server's identity is made on the
// server, only `age-keygen -y` output comes back, a second run keeps it, an environment without a deploy remote is refused before
// any ssh, rotate stages, swaps and retires, and a backup into a repository is refused: the server key never leaves the
// server. Every key and value here is a fake.
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app } from "./helpers/hfs-secret-fixture.mjs";
import { secretMain } from "../runtime/scripts/hfs/secret.mjs";
import { parseYaml } from "../runtime/engine/yaml.mjs";
import { auditSecrets } from "../runtime/scripts/hfs/secret-standard.mjs";
import {
  SERVER_AGE_IDENTITY, ageKeygenScript, ensureIdentityScript, publicKeyScript, swapIdentityScript,
} from "../stack/server-key.mjs";

/** One call the fake server received: the remote command and the script sent on its stdin. */
interface Call { command: string; input: string | undefined }
type Fixture = ReturnType<typeof app>;

const OWNER = `age1${"q".repeat(58)}`;
const SERVER = `age1${"s".repeat(58)}`;
const NEXT = `age1${"n".repeat(58)}`;
const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const member = `API_KEY: ${ENC}\nsops:\n  age:\n    - recipient: ${OWNER}\n      enc: |\n        -----BEGIN AGE ENCRYPTED FILE-----\n        YWdl\n        -----END AGE ENCRYPTED FILE-----\n  mac: ${ENC}\n  version: 3.13.2\n`;

const stacks = (remote: boolean) => [
  "environments:",
  "  production:",
  "    runtime: docker-swarm",
  "    composeFiles: [stack.yml]",
  "    deploy:",
  "      # the deploy's own transport",
  ...(remote ? ["      remote:", "        host: vps"] : ["      stack: custody-spec"]),
  "",
].join("\n");

/** An app with a production swarm deploy (with or without a remote), one member and a production rule naming the owner key. */
async function productionApp(t: TestContext, { remote = true }: { remote?: boolean } = {}) {
  const fixture = app(t, { "app.enc.yaml": member }, "production");
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), stacks(remote));
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "production", "stack.yml"), "services:\n  api:\n    image: x\n");
  assert.equal(await secretMain(["recipients", "--env", "production", "--add", OWNER, "--execute"], { cwd: fixture.root, env: fixture.env, stdout: () => {}, stderr: () => {} }), 0);
  return fixture;
}

/**
 * A fake server reached through the injected runner: it holds `identity` (a public key standing for the private file) and
 * answers the scripts server-key sends. Every call is recorded with its stdin.
 */
function fakeServer({ identity = null, tool = true, next = NEXT }: { identity?: string | null; tool?: boolean; next?: string } = {}) {
  const state: { identity: string | null; staged: string | null; retired: Array<string | null>; calls: Call[] } = { identity, staged: null, retired: [], calls: [] };
  const run = (command: string, { input }: { input?: string } = {}) => {
    state.calls.push({ command, input });
    if (input === ageKeygenScript()) return tool ? { status: 0, stdout: "/usr/local/bin/age-keygen\n", stderr: "" } : { status: 127, stdout: "", stderr: "age-keygen is not installed\n" };
    if (input === ensureIdentityScript(SERVER_AGE_IDENTITY)) {
      const created = state.identity === null;
      state.identity ??= SERVER;
      return { status: 0, stdout: `${state.identity}\n`, stderr: created ? "identity created\n" : "identity kept\n" };
    }
    if (input === ensureIdentityScript(`${SERVER_AGE_IDENTITY}.next`)) {
      state.staged ??= next;
      return { status: 0, stdout: `${state.staged}\n`, stderr: "identity created\n" };
    }
    if (input === publicKeyScript(SERVER_AGE_IDENTITY))
      return state.identity === null ? { status: 5, stdout: "", stderr: "" } : { status: 0, stdout: `${state.identity}\n`, stderr: "" };
    if (input?.startsWith("set -eu\numask 077\n") && input.includes('mv "$n" "$f"')) {
      state.retired.push(state.identity);
      state.identity = state.staged;
      state.staged = null;
      return { status: 0, stdout: `${state.identity}\n`, stderr: "" };
    }
    return { status: 127, stdout: "", stderr: "unexpected command" };
  };
  return { state, run: Object.assign(run, { cleanup: () => {}, notes: [] }) };
}

/** A sops seam double: the owner identity is present; updateKeys records each member it would wrap again. */
const fakeSops = () => {
  const wrapped: string[] = [];
  return { wrapped, seam: { identity: { source: "spec" }, requireIdentity: () => {}, updateKeys: (file: string) => { wrapped.push(path.basename(file)); } } };
};

async function serverKey(fixture: Fixture, argv: string[], { server, sops = fakeSops(), deps = {}, io = {} }: { server?: { run: unknown }; sops?: ReturnType<typeof fakeSops>; deps?: Record<string, unknown>; io?: Record<string, unknown> }) {
  const out: string[] = [];
  const err: string[] = [];
  const [environment, ...flags] = argv;
  const code = await secretMain(["server-key", "--env", environment as string, ...flags], {
    cwd: fixture.root, env: fixture.env, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text),
    tools: { secretEnv: () => ({}) },
    hostIdentity: { label: "spec", read: () => undefined },
    serverKeyIo: { io: { sops: sops.seam, now: () => Date.UTC(2026, 9, 29, 12, 0, 0), ...io }, deps: { ssh: server?.run, ...deps } },
  });
  return { code, out: out.join(""), err: err.join(""), sops };
}

const ruleOf = (fixture: Fixture) => {
  const config = parseYaml(fs.readFileSync(path.join(fixture.root, ".sops.yaml"), "utf8"));
  return config.creation_rules.find((rule: { path_regex?: unknown }) => String(rule.path_regex).includes("production")).age.split(",");
};
const recorded = (fixture: Fixture) =>
  parseYaml(fs.readFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "utf8")).environments.production.deploy.remote.serverRecipient;

/** Every script sent to the server writes its stdout only through `age-keygen -y` (as "$k", its root-resolved path); age-keygen -o goes to /dev/null. */
function onlyPublicReadBack(calls: Call[]) {
  for (const { command, input } of calls) {
    const text = `${command}\n${input ?? ""}`;
    assert.doesNotMatch(text, /\bcat\b|\bhead\b|\btail\b|base64|\bxxd\b|\bdd\b/u, "no script reads the private file back");
    for (const line of (input ?? "").split("\n")) {
      if (/"\$k" -o/u.test(line)) assert.match(line, />\/dev\/null 2>&1$/u, "age-keygen -o prints nothing");
      assert.doesNotMatch(line, /^\s*age-keygen\b/u, "age-keygen is called by its root-resolved path, never by name");
    }
    const stdoutWriters = (input ?? "").split("\n").filter((line) => /^\s*"\$k"/u.test(line) && !/-o /u.test(line));
    for (const line of stdoutWriters) assert.match(line, /^"\$k" -y "\$f"$/u);
  }
}

test("server-key makes the identity on the server, reads back only its public key, and seals production to it and the owner key", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer();
  const result = await serverKey(fixture, ["production", "--execute"], { server });
  assert.equal(result.code, 0, result.err);
  assert.equal(server.state.identity, SERVER);
  onlyPublicReadBack(server.state.calls);
  assert.deepEqual(ruleOf(fixture), [OWNER, SERVER]);
  assert.equal(recorded(fixture), SERVER);
  assert.deepEqual(result.sops.wrapped, ["app.enc.yaml"]);
  assert.match(result.out, /created \/root\/\.config\/sops\/age\/keys\.txt on the server/u);
  assert.doesNotMatch(result.out + result.err, /AGE-SECRET-KEY/u);
  assert.match(fs.readFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "utf8"), /# the deploy's own transport/u, "the record keeps the file's comments");
});

test("server-key is idempotent: a second run keeps the server's identity and changes no recipient", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer();
  assert.equal((await serverKey(fixture, ["production", "--execute"], { server })).code, 0);
  const stacksText = fs.readFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "utf8");
  const again = await serverKey(fixture, ["production", "--execute"], { server });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /kept \/root\/\.config\/sops\/age\/keys\.txt/u);
  assert.equal(server.state.identity, SERVER);
  assert.deepEqual(ruleOf(fixture), [OWNER, SERVER]);
  assert.equal(fs.readFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "utf8"), stacksText);
  assert.ok(ensureIdentityScript(SERVER_AGE_IDENTITY).includes('if [ -e "$f" ] || [ -L "$f" ]; then'), "the script never overwrites an existing identity");
});

test("server-key is a dry run by default: no identity is made and nothing local changes", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer();
  const before = fs.readFileSync(path.join(fixture.root, ".sops.yaml"), "utf8");
  const result = await serverKey(fixture, ["production"], { server });
  assert.equal(result.code, 0, result.err);
  assert.equal(server.state.identity, null);
  assert.match(result.out, /dry run: would create/u);
  assert.equal(fs.readFileSync(path.join(fixture.root, ".sops.yaml"), "utf8"), before);
  assert.deepEqual(result.sops.wrapped, []);
});

test("server-key refuses an environment whose deploy declares no remote, before any ssh", async (t) => {
  const fixture = await productionApp(t, { remote: false });
  const server = fakeServer();
  const result = await serverKey(fixture, ["production", "--execute"], { server });
  assert.equal(result.code, 2);
  assert.match(result.err, /STACK_SERVER_KEY_NO_REMOTE: environments\.production\.deploy\.remote/u);
  assert.deepEqual(server.state.calls, []);
});

/**
 * A server whose sudo secure_path leaves out /usr/local/bin, where age-keygen lives (AlmaLinux 10): the deploy user's
 * `command -v age-keygen` finds it, and a root script that calls age-keygen by name exits 127 as sh does.
 */
function securePathServer() {
  const state: { identity: string | null; calls: Call[] } = { identity: null, calls: [] };
  const run = (command: string, { input }: { input?: string } = {}) => {
    state.calls.push({ command, input });
    if (/^command -v age(-keygen)?$/u.test(command)) return { status: 0, stdout: "/usr/local/bin/age-keygen\n", stderr: "" };
    if (!command.includes("sudo -n sh -s") || input === undefined) return { status: 127, stdout: "", stderr: "unexpected command" };
    const byName = input.split("\n").some((line) => /^\s*age-keygen\b|\$\(\s*age-keygen\b/u.test(line));
    if (byName || !input.includes("/usr/local/bin")) return { status: 127, stdout: "", stderr: "sh: line 1: age-keygen: command not found\n" };
    if (input === ageKeygenScript()) return { status: 0, stdout: "/usr/local/bin/age-keygen\n", stderr: "" };
    if (input === ensureIdentityScript(SERVER_AGE_IDENTITY)) {
      state.identity ??= SERVER;
      return { status: 0, stdout: `${SERVER}\n`, stderr: "identity created\n" };
    }
    if (input === publicKeyScript(SERVER_AGE_IDENTITY)) return state.identity ? { status: 0, stdout: `${state.identity}\n`, stderr: "" } : { status: 5, stdout: "", stderr: "" };
    return { status: 127, stdout: "", stderr: "unexpected command" };
  };
  return { state, run: Object.assign(run, { cleanup: () => {}, notes: [] }) };
}

test("server-key finds age-keygen as root where sudo's secure_path leaves /usr/local/bin out, checking it the way it calls it", async (t) => {
  const fixture = await productionApp(t);
  const server = securePathServer();
  const dry = await serverKey(fixture, ["production"], { server });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /dry run: would create/u);
  const result = await serverKey(fixture, ["production", "--execute"], { server });
  assert.equal(result.code, 0, result.err);
  assert.equal(server.state.identity, SERVER);
  assert.deepEqual(ruleOf(fixture), [OWNER, SERVER]);
  assert.ok(server.state.calls.every(({ command }) => !/^command -v/u.test(command)), "no presence check runs outside the root shell");
});

test("server-key refuses with the exact install commands when age-keygen is missing and cannot be installed", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer({ tool: false });
  const result = await serverKey(fixture, ["production", "--execute"], { server });
  assert.equal(result.code, 2);
  assert.match(result.err, /STACK_SERVER_KEY_NO_AGE: .*sudo -n apt-get install -y age/u);
  assert.equal(server.state.identity, null);
});

test("server-key --rotate stages a new identity, seals to it, swaps it in keeping the old one dated, then drops the old recipient", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer();
  assert.equal((await serverKey(fixture, ["production", "--execute"], { server })).code, 0);
  const result = await serverKey(fixture, ["production", "--rotate", "--execute"], { server });
  assert.equal(result.code, 0, result.err);
  onlyPublicReadBack(server.state.calls);
  assert.equal(server.state.identity, NEXT);
  assert.deepEqual(server.state.retired, [SERVER]);
  assert.ok(server.state.calls.some(({ input }) => input === swapIdentityScript(SERVER_AGE_IDENTITY, `${SERVER_AGE_IDENTITY}.retired-20261029T120000Z`)));
  assert.deepEqual(ruleOf(fixture), [OWNER, NEXT]);
  assert.equal(recorded(fixture), NEXT);
  assert.deepEqual(result.sops.wrapped, ["app.enc.yaml", "app.enc.yaml"], "sealed to old + new, then to new alone");
  assert.match(result.out, /kept on the server as \/root\/\.config\/sops\/age\/keys\.txt\.retired-20261029T120000Z/u);
});

test("server-key --rotate refuses when the server holds no identity", async (t) => {
  const fixture = await productionApp(t);
  const result = await serverKey(fixture, ["production", "--rotate", "--execute"], { server: fakeServer() });
  assert.equal(result.code, 2);
  assert.match(result.err, /STACK_SERVER_KEY_NONE/u);
});

test("audit holds production to the server key plus the owner key (RECIPIENT_DRIFT)", async (t) => {
  const fixture = await productionApp(t);
  const missing = auditSecrets(fixture.root, "production").filter((finding) => finding.code === "RECIPIENT_DRIFT");
  assert.match(missing[0]?.detail as string, /records no deploy server recipient/u);
  assert.equal((await serverKey(fixture, ["production", "--execute"], { server: fakeServer() })).code, 0);
  assert.deepEqual(auditSecrets(fixture.root, "production").filter((finding) => finding.member === ".sops.yaml"), []);
  assert.equal(await secretMain(["recipients", "--env", "production", "--remove", OWNER, "--execute"], { cwd: fixture.root, env: fixture.env, stdout: () => {}, stderr: () => {} }), 0);
  const ownerless = auditSecrets(fixture.root, "production").filter((finding) => finding.member === ".sops.yaml");
  assert.match(ownerless[0]?.detail as string, /names only the deploy server recipient/u);
});

test("server-key --backup is refused: the server key is never copied into a repository, and nothing is asked of the server", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer({ identity: SERVER });
  for (const argv of [["production", "--backup", "github", "--execute"], ["production", "--backup", "github"], ["production", "--backup", "anywhere"]]) {
    const result = await serverKey(fixture, argv, { server });
    assert.equal(result.code, 2, argv.join(" "));
    assert.match(result.err, /starci app secret: --backup is refused: the server key is never copied into a repository; its break-glass backup lives only in the harness repository's break-glass environment/u);
  }
  assert.deepEqual(server.state.calls, [], "refused before the server is asked anything");
});

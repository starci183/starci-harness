// `starci app secret server-key` (stack/server-key.mjs) over an injected ssh runner: the server's identity is made on the
// server, only `age-keygen -y` output comes back, a second run keeps it, an environment without a deploy remote is refused before
// any ssh, rotate stages, swaps and retires, and the GitHub backup streams through a pipe into a protected Environment secret
// without a private byte reaching stdout, stderr or disk. Every key and value here is a fake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app } from "./helpers/hfs-secret-fixture.mjs";
import { secretMain } from "../runtime/scripts/hfs/secret.mjs";
import { parseYaml } from "../runtime/engine/yaml.mjs";
import { auditSecrets } from "../runtime/scripts/hfs/secret-standard.mjs";
import {
  SERVER_AGE_IDENTITY, backupSecretName, ensureIdentityScript, publicKeyScript, streamIdentityCommand, swapIdentityScript,
} from "../stack/server-key.mjs";

const OWNER = `age1${"q".repeat(58)}`;
const SERVER = `age1${"s".repeat(58)}`;
const NEXT = `age1${"n".repeat(58)}`;
// A fake private identity, assembled so the tree holds no age secret key literal.
const PRIVATE = ["AGE", "SECRET", "KEY", "1FAKEPRIVATEBYTESNEVERSHOWNANYWHERE"].join("-");
const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const member = `API_KEY: ${ENC}\nsops:\n  age:\n    - recipient: ${OWNER}\n      enc: |\n        -----BEGIN AGE ENCRYPTED FILE-----\n        YWdl\n        -----END AGE ENCRYPTED FILE-----\n  mac: ${ENC}\n  version: 3.13.2\n`;

const stacks = (remote) => [
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
async function productionApp(t, { remote = true } = {}) {
  const fixture = app(t, { "app.enc.yaml": member }, "production");
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), stacks(remote));
  fs.writeFileSync(path.join(fixture.root, ".starcistacks", "production", "stack.yml"), "services:\n  api:\n    image: x\n");
  assert.equal(await secretMain(["recipients", "production", "--add", OWNER], { cwd: fixture.root, env: fixture.env, stdout: () => {}, stderr: () => {} }), 0);
  return fixture;
}

/**
 * A fake server reached through the injected runner: it holds `identity` (a public key standing for the private file) and
 * answers the scripts server-key sends. Every call is recorded with its stdin.
 */
function fakeServer({ identity = null, tool = true, next = NEXT } = {}) {
  const state = { identity, staged: null, retired: [], calls: [] };
  const run = (command, { input } = {}) => {
    state.calls.push({ command, input });
    if (command === "command -v age-keygen") return { status: tool ? 0 : 1, stdout: "", stderr: "" };
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
    if (input?.startsWith("set -eu\numask 077\nf=") && input.includes('mv "$n" "$f"')) {
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
  const wrapped = [];
  return { wrapped, seam: { identity: { source: "spec" }, requireIdentity: () => {}, updateKeys: (file) => { wrapped.push(path.basename(file)); } } };
};

async function serverKey(fixture, argv, { server, sops = fakeSops(), deps = {}, io = {} }) {
  const out = [];
  const err = [];
  const code = await secretMain(["server-key", ...argv], {
    cwd: fixture.root, env: fixture.env, stdout: (text) => out.push(text), stderr: (text) => err.push(text),
    tools: { secretEnv: () => ({}) },
    hostIdentity: { label: "spec", read: () => undefined },
    serverKeyIo: { io: { sops: sops.seam, now: () => Date.UTC(2026, 9, 29, 12, 0, 0), ...io }, deps: { ssh: server?.run, ...deps } },
  });
  return { code, out: out.join(""), err: err.join(""), sops };
}

const ruleOf = (fixture) => {
  const config = parseYaml(fs.readFileSync(path.join(fixture.root, ".sops.yaml"), "utf8"));
  return config.creation_rules.find((rule) => String(rule.path_regex).includes("production")).age.split(",");
};
const recorded = (fixture) =>
  parseYaml(fs.readFileSync(path.join(fixture.root, ".starcistacks", "application-stacks.yaml"), "utf8")).environments.production.deploy.remote.serverRecipient;

/** Every script sent to the server writes its stdout only through `age-keygen -y`; age-keygen -o goes to /dev/null. */
function onlyPublicReadBack(calls) {
  for (const { command, input } of calls) {
    const text = `${command}\n${input ?? ""}`;
    assert.doesNotMatch(text, /\bcat\b|\bhead\b|\btail\b|base64|\bxxd\b|\bdd\b/u, "no script reads the private file back");
    for (const line of (input ?? "").split("\n")) {
      if (/age-keygen -o/u.test(line)) assert.match(line, />\/dev\/null 2>&1$/u, "age-keygen -o prints nothing");
    }
    const stdoutWriters = (input ?? "").split("\n").filter((line) => /^\s*age-keygen\b/u.test(line) && !/-o /u.test(line));
    for (const line of stdoutWriters) assert.match(line, /^age-keygen -y "\$f"$/u);
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
  assert.match(missing[0].detail, /records no deploy server recipient/u);
  assert.equal((await serverKey(fixture, ["production", "--execute"], { server: fakeServer() })).code, 0);
  assert.deepEqual(auditSecrets(fixture.root, "production").filter((finding) => finding.member === ".sops.yaml"), []);
  assert.equal(await secretMain(["recipients", "production", "--remove", OWNER], { cwd: fixture.root, env: fixture.env, stdout: () => {}, stderr: () => {} }), 0);
  const ownerless = auditSecrets(fixture.root, "production").filter((finding) => finding.member === ".sops.yaml");
  assert.match(ownerless[0].detail, /names only the deploy server recipient/u);
});

/** A gh port double: the origin repository and the Environment `environment` answers. */
const fakeGithub = (environment, policies = []) => {
  const runs = [];
  return {
    runs,
    port: {
      repository: () => "owner/app",
      json: (args) => {
        if (args[1].endsWith("/deployment-branch-policies")) return { branch_policies: policies };
        if (environment === null) throw new Error("404");
        return environment;
      },
      run: (args) => { runs.push(args); return ""; },
    },
  };
};

/** Every file under `root`, read as text, contains no `needle`. */
function nowhereOnDisk(root, needle) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    assert.ok(!fs.readFileSync(file).includes(needle), `${file} holds no private byte`);
  }
}

test("server-key --backup github streams the identity through a pipe into a protected Environment secret, never to stdout, logs or disk", async (t) => {
  const fixture = await productionApp(t);
  const gh = fakeGithub({ protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User" }] }], deployment_branch_policy: null });
  const remotes = [];
  const sent = `${PRIVATE}\n`;
  const runner = Object.assign(() => ({ status: 127, stdout: "", stderr: "" }), {
    cleanup: () => {}, notes: [],
    argv: (remote) => { remotes.push(remote); return { command: process.execPath, args: ["-e", `process.stdout.write(${JSON.stringify(sent)})`], env: process.env }; },
  });
  // The sink stands for gh: it exits 0 only when its stdin is exactly the streamed identity, and it names its arguments on stderr.
  const sink = { command: process.execPath, args: ["-e", `let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{process.stderr.write(process.argv.slice(1).join(' '));process.exit(b===${JSON.stringify(sent)}?0:3)})`, "--"] };
  const result = await serverKey(fixture, ["production", "--backup", "github", "--execute"], { deps: { ssh: runner, github: gh.port, ghCommand: sink } });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(remotes, [streamIdentityCommand(SERVER_AGE_IDENTITY)]);
  assert.match(result.out, /as the GitHub Environment secret SOPS_AGE_KEY_PRODUCTION of owner\/app/u);
  assert.doesNotMatch(result.out + result.err, /AGE-SECRET-KEY/u);
  nowhereOnDisk(path.dirname(fixture.root), PRIVATE);
  assert.equal(backupSecretName("staging-eu"), "SOPS_AGE_KEY_STAGING_EU");
});

test("server-key --backup github refuses an Environment without protection, and one that does not exist, before any ssh", async (t) => {
  const fixture = await productionApp(t);
  const server = fakeServer();
  const piped = [];
  const io = { pipe: async (...ends) => { piped.push(ends); return { source: 0, sink: 0, stderr: "" }; } };
  const open = await serverKey(fixture, ["production", "--backup", "github", "--execute"], { server, io, deps: { github: fakeGithub({ protection_rules: [], deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }).port } });
  assert.equal(open.code, 2);
  assert.match(open.err, /STACK_SERVER_KEY_UNPROTECTED: .*no required reviewers and its deployment branches are not limited to main/u);
  const wide = await serverKey(fixture, ["production", "--backup", "github", "--execute"], { server, io, deps: { github: fakeGithub({ protection_rules: [{ type: "branch_policy" }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }, [{ name: "main" }, { name: "release/*" }]).port } });
  assert.equal(wide.code, 2);
  const absent = await serverKey(fixture, ["production", "--backup", "github", "--execute"], { server, io, deps: { github: fakeGithub(null).port } });
  assert.match(absent.err, /STACK_SERVER_KEY_GITHUB_ENVIRONMENT: the GitHub Environment production of owner\/app does not exist/u);
  assert.deepEqual(piped, []);
  assert.deepEqual(server.state.calls, []);
  const mainOnly = await serverKey(fixture, ["production", "--backup", "github"], { server, io, deps: { github: fakeGithub({ protection_rules: [{ type: "branch_policy" }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }, [{ name: "main", type: "branch" }]).port } });
  assert.equal(mainOnly.code, 0, mainOnly.err);
  assert.match(mainOnly.out, /dry run: would stream/u);
});

test("server-key --restore github dispatches the managed restore workflow for a protected Environment", async (t) => {
  const fixture = await productionApp(t);
  const gh = fakeGithub({ protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "Team" }] }] });
  const result = await serverKey(fixture, ["production", "--restore", "github", "--execute"], { deps: { github: gh.port } });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(gh.runs, [["workflow", "run", "stack-key-restore.yml", "--repo", "owner/app", "-f", "environment=production", "-f", "secret=SOPS_AGE_KEY_PRODUCTION"]]);
});

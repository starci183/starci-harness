// `starci app secret set`: the masked terminal prompt, several keys in one sealed write, KEY=value lines on redirected stdin,
// and the age identity found by itself (environment, the app's .claude/secret.env or its main checkout's, the harness's
// secret.env through the host port) or refused before any value is asked for. Every value here is a fake; none may be printed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { app, run, privateAbsent } from "./helpers/hfs-secret-fixture.mjs";
import { promptHidden, stdinValues } from "../runtime/scripts/hfs/secret-prompt.mjs";
import { defaultSops } from "../runtime/scripts/hfs/secret-sops.mjs";
import { envelopeOf } from "../runtime/scripts/hfs/secret-document.mjs";

const RECIPIENT = `age1${"q".repeat(58)}`;
const HOST_KEY = `AGE-SECRET-KEY-1${"H".repeat(58)}`;
const MAIN_KEY = `AGE-SECRET-KEY-1${"M".repeat(58)}`;
const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const FAKE = ["fake-signing-value-1", "fake-ipn-value-2", "fake-third-value-3"];

const sealedDotenv = (keys, recipient = RECIPIENT) =>
  `${keys.map((key) => `${key}=${ENC}`).join("\n")}\n` +
  `sops_age__list_0__map_recipient=${recipient}\n` +
  `sops_age__list_0__map_enc=-----BEGIN AGE ENCRYPTED FILE-----\\nYWdl\\n-----END AGE ENCRYPTED FILE-----\n` +
  `sops_mac=${ENC}\nsops_version=3.13.2\nsops_lastmodified=2026-01-01T00:00:00Z\n`;

/** A sops seam double: records each seal's plaintext keys and values, returns an envelope naming the keys. */
const fakeSeal = (seals) => (request) => {
  const map = Object.fromEntries(
    request.plaintext.split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  seals.push(map);
  return sealedDotenv(Object.keys(map));
};

const fakeSops = (seals, existing = {}) => ({
  decrypt: () => ({ ...existing }),
  seal: fakeSeal(seals),
});

/** A queue of typed answers; records the labels it was asked with. */
const answers = (values, labels) => async (label) => {
  labels.push(label);
  return values.shift();
};

// A runProgram double of the selected-identity contract (as hfs-secret-custody.spec.mjs): it records the age key each
// decrypt's child env carries; the member it decrypts holds TOKEN.
const selectedTools = (calls, secretEnv = () => ({})) => ({
  resolveSops: () => process.execPath,
  resolveRealTool: () => process.execPath,
  secretEnv,
  runProgram: (program, args, options) => {
    calls.push({ args: [...args], ageKey: options?.env?.SOPS_AGE_KEY });
    const ok = (text) => ({ status: 0, signal: null, error: null, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
    if (args[0] === "--disable-version-check") return ok("sops 3.13.2\n");
    if (args[0] === "--version") return ok("1.3.1\n");
    if (args[0] === "-y") return ok(`${RECIPIENT}\n`);
    if (args[0] === "decrypt") return ok("TOKEN=kept-private\n");
    return { status: 1, signal: null, error: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
});

/** A fake terminal: a stream with isTTY and a raw mode switch that records each change. */
const fakeTerminal = () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.modes = [];
  input.setRawMode = (on) => { input.isRaw = on; input.modes.push(on); return input; };
  return input;
};

test("promptHidden echoes one * per character, takes a paste in one chunk, erases on backspace and restores the mode", async () => {
  const input = fakeTerminal();
  const shown = [];
  const typed = promptHidden("SEPAY_SIGNING_SECRET_KEY: ", { input, output: (s) => shown.push(s) });
  input.write(FAKE[0]);
  input.write("x\u007f");
  input.write("\r");
  assert.equal(await typed, FAKE[0]);
  const screen = shown.join("");
  assert.ok(screen.startsWith("SEPAY_SIGNING_SECRET_KEY: "));
  assert.ok(!screen.includes(FAKE[0]), "the typed value is never echoed");
  assert.equal(screen.split("*").length - 1, FAKE[0].length + 1, "one * per typed character");
  assert.deepEqual(input.modes, [true, false], "raw while reading, restored after");
});

test("promptHidden cancels on Ctrl+C and on end of input before anything is typed", async () => {
  const input = fakeTerminal();
  const pending = promptHidden("K: ", { input, output: () => {} });
  input.write("abc\u0003");
  await assert.rejects(pending, /cancelled at the prompt; nothing was sealed/u);
  const closed = fakeTerminal();
  const ended = promptHidden("K: ", { input: closed, output: () => {} });
  closed.end();
  await assert.rejects(ended, /cancelled/u);
});

test("set on a terminal prompts each key in turn, masked, and seals them all in one write", async (t) => {
  const { root, env } = app(t);
  const seals = [];
  const labels = [];
  const result = await run(["set", "dev", "sepay", "K1", "K2", "K3"], {
    cwd: root, env, stdin: { isTTY: true }, prompt: answers([...FAKE], labels), sops: fakeSops(seals),
  });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(labels, ["K1: ", "K2: ", "K3: "]);
  assert.equal(seals.length, 1, "one sops write");
  assert.deepEqual(seals[0], { K1: FAKE[0], K2: FAKE[1], K3: FAKE[2] });
  assert.match(result.out, /^sealed dev\/sepay \(K1, K2, K3\)/u);
  privateAbsent(result, FAKE);
  const listed = await run(["list", "dev"], { cwd: root, env });
  for (const key of ["K1", "K2", "K3"]) assert.match(listed.out, new RegExp(key, "u"));
});

test("an empty typed value seals nothing", async (t) => {
  const { root, env, dir } = app(t);
  const seals = [];
  const result = await run(["set", "dev", "sepay", "K1", "K2"], {
    cwd: root, env, stdin: { isTTY: true }, prompt: answers([FAKE[0], ""], []), sops: fakeSops(seals),
  });
  assert.equal(result.code, 2);
  assert.match(result.err, /K2 is empty; nothing was sealed/u);
  assert.equal(seals.length, 0);
  assert.equal(fs.existsSync(path.join(dir, "sepay.enc")), false);
});

test("redirected stdin gives one key its whole text, or one KEY=value line per key, sealed in one write", async (t) => {
  const { root, env } = app(t);
  const seals = [];
  const one = await run(["set", "dev", "solo", "K1"], { cwd: root, env, stdin: () => `${FAKE[0]}\nsecond line\n`, sops: fakeSops(seals) });
  assert.equal(one.code, 0, one.err);
  assert.deepEqual(seals[0], { K1: `${FAKE[0]}\\nsecond line` }, "a multi-line value survives (sops dotenv escapes LF)");
  const many = await run(["set", "dev", "sepay", "K1", "K2"], {
    cwd: root, env, stdin: () => `# comment\r\nK2=${FAKE[1]}\r\nK1=${FAKE[0]}=tail\r\n`, sops: fakeSops(seals),
  });
  assert.equal(many.code, 0, many.err);
  assert.equal(seals.length, 2);
  assert.deepEqual(seals[1], { K1: `${FAKE[0]}=tail`, K2: FAKE[1] });
  privateAbsent(many, FAKE);
});

test("stdin lines must name every key once and no other", () => {
  assert.throws(() => stdinValues(["K1", "K2"], `K1=${FAKE[0]}\n`), /stdin lacks K2/u);
  assert.throws(() => stdinValues(["K1", "K2"], `K1=a\nK2=b\nK3=c\n`), /names K3/u);
  assert.throws(() => stdinValues(["K1", "K2"], `K1=a\nK1=b\nK2=c\n`), /gives K1 twice/u);
  assert.throws(() => stdinValues(["K1", "K2"], `K1=\nK2=c\n`), /K1 is empty/u);
  assert.throws(() => stdinValues(["K1"], "\n"), /the value on stdin is empty/u);
});

test("set refuses a key named twice", async (t) => {
  const { root, env } = app(t);
  const result = await run(["set", "dev", "sepay", "K1", "K1"], { cwd: root, env, stdin: () => "x", sops: fakeSops([]) });
  assert.equal(result.code, 2);
  assert.match(result.err, /set names K1 twice/u);
});

test("adding to an existing member with no identity anywhere refuses before any prompt, naming every place and the fix", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["SEPAY_IPN_SECRET_KEY"]));
  const calls = [];
  const labels = [];
  const host = { label: path.join(root, "..", "harness", "secret.env"), read: () => undefined };
  const result = await run(["set", "dev", "sepay", "SEPAY_SIGNING_SECRET_KEY"], {
    cwd: root, env, stdin: { isTTY: true }, prompt: answers([FAKE[0]], labels), tools: selectedTools(calls), hostIdentity: host,
  });
  assert.equal(result.code, 2);
  assert.deepEqual(labels, [], "no value is asked for");
  assert.equal(calls.length, 0, "no sops process runs");
  assert.match(result.err, /no age identity opens sepay\.enc, sealed to age1q+/u);
  assert.ok(result.err.includes(path.join(root, ".claude", "secret.env")), "names the app's secret.env");
  assert.ok(result.err.includes(host.label), "names the harness secret.env");
  assert.match(result.err, /Fix: add the line SOPS_AGE_KEY=/u);
});

test("the harness secret.env's SOPS_AGE_KEY opens an existing member when the environment and the app hold none", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["TOKEN"]));
  const calls = [];
  const seals = [];
  const host = { label: "/harness/secret.env", read: () => HOST_KEY };
  const seam = defaultSops(env, root, process.platform, selectedTools(calls), host);
  const result = await run(["set", "dev", "sepay", "K1", "K2"], {
    cwd: root, env, stdin: { isTTY: true }, prompt: answers([FAKE[0], FAKE[1]], []),
    sops: { ...seam, seal: fakeSeal(seals) },
  });
  assert.equal(result.code, 0, result.err);
  const decrypt = calls.find((call) => call.args[0] === "decrypt");
  assert.equal(decrypt?.ageKey, HOST_KEY, "the host identity reaches the sops child alone");
  assert.deepEqual(Object.keys(seals[0]).sort(), ["K1", "K2", "TOKEN"], "the existing key is kept, both new ones added, one write");
  assert.equal(result.out, "sealed dev/sepay (K1, K2)\n");
  privateAbsent(result, [HOST_KEY, ...FAKE]);
  const got = await run(["get", "dev", "sepay", "TOKEN", "--to-file"], { cwd: root, env, tools: selectedTools(calls), hostIdentity: host });
  assert.equal(got.code, 0, got.err);
  privateAbsent(got, [HOST_KEY]);
});

test("an identity that is not the member's recipient is refused naming where it came from and the member's recipient", async (t) => {
  const { root, dir, env } = app(t);
  const other = `age1${"p".repeat(58)}`;
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["SEPAY_MERCHANT_ID"], other));
  const host = { label: "/harness/secret.env", read: () => HOST_KEY };
  const result = await run(["get", "dev", "sepay", "SEPAY_MERCHANT_ID", "--to-file"], { cwd: root, env, tools: selectedTools([]), hostIdentity: host });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes(`the age identity of /harness/secret.env (SOPS_AGE_KEY) does not open sepay.enc, sealed to ${other}`), result.err);
  privateAbsent(result, [HOST_KEY]);
});

test("the app's own .claude/secret.env wins over the harness's, and a worktree reads its main checkout's", async (t) => {
  const { root, dir, env } = app(t);
  fs.writeFileSync(path.join(dir, "sepay.enc"), sealedDotenv(["TOKEN"]));
  const main = path.join(path.dirname(root), "main");
  fs.mkdirSync(path.join(main, ".git", "worktrees", "app"), { recursive: true });
  fs.mkdirSync(path.join(main, ".claude"));
  fs.writeFileSync(path.join(main, ".claude", "secret.env"), `SOPS_AGE_KEY=${MAIN_KEY}\n`);
  fs.writeFileSync(path.join(root, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "app")}\n`);
  const calls = [];
  const tools = selectedTools(calls);
  delete tools.secretEnv;
  const host = { label: "/harness/secret.env", read: () => HOST_KEY };
  const result = await run(["get", "dev", "sepay", "TOKEN", "--to-file"], { cwd: root, env, tools, hostIdentity: host });
  assert.equal(result.code, 0, result.err);
  assert.equal(calls.find((call) => call.args[0] === "decrypt")?.ageKey, MAIN_KEY);
  privateAbsent(result, [MAIN_KEY, HOST_KEY]);
});

test("the first set names the identity a later set needs, or the fix when this machine holds none", async (t) => {
  const { root, env } = app(t);
  const held = defaultSops(env, root, process.platform, selectedTools([]), { label: "/harness/secret.env", read: () => HOST_KEY });
  const first = await run(["set", "dev", "sepay", "K1"], { cwd: root, env, stdin: () => FAKE[0], sops: { ...held, seal: fakeSeal([]) } });
  assert.equal(first.code, 0, first.err);
  assert.equal(
    first.out,
    `sealed dev/sepay (K1); a new member: adding keys to it later needs the age identity of ${RECIPIENT}; this machine holds it in /harness/secret.env (SOPS_AGE_KEY)\n`,
  );
  const none = defaultSops(env, root, process.platform, selectedTools([]), { label: "/harness/secret.env", read: () => undefined });
  const other = await run(["set", "dev", "ops", "K1"], { cwd: root, env, stdin: () => FAKE[0], sops: { ...none, seal: fakeSeal([]) } });
  assert.equal(other.code, 0, other.err);
  assert.ok(other.out.includes(`this machine holds none: add SOPS_AGE_KEY to ${path.join(root, ".claude", "secret.env")} before the next set`));
  privateAbsent(other, [HOST_KEY, FAKE[0]]);
  assert.deepEqual(envelopeOf(fs.readFileSync(path.join(root, ".starcistacks", "dev", "secrets", "ops.enc"), "utf8")).keys, ["K1"]);
});

// The default wiring end to end: a child whose stdin claims a terminal (a pipe with isTTY forced, since a spec has no real
// console) runs `secret set` with no stdin or prompt port, so the real promptHidden reads process.stdin. The paste arrives in
// one chunk and the child's stderr shows the label and stars only.
test("with no stdin port, a terminal stdin gets the masked prompt instead of a redirected-stdin refusal", async (t) => {
  const { root, env } = app(t);
  const out = path.join(root, "seals.json");
  const secretModule = new URL("../runtime/scripts/hfs/secret.mjs", import.meta.url).href;
  const script = `
    import fs from "node:fs";
    import { secretMain } from ${JSON.stringify(secretModule)};
    Object.defineProperty(process.stdin, "isTTY", { value: true });
    const seals = [];
    const code = await secretMain(["set", "dev", "sepay", "SEPAY_SIGNING_SECRET_KEY"], {
      cwd: ${JSON.stringify(root)},
      sops: { decrypt: () => ({}), seal: (request) => { seals.push(request.plaintext); return ${JSON.stringify(sealedDotenv(["SEPAY_SIGNING_SECRET_KEY"]))}; } },
    });
    fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ code, seals }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.once("data", () => child.stdin.write(`${FAKE[0]}\r`));
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, stderr);
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(result.code, 0, stderr);
  assert.deepEqual(result.seals, [`SEPAY_SIGNING_SECRET_KEY=${FAKE[0]}\n`]);
  assert.ok(stderr.startsWith("SEPAY_SIGNING_SECRET_KEY: "), stderr);
  assert.ok(stderr.includes("*".repeat(FAKE[0].length)));
  assert.ok(!stderr.includes(FAKE[0]) && !stdout.includes(FAKE[0]), "the value is never echoed");
  assert.doesNotMatch(stderr, /redirected stdin/u);
  assert.match(stdout, /^sealed dev\/sepay \(SEPAY_SIGNING_SECRET_KEY\)/u);
});

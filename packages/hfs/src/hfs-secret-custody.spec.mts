// proves: HFS_AGE_KEY_CUSTODY
// proves: HFS_CANON_COPY_DRIFT
// proves: HFS_SECRET_PLAINTEXT_FILE
// proves: HFS_SECRET_OUTSIDE_ENC
// proves: HFS_PACKAGE_SECRET_NOT_SEALED
// proves: HFS_PACKAGE_SECRET_RECIPIENT
// Names and paths may be printed. Compare private test data only as booleans.
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { runGit } from "../runtime/scripts/api/git/lib.mjs";
import { judge } from "../sync/hygiene.mjs";
import { app, run, privateAbsent } from "./helpers/hfs-secret-fixture.mjs";
import {
  secretHits,
  secretNameLike,
  secretPatternHits,
} from "../runtime/scripts/lib/secret-patterns.mjs";
import {
  ageKeyCustodyFindings,
  secretFileFindings,
} from "../runtime/scripts/hfs/rules/secrets.mjs";
import { canonCopyDriftFindings } from "../runtime/scripts/hfs/rules/canon-copy-drift.mjs";
import { secretCustodyOnlyFindings } from "../runtime/scripts/hfs/rules/secret-custody-only.mjs";
import { sealedSecretCustodyFindings } from "../runtime/scripts/hfs/rules/secret-custody.mjs";
import { secretRoots } from "../runtime/scripts/hfs/secret-files.mjs";
import type { SecretToolOverrides } from "../runtime/scripts/hfs/secret-init.mjs";

const RECIPIENT = `age1${"q".repeat(58)}`;
const PRIVATE_KEY = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
const OTHER_KEY = `AGE-SECRET-KEY-1${"P".repeat(58)}`;
const ENC = "ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]";
const AGE_PAYLOAD =
  "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWJsb2Nr\n-----END AGE ENCRYPTED FILE-----";
const sealedDotenv = (keys: string[], recipient = RECIPIENT) => {
  const members = keys.map((key) => `${key}=${ENC}`).join("\n");
  const payload = AGE_PAYLOAD.replaceAll("\n", String.raw`\n`);
  return `${members}\n` +
    `sops_age__list_0__map_recipient=${recipient}\n` +
    `sops_age__list_0__map_enc=${payload}\n` +
    `sops_mac=${ENC}\nsops_version=3.13.2\nsops_lastmodified=2026-01-01T00:00:00Z\n`;
};

const write = (root: string, file: string, text: string | Buffer = "x\n") => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);
const ctx = (root: string, files: string[], edition: string) => ({
  repoRoot: root,
  files,
  repo: { profile: "app", edition },
  // reason: the finders default an absent inScope; the spec deliberately passes none.
  inScope: undefined as unknown as (file: string) => boolean,
});

// The canon template bytes a scaffolded file must equal (sha256-judged, never content-compared).
const TEMPLATE = path.resolve(
  import.meta.dirname,
  "../templates/be/skeleton",
);
const CANON = [
  "src/modules/platform/config/env-source.config.ts",
  "src/modules/platform/http-security/origin.guard.ts",
  "src/modules/platform/http-security/webhook-signature.service.ts",
];

// An app formats its sources with @starci/prettier-config before every commit (HFS_FORMAT) and HFS_CANON_COPY_DRIFT pins the
// canon copies to the template bytes: a template Prettier would rewrite leaves the app no commit that satisfies both.
const STARCI_PRETTIER = {
  printWidth: 120,
  tabWidth: 4,
  useTabs: false,
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "auto",
} as const;

test("HFS_CANON_COPY_DRIFT: every canon-copy template is already in the form the scaffold's Prettier config writes", async () => {
  const shared = path.resolve(import.meta.dirname, "../../prettier-config/src/index.ts");
  if (fs.existsSync(shared)) {
    const source = fs.readFileSync(shared, "utf8");
    for (const [key, value] of Object.entries(STARCI_PRETTIER))
      assert.ok(source.includes(`${key}: ${JSON.stringify(value)}`), `@starci/prettier-config sets ${key}: ${JSON.stringify(value)}`);
  }
  const prettier = await import("prettier");
  for (const rel of CANON) {
    const file = path.join(TEMPLATE, rel);
    const text = fs.readFileSync(file, "utf8");
    assert.equal(await prettier.format(text, { ...STARCI_PRETTIER, filepath: file }), text, `${rel} is Prettier-stable`);
  }
});

test("assigned-secret flags the required names and unquoted values, never config names, references or stand-ins", () => {
  const flagged = [
    'DB_PASSWORD = "hunter2hunter2hunter2"',
    'const API_SECRET = "s3cr3t-v4lu3-extra"',
    'OPENAI_API_KEY = "sk-longvaluehere123"',
    'dbPassword = "s3cr3t-v4lu3-extra"',
    'mySecretKey = "s3cr3t-v4lu3-extra"',
    'SUPABASE_SERVICE_ROLE_KEY = "longservicekeyvalue"',
    'N8N_ENCRYPTION_KEY = "longencryptionvalue"',
    "DB_PASSWORD=hunter2hunter2hunter2",
    "- API_SECRET=s3cr3t-v4lu3-extra",
  ];
  for (const line of flagged)
    assert.ok(secretHits(line.includes('"') ? "src/app.ts" : ".env", line).includes("assigned-secret"), line);
  const benign = [
    'PASSWORD_MIN_LENGTH = "16"',
    'SECRET_FILE = "averylongpathnamehere"',
    "APP_SECRET_FILE=/run/secrets/app",
    "tokenBudget: 20000000000",
    "secretRef: sec.db.password",
    'secondary = "s3cr3t-v4lu3-extra"',
    'tokenize = "s3cr3t-v4lu3-extra"',
    "maxTokens = 100000000000",
    'secret = "env(APP_SECRET)"',
    "secret = process.env.APP_SECRET;",
    'secret = "$APP_SECRET"',
    "SECRET: ${{ secrets.APP_SECRET }}",
    "password: secret:db/password",
    "apiKey: ref:vault/api",
    "secret = buildSessionSecret()",
    "APP_SECRET = credentialsSource.current",
    "APP_SECRET = credentialsSource['current']",
    'password = "fixture-password-1234"',
    'SECRET="example-only-value"',
    "sops_mac=ENC[AES256_GCM,data:xyz]",
  ];
  for (const line of benign)
    assert.equal(secretHits("src/app.ts", line).length, 0, line);
  assert.equal(secretNameLike("DB_PASSWORD"), true);
  assert.equal(secretNameLike("dbPassword"), true);
  assert.equal(secretNameLike("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(secretNameLike("PASSWORD_MIN_LENGTH"), false);
  assert.equal(secretNameLike("SECRET_FILE"), false);
  assert.equal(secretNameLike("tokenBudget"), false);
});

test("R06 keeps ownership of assigned-secret findings through secretFileFindings", () => {
  const findings = secretFileFindings({
    file: "src/auth/config.ts",
    text: 'const dbPassword = "s3cr3t-v4lu3-extra";\nconst OPENAI_API_KEY = "sk-longvaluehere123";\n',
  });
  // One finding per pattern per file; both widened names matched the one `assigned-secret` code.
  assert.deepEqual(
    findings.map((f) => [f.code, f.pattern, f.line]),
    [["HFS_PLAINTEXT_SECRET", "assigned-secret", 1]],
  );
});

test("assigned-secret recognizes psql password references without admitting YAML password literals", () => {
  const references = [
    "CREATE ROLE app_be WITH LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
    'alter user "app_be" password :"selected_password";',
  ];
  for (const file of ["infra/postgres-init.sh", "db/migrations/role.sql"])
    for (const line of references) assert.deepEqual(secretHits(file, line), []);
  for (const line of ["PASSWORD: 'app_password'", "PASSWORD : 'app_password'", "PASSWORD :'app_password'"])
    assert.ok(secretHits("infra/stack.yaml", line).includes("assigned-secret"));
  assert.ok(secretHits("infra/postgres-init.sh", "CREATE ROLE app_be PASSWORD : 'app_password';").includes("assigned-secret"));
});

test("assigned-secret refuses SQL password literals and preserves later assignments and provider shapes", () => {
  const literal = ["Zk3pQ9vL2m", "X8aR5tY7uN"].join("");
  for (const verb of ["CREATE ROLE", "ALTER USER"])
    assert.ok(secretHits("infra/postgres-init.sh", `${verb} app_be PASSWORD '${literal}';`).includes("assigned-secret"));
  const reference = "CREATE ROLE app_be WITH LOGIN PASSWORD :'app_password';";
  assert.ok(secretHits("infra/postgres-init.sh", `${reference} API_SECRET='${literal}';`).includes("assigned-secret"));
  assert.ok(secretHits("infra/postgres-init.sh", `DB_PASSWORD=${literal}`).includes("assigned-secret"));
  const providerShape = ["ghp_", "A".repeat(36)].join("");
  assert.ok(secretHits("infra/postgres-init.sh", `CREATE ROLE app_be PASSWORD :'${providerShape}';`).includes("github-token"));
  const findings = secretFileFindings({
    file: "infra/postgres-init.sh",
    text: `${reference}\nALTER ROLE app_be PASSWORD '${literal}';\n`,
  });
  assert.deepEqual(findings.map(({ code, pattern, line }) => [code, pattern, line]), [["HFS_PLAINTEXT_SECRET", "assigned-secret", 2]]);
  assert.ok(!JSON.stringify(findings).includes(literal));
});

test("strict Work secret judgement retains uppercase credential refusals while source codes keep their existing judgement", () => {
  const line = "const PASSWORD = 'HIGH_ENTROPY_UPPERCASE_7281';";
  assert.deepEqual(secretHits("infra/config.mjs", line), []);
  assert.ok(secretPatternHits("infra/config.mjs", line).includes("assigned-secret"));
  assert.deepEqual(secretPatternHits("infra/postgres-init.sh", "CREATE ROLE app_be WITH LOGIN PASSWORD :'app_password';"), []);
});

test("SQL password scanning handles long role statements and repeated non-value keywords", () => {
  const options = " NOSUPERUSER".repeat(20_000);
  assert.deepEqual(secretPatternHits("infra/postgres-init.sh", `CREATE ROLE app_be${options} PASSWORD :'app_password';`), []);
  assert.deepEqual(secretPatternHits("infra/postgres-init.sh", `CREATE ROLE app_be${" PASSWORD".repeat(20_000)};`), []);
  const literal = ["Zk3pQ9vL2m", "X8aR5tY7uN"].join("");
  assert.ok(secretPatternHits("infra/postgres-init.sh", `ALTER ROLE app_be${options} PASSWORD '${literal}';`).includes("assigned-secret"));
});

test("R06 pre-commit scanner refuses widened names from the index", (t) => {
  const { root } = app(t);
  const git = (args: string[]) => {
    const result = runGit(args, { cwd: root });
    assert.equal(result.status, 0, "fixture git operation succeeds");
    return result.stdout;
  };
  git(["init", "-q"]);
  const names = ["DB_PASSWORD", "API_SECRET", "OPENAI_API_KEY", "dbPassword"];
  const value = ["Zk3pQ9vL2m", "X8aR5tY7uN"].join("");
  const files = names.map((name) => `src/${name}.ts`);
  for (const [index, file] of files.entries())
    write(root, file, `const ${names[index]} = "${value}";\n`);
  const clean = "src/clean.ts";
  write(root, clean, 'const PASSWORD_MIN_LENGTH = "123456789012";\nconst APP_SECRET_FILE = "/run/secrets/app";\nconst APP_SECRET = "fixture-password-1234";\n');
  git(["add", "--", "src"]);
  for (const file of files) write(root, file, "export const clean = true;\n");
  const staged = judge(root, [...files, clean]).findings;
  assert.deepEqual(staged.map((finding) => [finding.file, finding.code]),
    files.map((file) => [file, "HFS_PLAINTEXT_SECRET"]));
  assert.ok(!JSON.stringify(staged).includes(value));
});

for (const edition of ['lite'] as const) {
  test(`HFS_AGE_KEY_CUSTODY (${edition}): tracked identity files are refused`, (t) => {
    const { root } = app(t);
    const files = [".claude/secret.env", "sops/keys.txt", "deploy/master.agekey"];
    for (const file of files) write(root, file);
    const findings = ageKeyCustodyFindings(ctx(root, files, edition));
    assert.deepEqual(codes(findings), [
      "HFS_AGE_KEY_CUSTODY",
      "HFS_AGE_KEY_CUSTODY",
      "HFS_AGE_KEY_CUSTODY",
    ]);
  });

  test(`HFS_AGE_KEY_CUSTODY (${edition}): an untracked host identity and ordinary source files pass`, (t) => {
    const { root } = app(t);
    write(root, ".claude/secret.env", `SOPS_AGE_KEY=${PRIVATE_KEY}\n`);
    write(root, "src/index.ts");
    assert.deepEqual(
      ageKeyCustodyFindings(ctx(root, ["src/index.ts"], edition)),
      [],
    );
  });

  test(`HFS_CANON_COPY_DRIFT (${edition}): a byte-equal canon copy and a drifted one`, (t) => {
    const { root } = app(t);
    const drifted = CANON[0]!;
    const pristine = CANON[1]!;
    for (const rel of CANON)
      write(root, rel, fs.readFileSync(path.join(TEMPLATE, rel)));
    write(root, drifted, "// locally edited\n");
    const findings = canonCopyDriftFindings(ctx(root, CANON, edition));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.code, "HFS_CANON_COPY_DRIFT");
    assert.equal(findings[0]!.path, drifted);
    assert.ok(findings[0]!.expectedHash !== findings[0]!.actualHash);
    assert.ok(!findings[0]!.message.includes(fs.readFileSync(path.join(TEMPLATE, drifted), "utf8").slice(0, 40)));
    assert.equal(pristine !== drifted, true);
  });

  test(`HFS_CANON_COPY_DRIFT (${edition}): untouched canon copies and unrelated files pass`, (t) => {
    const { root } = app(t);
    for (const rel of CANON)
      write(root, rel, fs.readFileSync(path.join(TEMPLATE, rel)));
    write(root, "src/index.ts");
    assert.deepEqual(
      canonCopyDriftFindings(ctx(root, [...CANON, "src/index.ts"], edition)),
      [],
    );
  });

  test(`HFS_SECRET_PLAINTEXT_FILE (${edition}): every plaintext secret-file form is refused`, (t) => {
    const { root } = app(t);
    write(root, "secrets.env");
    write(root, "nested/secret.env");
    write(root, "deploy/prod.env", "DB_PASSWORD=hunter2hunter2hunter2\nPORT=3000\n");
    write(root, "config/app.env.local", "api_secret=s3cr3t-v4lu3-extra\n");
    write(root, "secrets/app.yaml", "token: hunter2hunter2hunter2\n");
    const files = [
      "secrets.env",
      "nested/secret.env",
      "deploy/prod.env",
      "config/app.env.local",
      "secrets/app.yaml",
    ];
    const findings = secretCustodyOnlyFindings(ctx(root, files, edition));
    assert.deepEqual(codes(findings), [
      "HFS_SECRET_PLAINTEXT_FILE",
      "HFS_SECRET_PLAINTEXT_FILE",
      "HFS_SECRET_PLAINTEXT_FILE",
      "HFS_SECRET_PLAINTEXT_FILE",
      "HFS_SECRET_PLAINTEXT_FILE",
    ]);
  });

  test(`HFS_SECRET_PLAINTEXT_FILE (${edition}): sealed custody, examples and config-only env files pass`, (t) => {
    const { root } = app(t);
    write(root, ".starcistacks/dev/secrets/app.enc", sealedDotenv(["TOKEN"]));
    write(root, "deploy/prod.env.example", "DB_PASSWORD=replace-me\n");
    write(root, "deploy/prod.env", "PORT=3000\nPASSWORD_MIN_LENGTH=16\n");
    write(root, ".starcistacks/dev/secrets/app.yaml", "token: x\n");
    write(root, "docs/readme.md");
    const files = [
      ".starcistacks/dev/secrets/app.enc",
      "deploy/prod.env.example",
      "deploy/prod.env",
      ".starcistacks/dev/secrets/app.yaml",
      "docs/readme.md",
    ];
    assert.deepEqual(
      secretCustodyOnlyFindings(ctx(root, files, edition)),
      [],
      `clean tree`,
    );
    // The invalid named-.enc still belongs to R06: this rule judges custody paths only.
    const findings = secretFileFindings({ file: "x/bad.enc", text: "plain\n" });
    assert.deepEqual(codes(findings), ["HFS_PLAINTEXT_SECRET"]);
  });
}

const PKG_RECIPIENT = `age1${"z".repeat(58)}`;
const AGE_ENTRY = (r: string) =>
  `    - recipient: ${r}\n      enc: |\n        -----BEGIN AGE ENCRYPTED FILE-----\n        YWdlLWJsb2Nr\n        -----END AGE ENCRYPTED FILE-----\n`;
const sealedPackageYaml = (keys: string[], recipients: string[] = [PKG_RECIPIENT]) =>
  keys.map((key: string) => `${key}: ${ENC}`).join("\n") +
  `\nsops:\n  age:\n${recipients.map(AGE_ENTRY).join("")}` +
  `  lastmodified: "2026-01-01T00:00:00Z"\n  mac: ${ENC}\n  version: 3.13.2\n`;
const packageSops = (recipients: string = PKG_RECIPIENT) =>
  `creation_rules:\n  - path_regex: secrets/.*\.sops.yaml$\n    age: ${recipients}\n`;

for (const edition of ['lite'] as const) {
  test(`sealed package secrets (${edition}): a valid sops file matching the package recipients passes`, (t) => {
    const { root } = app(t);
    const second = `age1${"y".repeat(58)}`;
    write(root, "packages/shop/.sops.yaml", packageSops());
    write(root, "packages/shop/secrets/dev.sops.yaml", sealedPackageYaml(["OPENAI_API_KEY", "ZALO_SECRET"]));
    write(root, "packages/two/.sops.yaml", packageSops(`${PKG_RECIPIENT},${second}`));
    write(root, "packages/two/secrets/prod.sops.yaml", sealedPackageYaml(["KEY"], [second, PKG_RECIPIENT]));
    const files: string[] = ["packages/shop/secrets/dev.sops.yaml", "packages/two/secrets/prod.sops.yaml"];
    assert.deepEqual(secretCustodyOnlyFindings(ctx(root, files, edition)), []);
    // R06 reads the same file as clean too: the ENC leaves and the age block hold no plaintext.
    assert.deepEqual(
      secretFileFindings({ file: files[0]!, text: fs.readFileSync(path.join(root, files[0]!), "utf8") }),
      [],
    );
  });

  test(`HFS_PACKAGE_SECRET_NOT_SEALED (${edition}): plaintext, half-sealed or non-sops package secrets are refused`, (t) => {
    const { root } = app(t);
    write(root, "packages/shop/.sops.yaml", packageSops());
    write(root, "packages/shop/secrets/plain.sops.yaml", "OPENAI_API_KEY: hunter2hunter2hunter2\n");
    write(root, "packages/shop/secrets/half.sops.yaml", `${sealedPackageYaml(["A"])}PLAIN: visible-value\n`);
    write(root, "packages/shop/secrets/nomac.sops.yaml", `A: ${ENC}\n`);
    const files = ["plain", "half", "nomac"].map((n) => `packages/shop/secrets/${n}.sops.yaml`);
    const findings = secretCustodyOnlyFindings(ctx(root, files, edition));
    assert.deepEqual(codes(findings), Array(3).fill("HFS_PACKAGE_SECRET_NOT_SEALED"));
    assert.equal(JSON.stringify(findings).includes("hunter2"), false, "a finding never carries a value");
  });

  test(`HFS_PACKAGE_SECRET_RECIPIENT (${edition}): no recipient, a different recipient or no package .sops.yaml is refused`, (t) => {
    const { root } = app(t);
    const other = `age1${"x".repeat(58)}`;
    write(root, "packages/shop/.sops.yaml", packageSops());
    write(root, "packages/shop/secrets/none.sops.yaml", sealedPackageYaml(["A"], []));
    write(root, "packages/shop/secrets/other.sops.yaml", sealedPackageYaml(["A"], [other]));
    write(root, "packages/shop/secrets/extra.sops.yaml", sealedPackageYaml(["A"], [PKG_RECIPIENT, other]));
    write(root, "packages/bare/secrets/dev.sops.yaml", sealedPackageYaml(["A"]));
    const files = ["packages/shop/secrets/none.sops.yaml", "packages/shop/secrets/other.sops.yaml",
      "packages/shop/secrets/extra.sops.yaml", "packages/bare/secrets/dev.sops.yaml"];
    assert.deepEqual(codes(secretCustodyOnlyFindings(ctx(root, files, edition))), Array(4).fill("HFS_PACKAGE_SECRET_RECIPIENT"));
  });

  test(`HFS_SECRET_PLAINTEXT_FILE (${edition}): other plaintext members of a package secrets/ directory stay refused`, (t) => {
    const { root } = app(t);
    write(root, "packages/shop/secrets/dev.yaml", "token: hunter2hunter2hunter2\n");
    write(root, "packages/shop/secrets/dev.env", "OPENAI_API_KEY=hunter2hunter2hunter2\n");
    write(root, "packages/shop/secrets/notes.txt", "x\n");
    write(root, "packages/shop/dev.secrets.env", "OPENAI_API_KEY=hunter2hunter2hunter2\n");
    const files = ["packages/shop/secrets/dev.yaml", "packages/shop/secrets/dev.env", "packages/shop/secrets/notes.txt", "packages/shop/dev.secrets.env"];
    assert.deepEqual(codes(secretCustodyOnlyFindings(ctx(root, files, edition))), Array(4).fill("HFS_SECRET_PLAINTEXT_FILE"));
  });
}

test("HFS_SECRET_OUTSIDE_ENC: an off-home .enc is already HFS_LITE_SECRET_CUSTODY, so R277 stays silent", (t) => {
  const { root } = app(t);
  write(root, "x/app.enc", sealedDotenv(["TOKEN"]));
  assert.deepEqual(
    secretCustodyOnlyFindings(ctx(root, ["x/app.enc"], "lite")),
    [],
  );
});

for (const edition of ['lite'] as const) {
  test(`sealed custody (${edition}): nested envelopes are refused and direct members pass`, (t) => {
    const { root } = app(t);
    const nested = ".starcistacks/dev/secrets/nested/app.enc";
    const direct = ".starcistacks/dev/secrets/app.enc";
    for (const file of [nested, direct]) write(root, file, sealedDotenv(["TOKEN"]));
    const input = ctx(root, [nested, direct], edition);
    const findings = edition === "lite"
      ? sealedSecretCustodyFindings(input)
      : secretCustodyOnlyFindings(input);
    assert.deepEqual(findings.map((finding) => [finding.path, finding.code]),
      [[nested, edition === "lite" ? "HFS_LITE_SECRET_CUSTODY" : "HFS_SECRET_OUTSIDE_ENC"]]);
  });

  test(`HFS_CANON_COPY_DRIFT (${edition}): packaged runtime resolves its published templates`, async (t) => {
    const { canonCopyDriftFindings: packagedFinder } = await import(
      "../runtime/scripts/hfs/rules/canon-copy-drift.mjs"
    );
    const { root } = app(t);
    for (const rel of CANON) write(root, rel, fs.readFileSync(path.join(TEMPLATE, rel)));
    const input = ctx(root, CANON, edition);
    assert.deepEqual(packagedFinder(input), []);
    write(root, CANON[2]!, "// locally edited\n");
    assert.deepEqual(packagedFinder(input).map((finding) => [finding.path, finding.code]),
      [[CANON[2]!, "HFS_CANON_COPY_DRIFT"]]);
  });
}

// R253 judges the skeleton of the hfs the app pins, never of a newer hfs running the check: an installed copy at the pinned
// version holds the canon an app's copy must equal, and with no copy of that version at hand the check leaves it to the
// app's own run.
const pinnedApp = (t: TestContext, version: string) => {
  const { root } = app(t);
  write(root, "package.json", JSON.stringify({ name: "pinned-app", private: true, devDependencies: { "@starci/hfs": version } }));
  return root;
};
const OLDER = "0.0.1-pinned";

test("HFS_CANON_COPY_DRIFT: an app pinning an older hfs is judged by that hfs's skeleton", (t) => {
  const root = pinnedApp(t, OLDER);
  const copy = path.join(root, "node_modules", "@starci", "hfs");
  write(copy, "package.json", JSON.stringify({ name: "@starci/hfs", version: OLDER }));
  for (const rel of CANON) write(copy, path.join("templates", "be", "skeleton", rel), `// pinned ${rel}\n`);
  for (const rel of CANON) write(root, rel, `// pinned ${rel}\n`);
  assert.deepEqual(canonCopyDriftFindings(ctx(root, CANON, "full")), []);
  write(root, CANON[1]!, fs.readFileSync(path.join(TEMPLATE, CANON[1]!)));
  assert.deepEqual(canonCopyDriftFindings(ctx(root, CANON, "full")).map((finding) => [finding.path, finding.code]),
    [[CANON[1]!, "HFS_CANON_COPY_DRIFT"]]);
});

test("HFS_CANON_COPY_DRIFT: no copy of the pinned hfs at hand judges nothing against another version", (t) => {
  const root = pinnedApp(t, OLDER);
  for (const rel of CANON) write(root, rel, "// any bytes\n");
  assert.deepEqual(canonCopyDriftFindings(ctx(root, CANON, "full")), []);
});

// A runProgram double of the selected-identity contract: version probes, the `age -y` recipient derivation and
// the one sops file action. It records every call's argv and child env so the custody assertions can name them.
interface Call { args: string[]; ageKey: string | undefined; hasKeyFile: boolean }
const selectedTools = (calls: Call[]): SecretToolOverrides => ({
  resolveSops: () => process.execPath,
  resolveRealTool: () => process.execPath,
  secretEnv: () => ({ SOPS_AGE_KEY: PRIVATE_KEY }),
  runProgram: (_program: string, args: string[], options?: SpawnSyncOptions) => {
    // The selected-identity owner removes the key from the env map after the operation, so custody is
    // asserted on the snapshot taken while the child options are being built.
    calls.push({
      args: [...args],
      ageKey: options?.env?.SOPS_AGE_KEY,
      hasKeyFile: "SOPS_AGE_KEY_FILE" in (options?.env ?? {}),
    });
    const ok = (text: string) => ({
      status: 0,
      signal: null,
      error: null,
      stdout: Buffer.from(text),
      stderr: Buffer.alloc(0),
    });
    if (args[0] === "--disable-version-check") return ok("sops 3.13.2\n");
    if (args[0] === "--version") return ok("1.3.1\n");
    if (args[0] === "-y") return ok(`${RECIPIENT}\n`);
    if (args[0] === "decrypt") return ok("TOKEN=kept-private\n");
    return {
      status: 1,
      signal: null,
      error: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    };
  },
});
const keyNeverVisible = (calls: Call[], result: { out: string; err: string }, keys: string[]) => {
  for (const call of calls)
    for (const arg of call.args)
      for (const key of keys) assert.ok(!String(arg).includes(key), "key on argv");
  privateAbsent(result, keys);
};

test("SOPS_AGE_KEY of .claude/secret.env reaches the sops child env only, and wins over keys.txt", async (t) => {
  const { root, dir, env } = app(t);
  write(dir, "app.enc", sealedDotenv(["TOKEN"]));
  const keys = secretRoots(env, process.platform).identity;
  fs.mkdirSync(path.dirname(keys), { recursive: true });
  fs.writeFileSync(keys, `${OTHER_KEY}\n`, { mode: 0o600 });
  const calls: Call[] = [];
  const result = await run(["get", "--env", "dev", "app", "TOKEN", "--to-file"], {
    cwd: root,
    env,
    tools: selectedTools(calls),
  });
  assert.equal(result.code, 0, result.err);
  const decrypt = calls.find((call) => call.args[0] === "decrypt");
  assert.ok(decrypt, "sops ran once");
  assert.equal(decrypt.ageKey, PRIVATE_KEY);
  assert.equal(decrypt.hasKeyFile, false);
  for (const call of calls.filter((c) => c.args[0] !== "decrypt"))
    assert.equal(call.ageKey, undefined, "the key rides only the sops call");
  keyNeverVisible(calls, result, [PRIVATE_KEY, OTHER_KEY]);
});

test("an explicit environment SOPS_AGE_KEY is not displaced by secret.env", async (t) => {
  const { root, dir, env } = app(t);
  write(dir, "app.enc", sealedDotenv(["TOKEN"]));
  env.SOPS_AGE_KEY = OTHER_KEY;
  const calls: Call[] = [];
  const result = await run(["get", "--env", "dev", "app", "TOKEN", "--to-file"], {
    cwd: root,
    env,
    tools: selectedTools(calls),
  });
  assert.equal(result.code, 0, result.err);
  const decrypt = calls.find((call) => call.args[0] === "decrypt");
  assert.equal(decrypt!.ageKey, OTHER_KEY);
  keyNeverVisible(calls, result, [PRIVATE_KEY, OTHER_KEY]);
});

test("the CLI loads .claude/secret.env itself before considering legacy keys.txt", async (t) => {
  const { root, dir, env } = app(t);
  write(dir, "app.enc", sealedDotenv(["TOKEN"]));
  write(root, ".claude/secret.env", `SOPS_AGE_KEY=${PRIVATE_KEY}\n`);
  const keys = secretRoots(env, process.platform).identity;
  fs.mkdirSync(path.dirname(keys), { recursive: true });
  fs.writeFileSync(keys, `${OTHER_KEY}\n`, { mode: 0o600 });
  const calls: Call[] = [];
  const tools = selectedTools(calls);
  delete tools.secretEnv;
  const result = await run(["get", "--env", "dev", "app", "TOKEN", "--to-file"], {
    cwd: root, env, tools,
  });
  assert.equal(result.code, 0, "the real local credential loader resolves the identity");
  const decrypt = calls.find((call) => call.args[0] === "decrypt");
  assert.ok(decrypt);
  assert.ok(decrypt.ageKey === PRIVATE_KEY, "local identity reaches only the sops environment");
  assert.equal(decrypt.hasKeyFile, false);
  keyNeverVisible(calls, result, [PRIVATE_KEY, OTHER_KEY]);
});

test("an empty SOPS_AGE_KEY in secret.env refuses instead of falling back to keys.txt", async (t) => {
  const { root, dir, env } = app(t);
  write(dir, "app.enc", sealedDotenv(["TOKEN"]));
  const keys = secretRoots(env, process.platform).identity;
  fs.mkdirSync(path.dirname(keys), { recursive: true });
  fs.writeFileSync(keys, `${OTHER_KEY}\n`, { mode: 0o600 });
  const calls: Call[] = [];
  const tools = { ...selectedTools(calls), secretEnv: () => ({ SOPS_AGE_KEY: "" }) };
  const result = await run(["get", "--env", "dev", "app", "TOKEN", "--to-file"], {
    cwd: root,
    env,
    tools,
  });
  assert.equal(result.code, 2);
  assert.match(result.err, /SOPS_AGE_KEY/);
  assert.equal(calls.length, 0, "no sops process launches");
  privateAbsent(result, [OTHER_KEY]);
});

test("assigned-secret ignores identifiers and types in TypeScript source (DI tokens, public error codes)", () => {
  for (const line of ["readonly verifyAccessToken: VerifySupabaseAccessToken", "token: InjectionToken", "MODULE_OPTIONS_TOKEN: DATABASE_OPTIONS_TOKEN"])
    assert.deepEqual(secretHits("src/file.ts", line), [], line);
  assert.ok(secretHits(".env", "DB_PASSWORD=hunter2hunter2hunter2").includes("assigned-secret"));
});

test("assigned-secret judges source embedded in a JSON string as source: a declared name is a reference, a quoted literal is still a leak", () => {
  const seed = "packages/templates/seed/templates@0.1.0.json";
  const line = (text: string): string => `        "text": ${JSON.stringify(text)},`;
  const literal = ["Zk3pQ9vL2m", "X8aR5tY7uN"].join("");
  const declared = [
    'const SIGNER_FIELD = "apiKeySecret";',
    "const signed = reach.hmacSign({ algorithm: \"sha256\", secretField: SIGNER_FIELD, data: input });",
  ].join("\n");
  const imported = 'import { SIGNING_FIELD } from "./fields";\nreturn reach.hmacEquals({ secret: SIGNING_FIELD, message: body });';
  for (const text of [declared, imported]) assert.deepEqual(secretHits(seed, line(text)), [], text);
  // The same text outside JSON reads as written: only source files skip the unquoted form.
  assert.ok(secretHits("infra/stack.yaml", "secretField: SIGNER_FIELD_NAME").includes("assigned-secret"));
  // A quoted literal written \"...\" in the embedded source is decoded and refused, beside a declared name or alone.
  assert.ok(secretHits(seed, line(`${declared}\nconst client = { apiKey: "${literal}" };`)).includes("assigned-secret"));
  assert.ok(secretHits(seed, line(`const password = "${literal}";`)).includes("assigned-secret"));
  // An unquoted value the string does not declare, or a dotenv text carried in a string, stays a candidate.
  assert.ok(secretHits(seed, line("reach.hmacSign({ secretField: SIGNER_FIELD_NAME });")).includes("assigned-secret"));
  assert.ok(secretHits(seed, line(`DB_HOST=db\nDB_PASSWORD=${literal}\n`)).includes("assigned-secret"));
  assert.ok(secretHits(seed, line(`${declared}\nDB_PASSWORD=${literal}`)).includes("assigned-secret"), "a declared name never hides a later literal");
  // A stand-in that names itself one still passes inside the string, as it does in any file.
  assert.deepEqual(secretHits(seed, line('const apiKey = "fixture-api-key-value";')), []);
});

test("assigned-secret reads no `-- name: prose` comment line of a SQL file as an assignment, and still reads real assignments", () => {
  const literal = ["Zk3pQ9vL2m", "X8aR5tY7uN"].join("");
  const comment = "-- drop-identity-password-tokens: forward-only;\n-- mcp-call-log-api-key: forward-only;\n";
  assert.deepEqual(secretHits("db/migrations/20261114003300_drop.sql", `${comment}drop table public.identity_password_tokens;\n`), []);
  assert.ok(secretHits("infra/stack.yaml", comment).includes("assigned-secret"), "outside a SQL file the same text still matches");
  assert.ok(secretHits("db/migrations/20261114003300_drop.sql", `${comment}DB_PASSWORD=${literal}\n`).includes("assigned-secret"));
  assert.ok(secretHits("db/migrations/20261114003300_drop.sql", `-- api_secret = '${literal}'\n`).includes("assigned-secret"), "a quoted literal in a comment is still a leak");
});

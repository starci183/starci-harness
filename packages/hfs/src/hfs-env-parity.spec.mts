// hfs-env-parity.spec.mts - R248 HFS_ENV_PARITY and R249 HFS_ENV_VALUE_SHAPE: the keys the typed EnvSource readers
// consume, the keys sealed under .starcistacks/<env>/secrets/*.enc and the keys the stack declares are one set, and a
// stored value parses as its reader's type. Fixtures reproduce the nivo D2 shapes (D2-01/06/07/08 parity, D2-03 value
// shape); sealed members are dotenv sops envelopes whose key names stay cleartext.
// proves: ENV_KEY_ENVIRONMENT_NAMED@lite ENV_KEY_ENVIRONMENT_NAMED@full
// proves: ENV_REQUIRED_UNSET@lite ENV_REQUIRED_UNSET@full ENV_SEALED_UNREAD@lite ENV_SEALED_UNREAD@full
// proves: ENV_DUPLICATE@lite ENV_DUPLICATE@full ENV_PUBLIC_SEALED@lite ENV_PUBLIC_SEALED@full
// proves: ENV_EXAMPLE_DRIFT@lite ENV_EXAMPLE_DRIFT@full ENV_VALUE_SHAPE@lite ENV_VALUE_SHAPE@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { app, run, privateAbsent } from './helpers/hfs-secret-fixture.mjs';
import type { SecretSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import {
  ENV_DUPLICATE,
  ENV_EXAMPLE_DRIFT,
  ENV_PUBLIC_SEALED,
  ENV_REQUIRED_UNSET,
  ENV_SEALED_UNREAD,
  ENV_KEY_ENVIRONMENT_NAMED,
  collectEnvReads,
  envParityFindings,
} from '../runtime/scripts/hfs/rules/env-parity.mjs';
import { ENV_VALUE_SHAPE, envValueShapeFindings } from '../runtime/scripts/hfs/rules/env-value-shape.mjs';

const manifest = loadSlotManifest();
const ENC = 'ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]';
const RECIPIENT = `age1${'q'.repeat(58)}`;
const sealedDotenv = (keys: string[]) => {
  const entries = keys.map((key) => `${key}=${ENC}`).join('\n');
  return `${entries}\nsops_age__list_0__map_recipient=${RECIPIENT}\nsops_mac=${ENC}\n`;
};

const declaration = (edition: string) => ({
  hfs: 3,
  kind: 'app',
  project: `parity-${edition}`,
  ...(edition === 'lite' ? { edition: 'lite' } : {}),
  sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
});

const tree = (t: TestContext, files: Record<string, string>) => {
  const root = mkdtemp(t, 'hfs-env-parity-');
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
};

const parityOf = (root: string, files: Record<string, string>) => envParityFindings({ repoRoot: root, all: Object.keys(files), isRoot: true });
const shapeOf = (root: string, files: Record<string, string>) => envValueShapeFindings({ repoRoot: root, all: Object.keys(files), isRoot: true });
const codes = <T extends { code: string }>(findings: T[], code: string) => findings.filter((finding) => finding.code === code);
const ENV_CODES = new Set([ENV_REQUIRED_UNSET, ENV_SEALED_UNREAD, ENV_KEY_ENVIRONMENT_NAMED, ENV_DUPLICATE, ENV_PUBLIC_SEALED, ENV_EXAMPLE_DRIFT, ENV_VALUE_SHAPE]);

const envFindingsOf = (root: string, files: Record<string, string>, edition: string) => checkRepo({
  repoRoot: root,
  declaration: declaration(edition),
  manifest,
  files: Object.keys(files),
  tree: false,
}).findings.filter((finding) => ENV_CODES.has(finding.code));

// The nivo-shaped app: PRIMARY_DB_URL required like D2-02, OPENCLAW_MANAGE_AGENTS a bool like D2-03,
// OPENCLAW_TURN_TIMEOUT an optional duration (sealed under the wrong name OPENCLAW_TURN_TIMEOUT_MS like D2-06) and
// ENGINE_SHARED_SECRET a required string (D2-01).
const APP_CONFIG = `import type { EnvSource } from "@modules/platform/config"

export const parseAppConfig = (env: EnvSource) => ({
    url: env.secret("PRIMARY_DB_URL"),
    manage: env.bool("OPENCLAW_MANAGE_AGENTS"),
    timeout: env.duration("OPENCLAW_TURN_TIMEOUT", 300_000),
    shared: env.string("ENGINE_SHARED_SECRET"),
})
`;
const API_ENV = `import type { EnvSource } from "@modules/platform/config"
import { parseAppConfig } from "@modules/platform/config"
import { parseWebhookProviderConfig } from "@modules/platform/http-security"

export const readApiEnv = (env: EnvSource) => ({
    port: env.int("API_PORT"),
    app: parseAppConfig(env),
    calendar: parseWebhookProviderConfig(env, "CALENDAR"),
})
`;
const WEBHOOK_CONFIG = `import type { EnvSource } from "@modules/platform/config"

export const parseWebhookProviderConfig = (env: EnvSource, prefix: string) => ({
    secret: env.secret(\`\${prefix}_WEBHOOK_SECRET\`),
    toleranceMs: env.duration(\`\${prefix}_WEBHOOK_TOLERANCE\`, 300_000),
})
`;
const BASE = {
  'be/apps/api/src/api.env.ts': API_ENV,
  'be/src/modules/platform/config/app.config.ts': APP_CONFIG,
  'be/src/modules/platform/http-security/http-security.config.ts': WEBHOOK_CONFIG,
};
const NIVO_MEMBERS = {
  '.starcistacks/dev/secrets/engine.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'OPENCLAW_TURN_TIMEOUT_MS', 'STALE_API_TOKEN', 'LEGACY_SMTP_PASSWORD']),
};

for (const edition of ['lite', 'full']) {
  test(`every env code rejects its violating fixture through checkRepo (${edition})`, (t) => {
    const files = {
      ...BASE,
      ...NIVO_MEMBERS,
      '.starcistacks/dev/secrets/duplicate.enc': sealedDotenv(['ENGINE_SHARED_SECRET']),
      '.starcistacks/dev/secrets/web.enc': sealedDotenv(['NEXT_PUBLIC_API_URL']),
      '.starcistacks/dev/secrets/named.enc': sealedDotenv(['DEV_MAIL_TOKEN']),
      'deploy/app.env.example': 'OPENCLAW_MANAGE_AGENTS=1\nQUEUE_RELAY_INTERVAL=200ms\n',
    };
    const findings = envFindingsOf(tree(t, files), files, edition);
    for (const code of ENV_CODES) {
      assert.ok(findings.some((finding) => finding.code === code), `${edition} must report ${code}`);
    }
    assert.ok(findings.every((finding) => finding.level === 'error'));
  });

  test(`every env code accepts its passing fixture through checkRepo (${edition})`, (t) => {
    const files = {
      ...BASE,
      '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
      '.starcistacks/dev/infra/compose/api.yaml': 'services:\n  api:\n    environment:\n      - API_PORT=3000\n      - CALENDAR_WEBHOOK_SECRET_FILE=/run/secrets/calendar\n',
      'deploy/app.env.example': 'API_PORT=3000\nOPENCLAW_MANAGE_AGENTS=false\nOPENCLAW_TURN_TIMEOUT=30s\nPRIMARY_DB_URL=<database-location>\n',
    };
    assert.deepEqual(envFindingsOf(tree(t, files), files, edition), []);
  });

  test(`required keys sealed in dev and production are valid (${edition})`, (t) => {
    const member = sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']);
    const files = {
      ...BASE,
      '.starcistacks/dev/secrets/app.enc': member,
      '.starcistacks/production/secrets/app.enc': member,
      '.starcistacks/dev/runtime/env/KEYS.md': '| `API_PORT` | port |\n',
    };
    assert.deepEqual(envFindingsOf(tree(t, files), files, edition), []);
  });

  test(`each environment rejects a key sealed in two of its members (${edition})`, (t) => {
    const member = sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']);
    const files = {
      ...BASE,
      '.starcistacks/dev/secrets/app.enc': member,
      '.starcistacks/dev/secrets/engine.enc': sealedDotenv(['ENGINE_SHARED_SECRET']),
      '.starcistacks/production/secrets/app.enc': member,
      '.starcistacks/production/secrets/engine.enc': sealedDotenv(['ENGINE_SHARED_SECRET']),
      '.starcistacks/dev/runtime/env/KEYS.md': '| `API_PORT` | port |\n',
    };
    const findings = envFindingsOf(tree(t, files), files, edition);
    assert.ok(findings.every((finding) => finding.code === ENV_DUPLICATE));
    assert.deepEqual(findings.map((finding) => finding.path), [
      '.starcistacks/dev/secrets/engine.enc',
      '.starcistacks/production/secrets/engine.enc',
    ]);
  });
}

test('env parity flags required reads neither sealed nor declared and sealed keys nobody reads (lite)', (t) => {
  const files = { ...BASE, ...NIVO_MEMBERS };
  const root = tree(t, files);
  const findings = parityOf(root, files);
  assert.deepEqual(
    codes(findings, ENV_REQUIRED_UNSET).map((f) => f.message.match(/required (\w+)/)![1]!).sort(byCodeUnit),
    ['API_PORT', 'CALENDAR_WEBHOOK_SECRET', 'OPENCLAW_MANAGE_AGENTS', 'PRIMARY_DB_URL'],
  );
  assert.deepEqual(
    codes(findings, ENV_SEALED_UNREAD).map((f) => f.message.match(/seals (\w+)/)![1]!).sort(byCodeUnit),
    ['LEGACY_SMTP_PASSWORD', 'OPENCLAW_TURN_TIMEOUT_MS', 'STALE_API_TOKEN'],
  );
  assert.deepEqual(codes(findings, ENV_DUPLICATE), []);
  assert.deepEqual(codes(findings, ENV_PUBLIC_SEALED), []);
  assert.deepEqual(codes(findings, ENV_EXAMPLE_DRIFT), []);
});

test('env parity is clean in lite when every required read is sealed or declared (lite)', (t) => {
  const files = {
    ...BASE,
    '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
    '.starcistacks/application-stacks.yaml': 'schema: starci/application-stacks@1\nenvironments:\n  dev:\n    services:\n      api:\n        environment:\n          API_PORT: "3000"\n',
  };
  const root = tree(t, files);
  assert.deepEqual(parityOf(root, files), []);
  const judged = checkRepo({ repoRoot: root, declaration: declaration('lite'), manifest, files: Object.keys(files), tree: false }).findings;
  assert.deepEqual(judged.filter((finding) => ENV_CODES.has(finding.code)), []);
});

test('env parity reports the same violations through checkRepo under both editions', (t) => {
  const files = { ...BASE, ...NIVO_MEMBERS };
  for (const edition of ['lite', 'full']) {
    const root = tree(t, files);
    const findings = checkRepo({ repoRoot: root, declaration: declaration(edition), manifest, files: Object.keys(files), tree: false }).findings;
    assert.ok(findings.some((finding) => finding.code === ENV_REQUIRED_UNSET), `${edition} judges ENV_REQUIRED_UNSET`);
    assert.ok(findings.some((finding) => finding.code === ENV_SEALED_UNREAD), `${edition} judges ENV_SEALED_UNREAD`);
  }
});

test('env parity is clean in full when the roster and the stack declare the required reads', (t) => {
  const files = {
    ...BASE,
    '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
    '.starcistacks/dev/infra/compose/api.yaml': 'services:\n  api:\n    environment:\n      API_PORT: "3000"\n',
    '.starcistacks/dev/runtime/env/KEYS.md': '# Keys\n\n| Key | Meaning |\n| --- | --- |\n| `API_PORT` | port |\n| `PRIMARY_DB_URL` | database (secret) |\n',
  };
  const root = tree(t, files);
  assert.deepEqual(parityOf(root, files), []);
});

test('a key sealed in two members is ENV_DUPLICATE', (t) => {
  const files = {
    ...BASE,
    '.starcistacks/dev/secrets/engine.enc': sealedDotenv(['ENGINE_SHARED_SECRET']),
    '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
    '.starcistacks/dev/runtime/env/KEYS.md': '| `API_PORT` | port |\n',
  };
  const root = tree(t, files);
  const duplicates = codes(parityOf(root, files), ENV_DUPLICATE);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0]!.path, '.starcistacks/dev/secrets/engine.enc');
  assert.match(duplicates[0]!.message, /ENGINE_SHARED_SECRET/);
});

test('a NEXT_PUBLIC_ key in custody is ENV_PUBLIC_SEALED', (t) => {
  const files = {
    ...BASE,
    '.starcistacks/dev/secrets/web.enc': sealedDotenv(['NEXT_PUBLIC_API_URL']),
    '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
    '.starcistacks/dev/runtime/env/KEYS.md': '| `API_PORT` | port |\n',
  };
  const root = tree(t, files);
  const findings = parityOf(root, files);
  assert.deepEqual(codes(findings, ENV_PUBLIC_SEALED).map((f) => f.path), ['.starcistacks/dev/secrets/web.enc']);
  assert.ok(codes(findings, ENV_SEALED_UNREAD).every((f) => !/NEXT_PUBLIC_API_URL/.test(f.message)), 'the specific public-custody code wins over sealed-unread');
});

test('an env example key nothing reads is ENV_EXAMPLE_DRIFT', (t) => {
  const files = {
    ...BASE,
    'deploy/app.env.example': 'API_PORT=3000\nPRIMARY_DB_URL=<postgres-url>\nQUEUE_RELAY_INTERVAL=200ms\nQUEUE_RELAY_BATCH=50\n',
  };
  const root = tree(t, files);
  const drift = codes(parityOf(root, files), ENV_EXAMPLE_DRIFT);
  assert.deepEqual(drift.map((f) => f.message.match(/names (\w+)/)![1]!).sort(byCodeUnit), ['QUEUE_RELAY_BATCH', 'QUEUE_RELAY_INTERVAL']);
});

test('an env example value that cannot parse is ENV_VALUE_SHAPE (the nivo D2-03 bool shape)', (t) => {
  const files = {
    ...BASE,
    'deploy/app.env.example': 'API_PORT=3000\nOPENCLAW_MANAGE_AGENTS=1\nPRIMARY_DB_URL=<postgres-url>\n',
  };
  const root = tree(t, files);
  const findings = shapeOf(root, files);
  assert.deepEqual(codes(findings, ENV_VALUE_SHAPE).map((f) => f.message.match(/gives (\w+)/)![1]), ['OPENCLAW_MANAGE_AGENTS']);
});

test('an env example of concrete parseable values raises no ENV_VALUE_SHAPE', (t) => {
  const files = {
    ...BASE,
    'deploy/app.env.example': 'API_PORT=3000\nOPENCLAW_MANAGE_AGENTS=true\nPRIMARY_DB_URL=postgres://app:example@db:5432/app\nOPENCLAW_TURN_TIMEOUT=30s\n',
  };
  const root = tree(t, files);
  assert.deepEqual(codes(shapeOf(root, files), ENV_VALUE_SHAPE), []);
});

test('the static walk resolves template keys through the reader call sites', (t) => {
  const files = { ...BASE };
  const root = tree(t, files);
  const reads = collectEnvReads(root, Object.keys(files));
  assert.equal(reads!.get('CALENDAR_WEBHOOK_SECRET')?.required, true);
  assert.equal(reads!.get('CALENDAR_WEBHOOK_TOLERANCE')?.required, false);
  assert.equal(reads!.get('OPENCLAW_TURN_TIMEOUT')?.required, false);
  assert.equal(reads!.get('OPENCLAW_MANAGE_AGENTS')?.shape?.kind, 'bool');
  const files2 = { ...BASE, '.starcistacks/dev/secrets/hook.enc': sealedDotenv(['CALENDAR_WEBHOOK_SECRET']) };
  const root2 = tree(t, files2);
  assert.ok(codes(parityOf(root2, files2), ENV_REQUIRED_UNSET).every((f) => !/CALENDAR_WEBHOOK_SECRET/.test(f.message)));
});

function fakeSops(plain: Record<string, Record<string, string | undefined>> = {}): SecretSops {
  return {
    decrypt: (file: string) => ({ ...plain[path.basename(file)] }),
    seal: () => assert.fail('verify must not seal'),
  } as unknown as SecretSops; // reason: verify reads only decrypt, and must never seal
}

test('starci app secret verify names key and violated shape and never prints a value', async (t) => {
  const { root, env } = app(t, { 'app.enc': sealedDotenv(['OPENCLAW_MANAGE_AGENTS', 'API_PORT', 'PRIMARY_DB_URL']) });
  for (const [file, text] of Object.entries(BASE)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const sops = fakeSops({ 'app.enc': { OPENCLAW_MANAGE_AGENTS: 'private-bad-bool-1', API_PORT: 'private-bad-port-x', PRIMARY_DB_URL: 'private-db-location' } });
  const result = await run(['verify', '--env', 'dev'], { cwd: root, env, sops });
  assert.equal(result.code, 2);
  assert.match(result.out, /ENV_VALUE_SHAPE dev\/app\.enc: OPENCLAW_MANAGE_AGENTS is not true or false/);
  assert.match(result.out, /ENV_VALUE_SHAPE dev\/app\.enc: API_PORT is not an integer/);
  privateAbsent(result, ['private-bad-bool-1', 'private-bad-port-x', 'private-db-location']);
});

test('starci app secret verify exits clean when every sealed value parses', async (t) => {
  const { root, env } = app(t, { 'app.enc': sealedDotenv(['OPENCLAW_MANAGE_AGENTS', 'API_PORT', 'PRIMARY_DB_URL']) });
  for (const [file, text] of Object.entries(BASE)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const sops = fakeSops({ 'app.enc': { OPENCLAW_MANAGE_AGENTS: 'true', API_PORT: '3000', PRIMARY_DB_URL: 'private-db-location' } });
  const result = await run(['verify', '--env', 'dev'], { cwd: root, env, sops });
  assert.equal(result.code, 0);
  assert.match(result.out, /verified dev: 3 keys sealed/);
  privateAbsent(result, ['private-db-location']);
  assert.equal((await run(['verify'], { cwd: root, env, sops })).code, 2);
});

const SHAPE_CONFIG = `import type { EnvSource } from "@modules/platform/config"
export function readApiEnv(env: EnvSource) {
  return {
    port: env.int("API_PORT"),
    enabled: env.bool("FEATURE_ENABLED"),
    endpoint: env.url("PROVIDER_URL"),
    timeout: env.duration("REQUEST_TIMEOUT"),
    mode: env.enum("RUN_MODE", ["local", "remote"]),
    token: env.secret("PROVIDER_TOKEN"),
  }
}
`;

test('verify checks every reader shape across members without changing sealed storage', async (t) => {
  const values = {
    API_PORT: '3000',
    FEATURE_ENABLED: 'false',
    PROVIDER_URL: 'https://example.invalid',
    REQUEST_TIMEOUT: '30s',
    RUN_MODE: 'remote',
    PROVIDER_TOKEN: 'fixture-token-only',
  };
  const files = {
    'api.enc': sealedDotenv(['API_PORT', 'FEATURE_ENABLED', 'REQUEST_TIMEOUT']),
    'provider.enc': sealedDotenv(['PROVIDER_URL', 'RUN_MODE', 'PROVIDER_TOKEN']),
  };
  const { root, dir, env } = app(t, files);
  const source = path.join(root, 'be/apps/api/src/api.env.ts');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, SHAPE_CONFIG);
  const plain = {
    'api.enc': { API_PORT: values.API_PORT, FEATURE_ENABLED: values.FEATURE_ENABLED, REQUEST_TIMEOUT: values.REQUEST_TIMEOUT },
    'provider.enc': { PROVIDER_URL: values.PROVIDER_URL, RUN_MODE: values.RUN_MODE, PROVIDER_TOKEN: values.PROVIDER_TOKEN },
  };
  const passing = await run(['verify', '--env', 'dev'], { cwd: root, env, sops: fakeSops(plain) });
  assert.equal(passing.code, 0);
  assert.match(passing.out, /verified dev: 6 keys sealed/);
  privateAbsent(passing, Object.values(values));

  const invalid = Object.fromEntries(Object.keys(values).map((key) => [key, `fixture-invalid-${key}`]));
  invalid.PROVIDER_TOKEN = '';
  const failing = await run(['verify', '--env', 'dev'], {
    cwd: root,
    env,
    sops: fakeSops({
      'api.enc': { API_PORT: invalid.API_PORT, FEATURE_ENABLED: invalid.FEATURE_ENABLED, REQUEST_TIMEOUT: invalid.REQUEST_TIMEOUT },
      'provider.enc': { PROVIDER_URL: invalid.PROVIDER_URL, RUN_MODE: invalid.RUN_MODE, PROVIDER_TOKEN: invalid.PROVIDER_TOKEN },
    }),
  });
  assert.equal(failing.code, 2);
  assert.equal(failing.out.trim().split('\n').length, 6);
  for (const key of Object.keys(values)) assert.ok(failing.out.includes(`${key} is not `));
  privateAbsent(failing, Object.values(invalid));
  for (const [name, text] of Object.entries(files)) assert.ok(fs.readFileSync(path.join(dir, name), 'utf8') === text);
  assert.deepEqual(fs.readdirSync(dir).sort(byCodeUnit), ['api.enc', 'provider.enc']);
});

test('verify sanitizes an unexpected decrypt failure without printing its message', async (t) => {
  const { root, env } = app(t, { 'app.enc': sealedDotenv(['PROVIDER_TOKEN']) });
  const privateMessage = 'fixture-private-decrypt-message';
  const sops = {
    decrypt: () => { throw new Error(privateMessage); },
    seal: () => assert.fail('verify must not seal'),
  } as unknown as SecretSops; // reason: verify reads only decrypt, and must never seal
  const result = await run(['verify', '--env', 'dev'], { cwd: root, env, sops });
  assert.equal(result.code, 2);
  assert.match(result.err, /operation failed/);
  privateAbsent(result, [privateMessage]);
});

// An environment has two SSH transports by design, the operator's member named by deploy.remote.sealed and the CI member
// vps-ci. They never reach an app container, so ENV_DUPLICATE exempts exactly the SSH group keys in exactly those two members of that environment.
const STACKS_VPS = 'schema: starci/application-stacks@1\nenvironments:\n  production:\n    deploy:\n      remote:\n        sealed: vps\n';
const TRANSPORT = ['VPS_HOST', 'VPS_USER'];
const transportFiles = (extra: Record<string, string>) => ({
  ...BASE,
  '.starcistacks/application-stacks.yaml': STACKS_VPS,
  '.starcistacks/production/secrets/vps.enc': sealedDotenv([...TRANSPORT, 'privateKey', 'knownHosts']),
  '.starcistacks/production/secrets/vps-ci.enc': sealedDotenv([...TRANSPORT, 'VPS_SSH_KEY', 'VPS_KNOWN_HOSTS']),
  ...extra,
});

for (const edition of ['lite', 'full']) {
  test(`the SSH group keys in the sealed operator member and vps-ci are not ENV_DUPLICATE (${edition})`, (t) => {
    const files = transportFiles({});
    assert.deepEqual(codes(envFindingsOf(tree(t, files), files, edition), ENV_DUPLICATE), []);
  });

  test(`an app key in vps and vps-ci, or an SSH group key in a third member, stays ENV_DUPLICATE (${edition})`, (t) => {
    const appKey = transportFiles({
      '.starcistacks/production/secrets/vps.enc': sealedDotenv([...TRANSPORT, 'privateKey', 'knownHosts', 'ENGINE_SHARED_SECRET']),
      '.starcistacks/production/secrets/vps-ci.enc': sealedDotenv([...TRANSPORT, 'VPS_SSH_KEY', 'VPS_KNOWN_HOSTS', 'ENGINE_SHARED_SECRET']),
    });
    const appDuplicates = codes(envFindingsOf(tree(t, appKey), appKey, edition), ENV_DUPLICATE);
    assert.equal(appDuplicates.length, 1);
    assert.match(String(appDuplicates[0]!.message), /ENGINE_SHARED_SECRET/u);
    for (const third of ['app', 'zzz']) {
      const files = transportFiles({ [`.starcistacks/production/secrets/${third}.enc`]: sealedDotenv(['VPS_HOST']) });
      const duplicates = codes(envFindingsOf(tree(t, files), files, edition), ENV_DUPLICATE);
      assert.ok(duplicates.length >= 1 && duplicates.every((finding) => /VPS_HOST/u.test(String(finding.message))), `${edition} ${third}`);
    }
  });

  test(`the exemption belongs to the member deploy.remote.sealed names, in its own environment (${edition})`, (t) => {
    const otherName = transportFiles({ '.starcistacks/application-stacks.yaml': STACKS_VPS.replace('sealed: vps', 'sealed: ops') });
    assert.equal(codes(envFindingsOf(tree(t, otherName), otherName, edition), ENV_DUPLICATE).length, 2);
    const otherEnvironment = transportFiles({ '.starcistacks/application-stacks.yaml': STACKS_VPS.replace('production', 'staging') });
    assert.equal(codes(envFindingsOf(tree(t, otherEnvironment), otherEnvironment, edition), ENV_DUPLICATE).length, 2);
  });
}

test('a seeds-<name> member that seed data references is read: an environment level reads its own, the shared level every environment\'s', (t) => {
  const member = (keys: string[]) => `${keys.map((key) => `${key}: ENC[AES256_GCM,data:eA==,iv:aXY=,tag:dGc=,type:str]`).join('\n')}\nsops:\n  age:\n    - recipient: age1fake\n`;
  const files = {
    ...BASE,
    '.starcistacks/dev/secrets/app.enc': sealedDotenv(['ENGINE_SHARED_SECRET', 'PRIMARY_DB_URL', 'OPENCLAW_MANAGE_AGENTS', 'CALENDAR_WEBHOOK_SECRET']),
    '.starcistacks/application-stacks.yaml': 'schema: starci/application-stacks@1\nenvironments:\n  dev:\n    services:\n      api:\n        environment:\n          API_PORT: "3000"\n',
    '.starcistacks/production/seeds/data/owner.json': JSON.stringify({ password: { secret: 'seeds-test-owner' } }),
    '.starcistacks/seeds/data/catalogue.yaml': 'token:\n  secret: seeds-catalogue\n',
    '.starcistacks/seeds/data/broken.json': '{ not json',
    '.starcistacks/production/secrets/seeds-test-owner.enc.yaml': member(['value']),
    '.starcistacks/dev/secrets/seeds-catalogue.enc.yaml': member(['TOKEN']),
    '.starcistacks/production/secrets/seeds-catalogue.enc.yaml': member(['TOKEN']),
    '.starcistacks/dev/secrets/seeds-test-owner.enc.yaml': member(['value']),
  };
  const findings = parityOf(tree(t, files), files);
  assert.deepEqual(codes(findings, ENV_SEALED_UNREAD).map((finding) => finding.path), ['.starcistacks/dev/secrets/seeds-test-owner.enc.yaml'], 'production\'s account member is read there only');
});

for (const edition of ['lite', 'full']) {
  test(`a sealed key the dev stack's own database declaration reads is consumed; the same key listed only in custody is still ENV_SEALED_UNREAD (${edition})`, (t) => {
    const member = '.starcistacks/dev/secrets/db.enc';
    const stacks = (local: string): string => `schema: starci/application-stacks@1\nenvironments:\n  dev:\n    local:\n${local}`;
    const database = '      database:\n        password: { member: db, key: DB_OWNER_PASSWORD }\n        adminPassword: { member: db, key: DB_ADMIN_PASSWORD }\n';
    const sealedUnread = (files: Record<string, string>): string[] => {
      const root = tree(t, files);
      const messages = edition === 'lite'
        ? codes(parityOf(root, files), ENV_SEALED_UNREAD).map((finding) => finding.message)
        : codes(envFindingsOf(root, { ...files, 'hfs.json': JSON.stringify(declaration(edition)) }, edition), ENV_SEALED_UNREAD).map((finding) => String(finding.message));
      return messages.map((message) => message.match(/seals (\w+)/)![1]!).sort(byCodeUnit);
    };
    const sealed = { [member]: sealedDotenv(['DB_OWNER_PASSWORD', 'DB_ADMIN_PASSWORD', 'DB_NOBODY_READS']) };
    assert.deepEqual(sealedUnread({ ...sealed, '.starcistacks/application-stacks.yaml': stacks(database) }), ['DB_NOBODY_READS'], 'stack up reads the two database passwords; a third key of the member is still unread');
    assert.deepEqual(sealedUnread({ ...sealed, '.starcistacks/application-stacks.yaml': stacks('      custody:\n        - { member: db, key: DB_OWNER_PASSWORD }\n        - { member: db, key: DB_ADMIN_PASSWORD }\n') }),
      ['DB_ADMIN_PASSWORD', 'DB_NOBODY_READS', 'DB_OWNER_PASSWORD'], 'custody says how a key is held, never who reads it');
    assert.deepEqual(sealedUnread({ ...sealed, '.starcistacks/application-stacks.yaml': stacks(database.replaceAll('member: db', 'member: other')) }),
      ['DB_ADMIN_PASSWORD', 'DB_NOBODY_READS', 'DB_OWNER_PASSWORD'], 'the declaration names another member: this member\'s keys are unread');
    assert.deepEqual(sealedUnread({ ...sealed, '.starcistacks/application-stacks.yaml': stacks(database).replace('  dev:', '  staging:') }),
      ['DB_ADMIN_PASSWORD', 'DB_NOBODY_READS', 'DB_OWNER_PASSWORD'], 'another environment\'s declaration reads another environment\'s member');
  });
}

for (const edition of ['lite', 'full']) {
  test(`a key carries no environment in its name: a sealed or declared key with a leading environment token is ENV_KEY_ENVIRONMENT_NAMED, naming the bare key (${edition})`, (t) => {
    const files = {
      '.starcistacks/dev/secrets/db.enc': sealedDotenv(['DB_OWNER_PASSWORD', 'DEV_MAIL_TOKEN', 'DEV_DB_OWNER_PASSWORD', 'DEVICE_TOKEN']),
      '.starcistacks/production/secrets/db.enc': sealedDotenv(['PROD_API_TOKEN', 'PRODUCTION_SIGNING_KEY', 'STAGING_X', 'LOCAL_Y', 'TEST_Z']),
      '.starcistacks/application-stacks.yaml': 'schema: starci/application-stacks@1\nenvironments:\n  dev:\n    local:\n      database:\n        password: { member: db, key: DEV_DB_OWNER_PASSWORD }\n        adminPassword: { member: db, key: DB_OWNER_PASSWORD }\n        appPassword: { member: db, key: DEV_DB_APP_PASSWORD }\n',
    };
    const root = tree(t, files);
    const named = edition === 'lite'
      ? parityOf(root, files).filter((finding) => finding.code === ENV_KEY_ENVIRONMENT_NAMED).map((finding) => [finding.path, finding.level, finding.message])
      : envFindingsOf(root, { ...files, 'hfs.json': JSON.stringify(declaration(edition)) }, edition).filter((finding) => finding.code === ENV_KEY_ENVIRONMENT_NAMED).map((finding) => [String(finding.path), finding.level, String(finding.message)]);
    const told = named.map(([file, level, message]) => `${String(level)} ${String(file)} ${/names the key (\w+)/u.exec(String(message))?.[1] ?? '?'} -> ${/name it (\w+)/u.exec(String(message))?.[1] ?? '?'}`).sort(byCodeUnit);
    assert.deepEqual(told, [
      'error .starcistacks/dev/secrets/db.enc DEV_MAIL_TOKEN -> MAIL_TOKEN',
      'error .starcistacks/production/secrets/db.enc LOCAL_Y -> Y',
      'error .starcistacks/production/secrets/db.enc PRODUCTION_SIGNING_KEY -> SIGNING_KEY',
      'error .starcistacks/production/secrets/db.enc PROD_API_TOKEN -> API_TOKEN',
      'error .starcistacks/production/secrets/db.enc STAGING_X -> X',
      'error .starcistacks/production/secrets/db.enc TEST_Z -> Z',
      'warning .starcistacks/application-stacks.yaml DEV_DB_APP_PASSWORD -> DB_APP_PASSWORD',
      'warning .starcistacks/application-stacks.yaml DEV_DB_OWNER_PASSWORD -> DB_OWNER_PASSWORD',
      'warning .starcistacks/dev/secrets/db.enc DEV_DB_OWNER_PASSWORD -> DB_OWNER_PASSWORD',
    ], 'an exact leading token is refused; DEVICE_TOKEN and DB_OWNER_PASSWORD are no environment names; the two names the starter shipped are a warning for one minor');
    assert.match(String(named.find(([, level]) => level === 'warning')?.[2]), /starci app sync/u, 'the warning names where the rename notice comes from');
  });
}

test('starci app sync names each file that still holds a starter key named after an environment, the name it takes and who seals the value; it renames nothing', async (t) => {
  const { environmentKeyNotices } = await import('../sync/harness-checks.mjs');
  const stacks = 'environments:\n  dev:\n    local:\n      database:\n        password: { member: db, key: DEV_DB_OWNER_PASSWORD }\n';
  const files = {
    '.starcistacks/application-stacks.yaml': stacks,
    '.starcistacks/dev/runtime/env/KEYS.md': '| `DEV_DB_OWNER_PASSWORD` | the owner role |\n| `DEV_DB_APP_PASSWORD` | the app role |\n',
    '.starcistacks/dev/secrets/db.enc': sealedDotenv(['DEV_DB_OWNER_PASSWORD']),
  };
  const root = tree(t, files);
  const notices = environmentKeyNotices(root);
  assert.equal(notices.length, 2);
  assert.match(notices[0] ?? '', /^notice: the key DEV_DB_OWNER_PASSWORD is named after an environment .* rename it to DB_OWNER_PASSWORD in \.starcistacks\/application-stacks\.yaml, \.starcistacks\/dev\/runtime\/env\/KEYS\.md, then seal the value under the new name with `starci app secret init --env <env> --execute`/u);
  assert.match(notices[1] ?? '', /DEV_DB_APP_PASSWORD .* rename it to DB_APP_PASSWORD in \.starcistacks\/dev\/runtime\/env\/KEYS\.md,/u);
  assert.ok(!notices.join('\n').includes('secrets/db.enc'), 'a sealed member is never read or named for a rewrite');
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), 'utf8'), stacks, 'nothing renamed');
  assert.deepEqual(environmentKeyNotices(tree(t, { '.starcistacks/application-stacks.yaml': stacks.replace('DEV_DB_OWNER_PASSWORD', 'DB_OWNER_PASSWORD') })), []);
});

// `starci app codemod auth-merge`: @starci/auth-oidc is retired into @starci/auth. Every import of the package and its entries is
// rewritten to the entry of @starci/auth that holds it, every manifest that required it requires @starci/auth at its pin, a dry run
// writes nothing, --execute writes, a second run finds nothing, and a subpath with no new home is left for a person.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { AUTH_MERGE_ENTRIES, authMergeMarkdown, migrateAuthMerge, transformAuthMerge, transformManifest } from '../codemod/auth-merge.mjs';
import { canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';

const GLUE = `import { OidcModule } from "@starci/auth-oidc/server"
import type { OidcOptions } from '@starci/auth-oidc'
export const keycloakModule = (options: OidcOptions) => OidcModule.register(options)
`;
const GLUE_SPEC = `import { FakeOidcIssuer } from "@starci/auth-oidc/testing"
jest.mock("@starci/auth-oidc/server")
export const issuer = () => FakeOidcIssuer.create()
`;
const CLIENT = `import { createOidcClient } from "@starci/auth-oidc/client"
export const auth = createOidcClient({ issuer: "https://idp.test/realms/t", clientId: "web", redirectUri: "https://app.test/cb" })
`;

/** A full app root that still uses @starci/auth-oidc in its glue, its spec, its web client and its manifests, in a temp folder. */
function fullApp(extra: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-auth-merge-'));
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', `${JSON.stringify({ name: 'app', dependencies: { '@starci/auth-oidc': '0.2.0', zod: '4.0.0' } }, null, 2)}\n`);
  write('fe/apps/web/package.json', `${JSON.stringify({ name: '@app/web', dependencies: { '@starci/auth': '0.5.0', '@starci/auth-oidc': '0.2.0', next: '16.0.0' } }, null, 2)}\n`);
  write('be/src/modules/integrations/keycloak/keycloak.registration.ts', GLUE);
  write('be/src/tests/integration/keycloak/keycloak.spec.ts', GLUE_SPEC);
  write('fe/apps/web/src/modules/auth/client.ts', CLIENT);
  write('be/src/modules/domain/order/order.service.ts', 'export const unrelated = "@starci/authentic"\n');
  write('be/node_modules/@starci/auth-oidc/index.js', 'export * from "@starci/auth-oidc/server"\n');
  for (const [file, text] of Object.entries(extra)) write(file, text);
  return root;
}
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = (root: string, file: string) => JSON.parse(read(root, file)) as { dependencies: Record<string, string> }; // reason: parsed manifest of the fixture

test('auth-merge is one of the codemods, and each retired entry has a home in @starci/auth', () => {
  assert.ok(CODEMODS.includes('auth-merge'));
  assert.deepEqual(AUTH_MERGE_ENTRIES, {
    '@starci/auth-oidc': '@starci/auth/oidc',
    '@starci/auth-oidc/server': '@starci/auth/oidc',
    '@starci/auth-oidc/contracts': '@starci/auth/oidc',
    '@starci/auth-oidc/client': '@starci/auth/client/oidc',
    '@starci/auth-oidc/testing': '@starci/auth/testing',
  });
});

test('a dry run reports every rewrite and writes nothing', () => {
  const root = fullApp();
  const report = migrateAuthMerge({ root });
  assert.equal(report.write, false);
  assert.deepEqual(report.filesChanged.sort(), [
    'be/src/modules/integrations/keycloak/keycloak.registration.ts',
    'be/src/tests/integration/keycloak/keycloak.spec.ts',
    'fe/apps/web/package.json',
    'fe/apps/web/src/modules/auth/client.ts',
    'package.json',
  ]);
  assert.deepEqual(report.findings, []);
  assert.equal(read(root, 'be/src/modules/integrations/keycloak/keycloak.registration.ts'), GLUE);
  assert.equal(manifest(root, 'package.json').dependencies['@starci/auth-oidc'], '0.2.0');
  assert.equal(report.dependency.version, canonPins()['@starci/auth']?.version);
  assert.match(authMergeMarkdown(report), /would be rewritten/);
});

test('--execute rewrites the imports, the mocks and the manifests, and leaves installed packages and look-alikes alone', () => {
  const root = fullApp();
  const report = migrateAuthMerge({ root, write: true });
  assert.deepEqual(report.findings, []);
  assert.equal(read(root, 'be/src/modules/integrations/keycloak/keycloak.registration.ts'), GLUE.replace('"@starci/auth-oidc/server"', '"@starci/auth/oidc"').replace("'@starci/auth-oidc'", "'@starci/auth/oidc'"));
  assert.equal(read(root, 'be/src/tests/integration/keycloak/keycloak.spec.ts'), 'import { FakeOidcIssuer } from "@starci/auth/testing"\njest.mock("@starci/auth/oidc")\nexport const issuer = () => FakeOidcIssuer.create()\n');
  assert.match(read(root, 'fe/apps/web/src/modules/auth/client.ts'), /^import \{ createOidcClient \} from "@starci\/auth\/client\/oidc"\n/);
  assert.equal(read(root, 'be/src/modules/domain/order/order.service.ts'), 'export const unrelated = "@starci/authentic"\n');
  assert.equal(read(root, 'be/node_modules/@starci/auth-oidc/index.js'), 'export * from "@starci/auth-oidc/server"\n');
  const pin = canonPins()['@starci/auth']?.version ?? '';
  assert.deepEqual(manifest(root, 'package.json').dependencies, { '@starci/auth': pin, zod: '4.0.0' });
  assert.deepEqual(manifest(root, 'fe/apps/web/package.json').dependencies, { '@starci/auth': pin, next: '16.0.0' }, 'an older exact @starci/auth is raised to the pin');
  assert.match(authMergeMarkdown(report), /rewritten.*\n[^]*run npm install/);
});

test('a second run finds nothing to do', () => {
  const root = fullApp();
  migrateAuthMerge({ root, write: true });
  const again = migrateAuthMerge({ root, write: true });
  assert.deepEqual(again.filesChanged, []);
  assert.deepEqual(again.findings, []);
});

test('a subpath with no home in @starci/auth and two imports of one module after the rewrite are left for a person', () => {
  const root = fullApp({
    'be/src/modules/integrations/keycloak/keycloak.options.ts': 'import pkg from "@starci/auth-oidc/package.json"\nimport { OIDC_CLAIMS } from "@starci/auth-oidc/contracts"\nimport { createOidc } from "@starci/auth-oidc/server"\nexport const c = [pkg, OIDC_CLAIMS, createOidc]\n',
  });
  const report = migrateAuthMerge({ root, write: true });
  assert.deepEqual(report.findings.map((finding) => [finding.file, finding.line, finding.code]), [
    ['be/src/modules/integrations/keycloak/keycloak.options.ts', 1, 'AUTH_MERGE_SUBPATH'],
    ['be/src/modules/integrations/keycloak/keycloak.options.ts', 1, 'AUTH_MERGE_DUPLICATE_IMPORT'],
  ]);
  assert.match(read(root, 'be/src/modules/integrations/keycloak/keycloak.options.ts'), /"@starci\/auth-oidc\/package\.json"/);
  assert.match(authMergeMarkdown(report), /Left for a person/);
});

test('the transforms on their own: a template literal specifier, a range kept, an app without the package', () => {
  assert.deepEqual(transformAuthMerge('await import(`@starci/auth-oidc/client`)'), { text: 'await import(`@starci/auth/client/oidc`)', rewritten: 1, unknown: [] });
  assert.deepEqual(transformManifest({ devDependencies: { '@starci/auth-oidc': '0.2.0', '@starci/auth': '^0.7.0' } }, '0.6.0')?.manifest, { devDependencies: { '@starci/auth': '^0.7.0' } });
  assert.deepEqual(transformManifest({ dependencies: { '@starci/auth': '0.7.0', '@starci/auth-oidc': '0.2.0' } }, '0.6.0')?.manifest, { dependencies: { '@starci/auth': '0.7.0' } }, 'a newer pin stays');
  assert.equal(transformManifest({ dependencies: { zod: '4.0.0' } }, '0.6.0'), null);
});

test('an app root without a package.json is refused, and the codemod verb runs it', async () => {
  assert.throws(() => migrateAuthMerge({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'starci-auth-merge-')) }), /package\.json/);
  const root = fullApp();
  let out = '';
  const code = await codemodMain(['auth-merge', '--json'], { cwd: root, stdout: (text) => { out += text; } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).schema, 'starci/auth-merge-report@1'); // reason: the verb's own JSON report
  const dry = await codemodMain(['auth-merge'], { cwd: root, stdout: () => undefined });
  assert.equal(dry, 0);
  assert.equal(manifest(root, 'package.json').dependencies['@starci/auth-oidc'], '0.2.0', 'the verb is a dry run without --execute');
  assert.equal(await codemodMain(['auth-merge', '--execute'], { cwd: root, stdout: () => undefined }), 0);
  assert.equal(manifest(root, 'package.json').dependencies['@starci/auth-oidc'], undefined);
});

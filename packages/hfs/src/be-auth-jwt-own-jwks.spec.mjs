// proves: BE_AUTH_JWT_OWN_JWKS@lite
import test from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, findings, runArch } from './helpers/hfs-arch-fixture.mjs';

const code = 'BE_AUTH_JWT_OWN_JWKS';

const JOSE = `export declare function createRemoteJWKSet(url: URL): { kind: 'remote' };
export declare function createLocalJWKSet(jwks: unknown): { kind: 'local' };
export declare function jwtVerify(token: string, jwks: unknown, options: { issuer: string; audience: string; algorithms: string[] }): Promise<unknown>;
export declare function decodeJwt(token: string): unknown;`;

function fixture(t, verifier, extra = {}) {
  const declaration = appDeclaration('be', { apps: [{ name: 'core', kind: 'api' }] });
  declaration.edition = 'lite';
  declaration.sides.be.connections = [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' }];
  return archFixture(t, { profile: 'be', files: {
    '../hfs.json': JSON.stringify(declaration),
    '../node_modules/jose/package.json': JSON.stringify({ name: 'jose', types: 'index.d.ts' }),
    '../node_modules/jose/index.d.ts': JOSE,
    'src/modules/integrations/passport/passport.tokens.ts': verifier,
    ...extra,
  } });
}

const OWN = `import { createLocalJWKSet, jwtVerify } from 'jose';
const keys = createLocalJWKSet({ keys: [] });
export const verify = (token: string) => jwtVerify(token, keys, { issuer: 'https://api.fixture.invalid', audience: 'app', algorithms: ['ES256'] });`;

test(`${code}: the passport integration verifies against the app's own key set`, t => {
  const report = runArch(fixture(t, OWN));
  assert.ok(report.coverage.checkedRuleIds.includes(code));
  assert.deepEqual(findings(report, code), []);
});

test(`${code}: a remote key set, an unverified decode and a verifier outside the integration are refused`, t => {
  const remote = `import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
const keys = createRemoteJWKSet(new URL('https://idp.fixture.invalid/.well-known/jwks.json'));
export const verify = (token: string) => { decodeJwt(token); return jwtVerify(token, keys, { issuer: 'https://idp.fixture.invalid', audience: 'app', algorithms: ['ES256'] }); };`;
  const report = runArch(fixture(t, remote, {
    'src/modules/domain/identity/auth.guard.ts': `import { createLocalJWKSet, jwtVerify } from 'jose';
export const verify = (token: string) => jwtVerify(token, createLocalJWKSet({ keys: [] }), { issuer: 'x', audience: 'app', algorithms: ['ES256'] });`,
  }));
  const violations = findings(report, code);
  assert.ok(violations.some(item => /decodes a token without/.test(item.message)));
  assert.ok(violations.some(item => /own key set/.test(item.message)));
  assert.ok(violations.some(item => /outside be\.integrations\.passport/.test(item.message)));
});

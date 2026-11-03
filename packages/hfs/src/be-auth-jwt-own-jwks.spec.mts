// proves: BE_AUTH_JWT_OWN_JWKS@lite
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, findings, runArch } from './helpers/hfs-arch-fixture.mjs';

const code = 'BE_AUTH_JWT_OWN_JWKS';

const JOSE = `export declare function createRemoteJWKSet(url: URL): { kind: 'remote' };
export declare function createLocalJWKSet(jwks: unknown): { kind: 'local' };
export declare function jwtVerify(token: string, jwks: unknown, options: { issuer: string; audience: string; algorithms: string[] }): Promise<unknown>;
export declare function decodeJwt(token: string): unknown;`;

const AUTH_SERVER = 'export declare class AuthTokens { verify(token: string): Promise<unknown> }';

function fixture(t: TestContext, glue: string, extra: Record<string, string> = {}) {
  const declaration = appDeclaration('be', { apps: [{ name: 'core', kind: 'api' }] });
  const declared: Record<string, unknown> = declaration; // reason: appDeclaration types the declaration without edition and the side fields; this fixture adds them
  declared['edition'] = 'lite';
  (declaration.sides.be as Record<string, unknown>)['connections'] = [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' }];
  return archFixture(t, { profile: 'be', files: {
    '../hfs.json': JSON.stringify(declaration),
    '../node_modules/jose/package.json': JSON.stringify({ name: 'jose', types: 'index.d.ts' }),
    '../node_modules/jose/index.d.ts': JOSE,
    '../node_modules/@starci/auth/package.json': JSON.stringify({ name: '@starci/auth', exports: { './server': { types: './server.d.ts' } } }),
    '../node_modules/@starci/auth/server.d.ts': AUTH_SERVER,
    'src/modules/integrations/passport/index.ts': glue,
    ...extra,
  } });
}

const GLUE = `import { AuthTokens } from '@starci/auth/server';
export const tokens = (): AuthTokens => ({} as AuthTokens);`;

test(`${code}: the passport integration composes @starci/auth, and no app file verifies a token`, t => {
  const report = runArch(fixture(t, GLUE));
  assert.ok('checkedRuleIds' in report.coverage && report.coverage.checkedRuleIds?.includes(code));
  assert.deepEqual(findings(report, code), []);
});

test(`${code}: a passport integration that does not import @starci/auth/server is refused`, t => {
  const report = runArch(fixture(t, 'export const nothing = 1;'));
  assert.ok(findings(report, code).some(item => /does not import @starci\/auth\/server/.test(item.message)));
});

test(`${code}: a jwtVerify call and an unverified decode are refused in the integration and everywhere else`, t => {
  const verify = `import { createLocalJWKSet, jwtVerify, decodeJwt } from 'jose';
import { AuthTokens } from '@starci/auth/server';
const keys = createLocalJWKSet({ keys: [] });
export const kit = AuthTokens;
export const verify = (token: string) => { decodeJwt(token); return jwtVerify(token, keys, { issuer: 'https://api.fixture.invalid', audience: 'app', algorithms: ['EdDSA'] }); };`;
  const report = runArch(fixture(t, verify, {
    'src/modules/domain/identity/auth.guard.ts': `import { createLocalJWKSet, jwtVerify } from 'jose';
export const verify = (token: string) => jwtVerify(token, createLocalJWKSet({ keys: [] }), { issuer: 'x', audience: 'app', algorithms: ['EdDSA'] });`,
  }));
  const violations = findings(report, code);
  assert.ok(violations.some(item => /decodes a token without/.test(item.message)));
  assert.equal(violations.filter(item => /jwtVerify is called in the app/.test(item.message)).length, 2);
});

test(`${code}: authorization claims read from a request body are refused`, t => {
  const report = runArch(fixture(t, GLUE, {
    'src/modules/domain/identity/auth.guard.ts': 'export const roleOf = (request: { body: { role: string } }) => request.body.role;',
  }));
  assert.ok(findings(report, code).some(item => /read from the request body/.test(item.message)));
});

// The skeleton's FetchHttpClient over a real HTTPS server signed by a per-run CA: refused by default, reached once the CA
// is trusted through `trustedCa`, and still refused under an unrelated CA, so trusting a CA never turns verification off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const HTTP = path.join(root, 'templates/be/skeleton/src/modules/platform/http');
// The test world's TLS material (packages/test-world), the CA an app receives as `w.fake.<name>.ca`.
const TLS = path.resolve(root, '../test-world/src/fakes/framework/tls.ts');

interface Material { cert: string; key: string; ca: string }
interface Client { request(input: Record<string, unknown>): Promise<unknown>; onModuleDestroy(): unknown }
type ClientClass = new (options: Record<string, unknown>) => Client;

/** Compiles one TypeScript file to CommonJS and runs it with `modules` answering its imports. */
const load = (file: string, modules: Record<string, unknown> = {}): Record<string, unknown> => {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const exports: Record<string, unknown> = {};
  new Function('exports', 'require', outputText)(exports, (name: string) => (Object.hasOwn(modules, name) ? modules[name] : require(name)));
  return exports;
};

const HttpErrorCode = { Timeout: 'HTTP_TIMEOUT', Network: 'HTTP_NETWORK', BodyUnreadable: 'HTTP_BODY_UNREADABLE' };
class HttpError extends Error {
  code: string;
  constructor({ code, cause }: { code: string; cause?: unknown }) {
    super(code, { cause });
    this.code = code;
  }
}

/** The skeleton's client over the real `node:tls`, `@nestjs/common` and `undici` (or the given replacements). */
const clientClass = (modules: Record<string, unknown> = {}) => load(path.join(HTTP, 'fetch-http-client.client.ts'), {
  '@modules/platform/primitives': { isRecord: (value: unknown) => typeof value === 'object' && value !== null },
  './errors/http.error': { HttpError, HttpErrorCode },
  './http.decorators': { InjectHttpOptions: () => () => undefined },
  ...modules,
}).FetchHttpClient as ClientClass;
const FetchHttpClient = clientClass();
const { issueFakeTls } = load(TLS) as { issueFakeTls: () => Material }; // reason: the module is compiled at run time from the test world source, so its shape is declared here

/** An HTTPS server answering JSON with a certificate the given material's CA signed, closed after the test. */
const serve = async (t: TestContext, material: Material) => {
  const server = https.createServer({ cert: material.cert, key: material.key }, (_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{"issuer":"fake"}');
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));
  return `https://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/openid-configuration`;
};

const call = (client: Client, url: string) => client.request({ correlationId: 'request-1', method: 'GET', url, timeoutMs: 5000 });

/** A client built as Nest builds it, closed after the test. */
const clientOf = (t: TestContext, options: Record<string, unknown>) => {
  const client = new FetchHttpClient(options);
  t.after(() => client.onModuleDestroy());
  return client;
};

/** The TLS code under the fetch failure: the handshake refused the certificate. */
const refusedCode = (error: Error) => (error.cause as { cause?: { code?: string } } | undefined)?.cause?.code;

test('without trustedCa the client verifies against the bundled roots alone and refuses the per-run CA', async (t) => {
  const material = issueFakeTls();
  const url = await serve(t, material);
  const error = await call(clientOf(t, {}), url).then(() => assert.fail('an untrusted CA was accepted'), (failure: HttpError) => failure);
  assert.ok(error instanceof HttpError);
  assert.equal(error.code, HttpErrorCode.Network);
  assert.equal(refusedCode(error), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test('with trustedCa set to the per-run CA the client reaches the server and reads its answer', async (t) => {
  const material = issueFakeTls();
  const url = await serve(t, material);
  assert.deepEqual(await call(clientOf(t, { trustedCa: material.ca }), url), { status: 200, body: { issuer: 'fake' } });
});

test('trusting one CA never trusts another: a server signed by an unrelated CA is still refused', async (t) => {
  const url = await serve(t, issueFakeTls());
  const client = clientOf(t, { trustedCa: issueFakeTls().ca });
  const error = await call(client, url).then(() => assert.fail('an unrelated CA was accepted'), (failure: HttpError) => failure);
  assert.equal(error.code, HttpErrorCode.Network);
  assert.equal(refusedCode(error), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test('the trusted CA joins the bundled roots instead of replacing them, so public hosts stay verified as before', async (t) => {
  const undici = require('undici');
  const pools: { connect: { ca: string[] } }[] = [];
  class RecordingAgent extends undici.Agent {
    constructor(options: { connect: { ca: string[] } }) {
      super(options);
      pools.push(options);
    }
  }
  const Recorded = clientClass({ undici: { Agent: RecordingAgent } });
  const { ca } = issueFakeTls();
  const client = new Recorded({ trustedCa: ca });
  t.after(() => client.onModuleDestroy());
  assert.deepEqual(pools.map((options) => options.connect.ca), [[...rootCertificates, ca]]);
  new Recorded({});
  assert.equal(pools.length, 1, 'a client without trustedCa builds no pool of its own');
});

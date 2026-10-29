// The skeleton's FetchHttpClient over a real HTTPS server signed by a per-run CA: refused by default, reached once the CA
// is trusted through `trustedCa`, and still refused under an unrelated CA, so trusting a CA never turns verification off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const HTTP = path.join(root, 'templates/be/skeleton/src/modules/platform/http');
// The test world's TLS material (packages/test-world), the CA an app receives as `w.fake.<name>.ca`.
const TLS = path.resolve(root, '../test-world/src/fakes/framework/tls.ts');

/** Compiles one TypeScript file to CommonJS and runs it with `modules` answering its imports. */
const load = (file, modules = {}) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, (name) => (Object.hasOwn(modules, name) ? modules[name] : require(name)));
  return exports;
};

const HttpErrorCode = { Timeout: 'HTTP_TIMEOUT', Network: 'HTTP_NETWORK', BodyUnreadable: 'HTTP_BODY_UNREADABLE' };
class HttpError extends Error {
  constructor({ code, cause }) {
    super(code, { cause });
    this.code = code;
  }
}

/** The skeleton's client over the real `node:tls`, `@nestjs/common` and `undici` (or the given replacements). */
const clientClass = (modules = {}) => load(path.join(HTTP, 'fetch-http-client.client.ts'), {
  '@modules/platform/primitives': { isRecord: (value) => typeof value === 'object' && value !== null },
  './errors/http.error': { HttpError, HttpErrorCode },
  './http.decorators': { InjectHttpOptions: () => () => undefined },
  ...modules,
}).FetchHttpClient;
const FetchHttpClient = clientClass();
const { issueFakeTls } = load(TLS);

/** An HTTPS server answering JSON with a certificate the given material's CA signed, closed after the test. */
const serve = async (t, material) => {
  const server = https.createServer({ cert: material.cert, key: material.key }, (_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{"issuer":"fake"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `https://127.0.0.1:${server.address().port}/.well-known/openid-configuration`;
};

const call = (client, url) => client.request({ correlationId: 'request-1', method: 'GET', url, timeoutMs: 5000 });

/** A client built as Nest builds it, closed after the test. */
const clientOf = (t, options) => {
  const client = new FetchHttpClient(options);
  t.after(() => client.onModuleDestroy());
  return client;
};

/** The TLS code under the fetch failure: the handshake refused the certificate. */
const refusedCode = (error) => error.cause?.cause?.code;

test('without trustedCa the client verifies against the bundled roots alone and refuses the per-run CA', async (t) => {
  const material = issueFakeTls();
  const url = await serve(t, material);
  const error = await call(clientOf(t, {}), url).then(() => assert.fail('an untrusted CA was accepted'), (failure) => failure);
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
  const error = await call(client, url).then(() => assert.fail('an unrelated CA was accepted'), (failure) => failure);
  assert.equal(error.code, HttpErrorCode.Network);
  assert.equal(refusedCode(error), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test('the trusted CA joins the bundled roots instead of replacing them, so public hosts stay verified as before', async (t) => {
  const undici = require('undici');
  const pools = [];
  class RecordingAgent extends undici.Agent {
    constructor(options) {
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

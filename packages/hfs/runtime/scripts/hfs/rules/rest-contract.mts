// rest-contract.mts - the REST contract of an api app whose hfs.json entry declares `contract: "rest"` (contexts/code/be/transport.md
// BE-TRANSPORT-4), judged on the committed `contracts/<app>/openapi.json` that `starci app emit` writes (its freshness is R23's):
//   R396 BE_REST_OPERATION_ID   every operation names an explicit operationId `<area>.<action>` (dotted lower camel), unique in the document;
//        BE_REST_UNTYPED        every JSON request body and every 2xx JSON answer is a named schema of components.schemas (a $ref, or an
//                               array of one), and a 2xx answer other than 204 has a JSON body;
//        BE_REST_ERROR_SHAPE    every operation answers `default` with one and the same named schema, an object that requires `code`
//                               and `message`;
//        BE_REST_PAGINATION     a GET answers no bare array: a list is a named schema with `items` (an array) and `nextCursor`, read with the
//                               query parameters `cursor` and `limit`;
//        BE_REST_SECURITY       components.securitySchemes names at least one scheme, and every operation states its security (its own
//                               `security` or the document's); an operation that states none (`security: []`) carries `x-public-reason`.
//   R278 BE_REST_APP_GRAPHQL    a back end whose api apps declare rest holds a GraphQL door or the GraphQL platform: its door is the controller;
//   R177 BE_CONTRACT_BREAKING   against `contracts/<app>/openapi.pin.json` (the published copy, opt-in per app): no pinned operation is
//                               removed or renamed, no parameter or required body field is added as required, no pinned parameter or answer
//                               field is removed or retyped, unless the document's info.version raises the pin's major.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { contractOf } from '../contract-kind.mjs';
import { found, readJson } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const GRAPHQL_DOOR = /^src\/features\/[^/]+\/[^/]+\/transport\/graphql\//u;
const GRAPHQL_PLATFORM = /^src\/modules\/platform\/graphql(?:\/|\.ts$)/u;

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];
const OPERATION_ID = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u;
const SCHEMA_REF = /^#\/components\/schemas\/([^/]+)$/u;
const JSON_TYPE = 'application/json';

/** The committed REST snapshot and its pin of an app, be-side-relative. */
export const restSnapshotPath = (app: string): string => `contracts/${app}/openapi.json`;
export const restPinPath = (app: string): string => `contracts/${app}/openapi.pin.json`;

/** One operation of a document: where it is, and its object. */
interface Operation { at: string; route: string; method: string; op: Parsed }

/** Every operation of an OpenAPI document, `GET /orders` style. */
export function operationsOf(doc: Parsed): Operation[] {
  const out: Operation[] = [];
  for (const [route, item] of Object.entries(plain(doc?.paths) ? doc.paths : {})) {
    if (!plain(item)) continue;
    for (const method of METHODS) if (plain((item as Parsed)[method])) out.push({ at: `${method.toUpperCase()} ${route}`, route, method, op: (item as Parsed)[method] });
  }
  return out;
}

const jsonSchemaOf = (holder: Parsed): Parsed => (plain(holder?.content) && plain(holder.content[JSON_TYPE]) ? holder.content[JSON_TYPE].schema ?? null : null);
/** True for a $ref to a named schema, or an array whose items are one. */
const named = (schema: Parsed): boolean => plain(schema) && ((typeof schema.$ref === 'string' && SCHEMA_REF.test(schema.$ref)) || (schema.type === 'array' && named(schema.items)));
/** The named schema a $ref points at, or the schema itself. */
const resolved = (doc: Parsed, schema: Parsed): Parsed => {
  const match = typeof schema?.$ref === 'string' ? SCHEMA_REF.exec(schema.$ref) : null;
  return match ? doc?.components?.schemas?.[match[1] as string] ?? null : schema;
};
const twoHundreds = (op: Parsed): Array<[string, Parsed]> => Object.entries(plain(op.responses) ? op.responses : {}).filter(([status]) => /^2\d\d$/u.test(status)) as Array<[string, Parsed]>;

/** The R396 problems of one REST document, as [code, message]. Pure. */
export function restContractProblems(doc: Parsed): Array<[string, string]> {
  const problems: Array<[string, string]> = [];
  const operations = operationsOf(doc);
  const seen = new Map<string, string>();
  for (const { at, op } of operations) {
    const id = op.operationId;
    if (typeof id !== 'string' || !OPERATION_ID.test(id)) problems.push(['BE_REST_OPERATION_ID', `${at} has operationId ${JSON.stringify(id ?? null)}, not an explicit <area>.<action> (@ApiOperation({ operationId: "orders.list" }))`]);
    else if (seen.has(id)) problems.push(['BE_REST_OPERATION_ID', `${at} repeats the operationId ${id} of ${seen.get(id)}`]);
    else seen.set(id, at);
  }
  for (const { at, op } of operations) {
    const body = plain(op.requestBody) ? jsonSchemaOf(op.requestBody) : null;
    if (plain(op.requestBody) && !named(body)) problems.push(['BE_REST_UNTYPED', `${at} takes a request body that is not a named schema of components.schemas (a DTO class with @ApiProperty fields)`]);
    for (const [status, answer] of twoHundreds(op)) {
      if (status === '204') continue;
      if (!named(jsonSchemaOf(answer))) problems.push(['BE_REST_UNTYPED', `${at} answers ${status} without a named JSON schema (@ApiOkResponse({ type: <Dto> }))`]);
    }
  }
  const defaults = operations.map(({ at, op }) => ({ at, ref: jsonSchemaOf(op.responses?.default)?.$ref }));
  const errorRef = defaults.find((entry) => typeof entry.ref === 'string' && SCHEMA_REF.test(entry.ref))?.ref as string | undefined;
  const error = errorRef === undefined ? null : resolved(doc, { $ref: errorRef });
  const required = Array.isArray(error?.required) ? error.required : [];
  if (operations.length && (!plain(error) || error.type !== 'object' || !required.includes('code') || !required.includes('message'))) problems.push(['BE_REST_ERROR_SHAPE', `the error schema ${errorRef ?? '(none)'} is not an object that requires code and message (the one error body every operation answers as default)`]);
  for (const { at, ref } of defaults) if (errorRef !== undefined && ref !== errorRef) problems.push(['BE_REST_ERROR_SHAPE', `${at} does not answer default with ${errorRef}, the one error schema (@ApiDefaultResponse({ type: ErrorDto }) on the controller)`]);
  for (const { at, method, op } of operations) {
    if (method !== 'get') continue;
    for (const [status, answer] of twoHundreds(op)) {
      const schema = jsonSchemaOf(answer);
      if (plain(schema) && schema.type === 'array') { problems.push(['BE_REST_PAGINATION', `${at} answers ${status} with a bare array: a list is a page { items, nextCursor } read with cursor and limit`]); continue; }
      const page = resolved(doc, schema);
      if (!plain(page?.properties) || page.properties.items?.type !== 'array') continue;
      const query = new Set((Array.isArray(op.parameters) ? op.parameters : []).filter((parameter: Parsed) => parameter?.in === 'query').map((parameter: Parsed) => parameter.name));
      const missing = [...(page.properties.nextCursor ? [] : ['the nextCursor field']), ...['cursor', 'limit'].filter((name) => !query.has(name)).map((name) => `the query parameter ${name}`)];
      if (missing.length) problems.push(['BE_REST_PAGINATION', `${at} answers a page of items without ${missing.join(', ')}`]);
    }
  }
  const schemes = plain(doc?.components?.securitySchemes) ? Object.keys(doc.components.securitySchemes) : [];
  if (!schemes.length) problems.push(['BE_REST_SECURITY', 'components.securitySchemes declares no scheme (DocumentBuilder().addBearerAuth() or another scheme in apps/<app>/src/openapi.ts)']);
  for (const { at, op } of operations) {
    const security = Array.isArray(op.security) ? op.security : Array.isArray(doc?.security) ? doc.security : null;
    if (security === null) problems.push(['BE_REST_SECURITY', `${at} states no security (@ApiBearerAuth() on the controller or the method, or a document-wide security in the head)`]);
    else if (security.length === 0 && (typeof op['x-public-reason'] !== 'string' || !op['x-public-reason'].trim())) problems.push(['BE_REST_SECURITY', `${at} is public (security: []) without x-public-reason (@ApiExtension("x-public-reason", "<why>"))`]);
  }
  return problems;
}

const majorOf = (version: unknown): number | null => {
  const match = typeof version === 'string' ? /^(\d+)\./u.exec(version) : null;
  return match ? Number(match[1]) : null;
};
const typeOf = (doc: Parsed, schema: Parsed): string => {
  const target = resolved(doc, schema);
  return plain(schema) && typeof schema.$ref === 'string' ? schema.$ref : JSON.stringify({ type: target?.type ?? null, format: target?.format ?? null, items: target?.items?.$ref ?? target?.items?.type ?? null });
};
const paramKey = (parameter: Parsed): string => `${parameter?.in}:${parameter?.name}`;

/** The breaking changes of `current` against its pin `pinned`, as messages; none when current raises the pin's major. Pure. */
export function restBreakingChanges(pinned: Parsed, current: Parsed): string[] {
  const before = majorOf(pinned?.info?.version), after = majorOf(current?.info?.version);
  if (before !== null && after !== null && after > before) return [];
  const out: string[] = [];
  const now = new Map(operationsOf(current).map((entry) => [entry.at, entry]));
  for (const { at, op } of operationsOf(pinned)) {
    const next = now.get(at);
    if (!next) { out.push(`${at} (${op.operationId}) is removed`); continue; }
    if (next.op.operationId !== op.operationId) out.push(`${at} is renamed from ${op.operationId} to ${next.op.operationId}`);
    const oldParams = new Map<string, Parsed>((Array.isArray(op.parameters) ? op.parameters : []).map((parameter: Parsed) => [paramKey(parameter), parameter]));
    for (const parameter of Array.isArray(next.op.parameters) ? next.op.parameters : []) if (parameter?.required === true && !oldParams.has(paramKey(parameter))) out.push(`${at} adds the required parameter ${paramKey(parameter)}`);
    const newParams = new Map<string, Parsed>((Array.isArray(next.op.parameters) ? next.op.parameters : []).map((parameter: Parsed) => [paramKey(parameter), parameter]));
    for (const [key, parameter] of oldParams) {
      const kept = newParams.get(key);
      if (!kept) out.push(`${at} removes the parameter ${key}`);
      else if (typeOf(current, kept.schema) !== typeOf(pinned, parameter.schema)) out.push(`${at} retypes the parameter ${key}`);
    }
    const oldBody = resolved(pinned, jsonSchemaOf(op.requestBody)), newBody = resolved(current, jsonSchemaOf(next.op.requestBody));
    const oldRequired = new Set<string>(Array.isArray(oldBody?.required) ? oldBody.required : []);
    for (const field of Array.isArray(newBody?.required) ? newBody.required : []) if (!oldRequired.has(field)) out.push(`${at} requires the new body field ${field}`);
    for (const [status, answer] of twoHundreds(op)) {
      const oldAnswer = resolved(pinned, jsonSchemaOf(answer)), newAnswer = resolved(current, jsonSchemaOf(next.op.responses?.[status]));
      for (const [field, schema] of Object.entries(plain(oldAnswer?.properties) ? oldAnswer.properties : {})) {
        const kept = newAnswer?.properties?.[field];
        if (!kept) out.push(`${at} ${status} drops the field ${field}`);
        else if (typeOf(current, kept) !== typeOf(pinned, schema)) out.push(`${at} ${status} retypes the field ${field}`);
      }
    }
  }
  return out;
}

/** The findings of R396 and of R177 over the REST snapshots of the be side at `repoRoot`. */
export function restContractFindings({ repoRoot, repo, files = [] }: { repoRoot: string; repo: Repo; files?: string[] }): Finding[] {
  if (repo?.profile !== 'be') return [];
  const tracked = new Set(files);
  const findings: Finding[] = [];
  const apis = (repo.apps ?? []).filter((entry: Parsed) => entry.kind === 'api');
  if (apis.length > 0 && apis.every((entry: Parsed) => contractOf(entry) === 'rest')) {
    for (const file of files) {
      if (GRAPHQL_PLATFORM.test(file) || GRAPHQL_DOOR.test(file)) findings.push(found('BE_REST_APP_GRAPHQL', file, `${file} is a GraphQL door or the GraphQL platform, but the api apps of this back end declare contract rest: a rest back end serves controllers (transport/http) described by contracts/<app>/openapi.json (BE-TRANSPORT-1)`));
    }
  }
  for (const app of (repo.apps ?? []).filter((entry: Parsed) => entry.kind === 'api' && contractOf(entry) === 'rest')) {
    const snapshot = restSnapshotPath(app.name);
    const doc = tracked.has(snapshot) ? readJson(repoRoot, snapshot) : null;
    if (!plain(doc)) continue;
    for (const [code, message] of restContractProblems(doc)) findings.push(found(code, snapshot, `${snapshot}: ${message} (BE-TRANSPORT-4)`, { app: app.name }));
    const pin = restPinPath(app.name);
    const pinned = tracked.has(pin) ? readJson(repoRoot, pin) : null;
    if (!plain(pinned)) continue;
    for (const change of restBreakingChanges(pinned, doc)) findings.push(found('BE_CONTRACT_BREAKING', snapshot, `${snapshot}: ${change} against ${pin}; a published REST contract changes additively, or raises info.version's major (R177)`, { app: app.name }));
  }
  return findings;
}

import path from 'node:path';
import { machineKit } from './machine-ast.mjs';
import { propertyValue } from './function-spec-providers.mjs';

/**
 * R50 `transport-owner` (FE_TRANSPORT_OWNER), the machine half of the eslint transport rules. ESLint judges one file at a time by
 * the spelling of a call; the machine judges the repository by what the checker resolves. The browser calls the back end through
 * Apollo GraphQL and axios (owner ruling 2026-10-13, both editions). A repository has exactly ONE transport client folder (the auth
 * and no-auth Apollo clients with their link chain) and ONE GraphQLResponse union, both named by slot (never by a path spelled here):
 * the api package's (`fe.package.api.client`, `fe.package.api.outcome`) when several apps call the back end, or the app's own
 * (`fe.transport.client`, `fe.transport.outcome`) when exactly one app does. An app calls the back end when it holds a file of the
 * api owner (modules/api, its client and union) or imports the api package; an app that holds neither (a marketing landing) shares
 * no transport and is not counted. The union homes are the slots the manifest marks `outcomeHome`, not a list kept here.
 *
 *   - two or more client folders, or two or more unions, in the repository (two apps each keeping one, or a package one plus an
 *     app one) are findings on every copy;
 *   - an app client or app union in a repository where more than one app calls the back end is a finding (it belongs to the package);
 *   - no file outside the client folder and the stream reader folder (`fe.transport.stream`, `modules/api/sse/clients/`) references the global `fetch`: a call, `globalThis.fetch`, `window.fetch`, or a
 *     reference passed as a value (`useSWR(key, fetch)`, `const send = fetch`), all of which a spelling-based rule misses; with no
 *     client at all every such reference is a finding that says the repository has no client;
 *   - axios is imported only by the api owner (modules/api, the api package) for its rest calls and by the auth door
 *     (modules/auth/auth-door.ts) for the app's own auth doors; every other HTTP library is a
 *     second transport wherever it is imported, by static import, `import()` or `require()`;
 *   - an `ApolloClient` is constructed only inside the client folder;
 *   - every GraphQL operation (`graphql/queries/query-*.ts`, `graphql/mutations/mutation-*.ts`, `graphql/subscriptions/subscription-*.ts`) imports the client (or the api
 *     package that holds it), so an operation is a caller of the one transport and not a second one.
 *   - every stream operation (`sse/<area>/stream-*.ts`) imports the stream reader, so a server-sent-events stream is read by the
 *     transport client layer and not by a fetch of its own.
 */
export const TRANSPORT_OWNER_RULE_IDS = ['FE_TRANSPORT_OWNER'];

const RULE = 'FE_TRANSPORT_OWNER';
/** Packages that send HTTP requests: a second transport when a file imports one (axios only outside the api owner). */
const HTTP_LIBRARIES = new Set(['axios', 'ky', 'ky-universal', 'got', 'node-fetch', 'undici', 'cross-fetch', 'isomorphic-fetch', 'superagent', 'ofetch', 'whatwg-fetch']);
const REST_LIBRARY = 'axios';
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
const APP_CLIENT_SLOT = 'fe.transport.client';
const APP_OUTCOME_SLOT = 'fe.transport.outcome';
const PACKAGE_API_SLOT = 'fe.package.api';
const CLIENT_SLOTS = new Set([APP_CLIENT_SLOT, 'fe.package.api.client']);
/** The stream reader (server-sent events) is the second half of the transport client layer: it may call `fetch`, and it is no second Apollo client folder. */
const STREAM_SLOT = 'fe.transport.stream';
/** The api owner: the slots whose files may import axios (the rest calls and the client's own links). */
const API_OWNER_SLOTS = new Set(['fe.modules.api', PACKAGE_API_SLOT, ...CLIENT_SLOTS]);
/** The slots that hold the GraphQL operations of an app or of the api package. */
const OPERATION_SLOTS = new Set(['fe.modules.api', PACKAGE_API_SLOT]);
const OPERATION_FILE = /^(?:query|mutation|subscription)-[^/]+\.ts$/u;
const STREAM_OPERATION_FILE = /^stream-[^/]+\.ts$/u;
const NO_CLIENT = "the repository has no transport client. Create the one Apollo client folder (packages/<family>-api/src/graphql/clients/, or the only app's modules/api/graphql/clients/) and call the back end through it.";

/** True when `node` names the global fetch: no import, and no declaration outside a lib declaration file. */
function isGlobalObjectFetch(ts, node) {
  return ts.isPropertyAccessExpression(node) && node.name.text === 'fetch' && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text);
}

function isDeclarationName(ts, parent, node) {
  return (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && parent.name === node;
}

function isTypeOrImportPosition(ts, parent) {
  return ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isPropertySignature(parent);
}

function isGlobalFetch(ts, kit, checker, node) {
  if (!ts.isIdentifier(node)) return isGlobalObjectFetch(ts, node);
  if (node.text !== 'fetch') return false;
  if (kit.importBinding(checker, node)) return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  // A type position (`typeof fetch`, `typeof globalThis.fetch`) names the type of fetch and sends nothing.
  if (isTypeOrImportPosition(ts, parent)) return false;
  if (isDeclarationName(ts, parent, node)) return false;
  const declarations = kit.declarationsOf(checker, node);
  return declarations.every(declaration => declaration.getSourceFile().isDeclarationFile);
}

/** Findings on every copy when there are several, and on an app's own copy in a repository where several apps call the back end. */
function reportMultiplicity(items, noun, callingApps, report) {
  const list = items.map(item => item.root).join(', ');
  for (const item of items) {
    if (items.length > 1) {
      report(item, item.sourceFile, `The repository has ${items.length} ${noun}s (${list}); it has exactly one: the api package's (packages/<family>-api/src/graphql/) when the apps share it, or the only app's. Keep one and delete the others.`);
    } else if ((item.slot === APP_CLIENT_SLOT || item.slot === APP_OUTCOME_SLOT) && callingApps.length > 1) {
      report(item, item.sourceFile, `${item.root} is an app's ${noun} in a repository of ${callingApps.length} apps that call the back end (${callingApps.join(', ')}); a repository where several apps call the back end keeps its one ${noun} in the api package (packages/<family>-api/src/graphql/).`);
    }
  }
}

function globalFetchUse(ts, kit, checker, node) {
  if (ts.isPropertyAccessExpression(node) && isGlobalFetch(ts, kit, checker, node)) return 'property';
  if (ts.isIdentifier(node) && isGlobalFetch(ts, kit, checker, node)) return 'identifier';
  return null;
}

function moduleSpecifierOf(ts, node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) return node.arguments[0];
  return null;
}

function isApolloClientConstruction(ts, kit, checker, node) {
  if (!ts.isNewExpression(node)) return false;
  const binding = kit.importBinding(checker, node.expression);
  return Boolean(binding?.name === 'ApolloClient' && binding.module.startsWith('@apollo/client'));
}

/** The one auth door of the session issuer's client (`modules/auth/auth-door.ts`, slot fe.modules.auth): it calls the app's own auth doors with axios. */
const isAuthDoor = (file) => file.slot === 'fe.modules.auth' && path.posix.basename(file.rel) === 'auth-door.ts';

function inspectLibraryImport({ ts, file, node, transport, report }) {
  const specifier = moduleSpecifierOf(ts, node);
  if (!specifier || !ts.isStringLiteralLike(specifier)) return;
  const library = specifier.text.split('/')[0];
  if (!HTTP_LIBRARIES.has(library) || (library === REST_LIBRARY && (API_OWNER_SLOTS.has(file.slot) || isAuthDoor(file)))) return;
  const where = library === REST_LIBRARY
    ? 'axios belongs to the api owner (modules/api/rest, the api package) and the auth door (modules/auth/auth-door.ts) only: call their functions'
    : `the transport is Apollo GraphQL (${transport}) with axios for the rest calls of modules/api/rest`;
  report(file, node, `${specifier.text} is a second HTTP transport in ${file.rel}; ${where}.`, { library: specifier.text });
}

/** True when a call of fetch declares, in its init object literal, the request header accept: "text/event-stream". */
function asksForEventStream(ts, node) {
  const call = node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : null;
  const init = call?.arguments[1];
  if (!init || !ts.isObjectLiteralExpression(init)) return false;
  const headers = propertyValue(ts, init, 'headers');
  const accept = headers && ts.isObjectLiteralExpression(headers) ? propertyValue(ts, headers, 'accept') : null;
  return Boolean(accept && ts.isStringLiteralLike(accept) && accept.text === 'text/event-stream');
}

function inspectTransportNode(scope, node) {
  const { ts, kit, checker, file, isClient, owned, report } = scope;
  const fetchUse = globalFetchUse(ts, kit, checker, node);
  if (fetchUse !== null) {
    if (isClient) return false;
    if (file.slot === STREAM_SLOT) {
      if (!asksForEventStream(ts, node)) report(file, node, `${file.rel} fetches something other than an event stream; the stream reader folder reads server-sent events only (accept: "text/event-stream"), every other request is an operation of modules/api run by Apollo or axios.`);
      return false;
    }
    if (fetchUse === 'property') report(file, node, `${node.getText(file.sourceFile)} reaches the global fetch outside the transport client; ${owned}`);
    else report(file, node, `fetch is used outside the transport client (called, aliased or passed as a value); ${owned}`);
    return false;
  }
  if (!isClient && isApolloClientConstruction(ts, kit, checker, node)) report(file, node, `${file.rel} constructs an ApolloClient outside the transport client folder; ${owned}`);
  inspectLibraryImport({ ...scope, node });
  return true;
}

/** True when the operation imports the client folder, or (from an app) the api package that holds it. */
function reachesClient(graph, file, clientRels) {
  return graph.edges.some(edge => {
    if (edge.from !== file.rel || !edge.runtime) return false;
    if (clientRels.has(edge.to)) return true;
    return file.slot !== PACKAGE_API_SLOT && (graph.files.get(edge.to)?.slot ?? '').startsWith(PACKAGE_API_SLOT);
  });
}

/** True for a stream operation of the app's api layer: `modules/api/sse/<area>/stream-<channel>.ts`. */
function isStreamOperation(file) {
  return file.slot === 'fe.modules.api' && STREAM_OPERATION_FILE.test(path.posix.basename(file.rel)) && path.posix.basename(path.posix.dirname(path.posix.dirname(file.rel))) === 'sse';
}

/** True when the stream operation imports a file of the stream reader folder. */
function reachesStreamReader(graph, file) {
  return graph.edges.some(edge => edge.from === file.rel && edge.runtime && graph.files.get(edge.to)?.slot === STREAM_SLOT);
}

/** Only a stream operation (or the reader folder itself) imports the stream reader: a REST call, a GraphQL operation or a hook never does. */
function inspectReaderImporters({ files, graph, report }) {
  const byRel = new Map(files.map(file => [file.rel, file]));
  for (const edge of graph.edges) {
    if (!edge.runtime || graph.files.get(edge.to)?.slot !== STREAM_SLOT) continue;
    const from = byRel.get(edge.from);
    if (!from || from.slot === STREAM_SLOT || isStreamOperation(from)) continue;
    report(from, from.sourceFile, `${from.rel} imports the stream reader (modules/api/sse/clients); only a stream operation (sse/<area>/stream-<channel>.ts) reads a server-sent-events stream.`);
  }
}

function inspectTransportFiles({ files, graph, kit, ts, clientRels, transport, owned, report }) {
  const appsWithFiles = new Set();
  let operations = 0;
  for (const file of files) {
    if (file.bindings?.app) appsWithFiles.add(file.bindings.app);
    const scope = { ts, kit, checker: kit.checkerOf(file.sourceFile), file, isClient: clientRels.has(file.rel), transport, owned, report };
    kit.walk(file.sourceFile, node => inspectTransportNode(scope, node));
    if (OPERATION_SLOTS.has(file.slot) && OPERATION_FILE.test(path.posix.basename(file.rel))) {
      operations += 1;
      if (!reachesClient(graph, file, clientRels)) report(file, file.sourceFile, `${file.rel} is a GraphQL operation that does not import the transport client; an operation runs through the repository's one Apollo client, never through its own transport.`);
    }
    if (isStreamOperation(file)) {
      operations += 1;
      if (!reachesStreamReader(graph, file)) report(file, file.sourceFile, `${file.rel} is a stream operation that does not import the stream reader (modules/api/sse/clients); a stream operation runs on the transport client layer's reader, never on a fetch of its own.`);
    }
  }
  inspectReaderImporters({ files, graph, report });
  return { appsWithFiles, operations };
}

/**
 * The declared Next apps that call the back end: those holding a file of an api owner slot (modules/api, the app client, the app
 * union) or importing a file of the api package. An app with neither shares no transport.
 */
function transportApps(nextApps, files, graph) {
  const byRel = new Map(files.map(file => [file.rel, file]));
  const calling = new Set(files.filter(file => API_OWNER_SLOTS.has(file.slot) && file.slot !== PACKAGE_API_SLOT).map(file => file.bindings?.app));
  for (const edge of graph.edges) {
    const app = byRel.get(edge.from)?.bindings?.app;
    if (app && (byRel.get(edge.to)?.slot ?? '').startsWith(PACKAGE_API_SLOT)) calling.add(app);
  }
  return nextApps.map(item => item.name).filter(name => calling.has(name));
}

/** One instance per client folder (its slot root), carried by the folder's first file. */
function clientInstances(clients) {
  const byRoot = new Map();
  for (const file of [...clients].sort((a, b) => a.rel.localeCompare(b.rel))) if (!byRoot.has(file.root)) byRoot.set(file.root, file);
  return [...byRoot.values()];
}

export function checkTransportOwner(input) {
  const { graph } = input;
  const kit = machineKit(input);
  const { ts, resolver } = kit;
  const violations = [];
  const report = (file, node, message, extra = {}) => violations.push({ ruleId: RULE, path: file.rel, ...kit.at(file.rel, file.sourceFile, node), message, ...extra });
  const nextApps = resolver.repo.apps.filter(item => item.kind === 'next');
  const files = [...graph.files.values()].filter(file => file.slot && file.tier !== 'e2e').map(file => {
    const classified = resolver.classifyPath(file.rel);
    return { ...file, root: classified.root ?? file.rel, bindings: classified.bindings };
  });
  const clients = files.filter(file => CLIENT_SLOTS.has(file.slot));
  const instances = clientInstances(clients);
  const outcomes = files.filter(file => resolver.slot(file.slot)?.outcomeHome === true).map(file => ({ ...file, root: file.rel }));
  const clientRels = new Set(clients.map(file => file.rel));
  const transport = instances.length ? instances.map(item => item.root).join(', ') : 'no client exists yet';
  const owned = instances.length ? `the repository has one transport (${transport}). Call the back end through a modules/api operation and take its GraphQLResponse.` : NO_CLIENT;

  // Exactly one client folder and one GraphQLResponse union per repository.
  const calling = transportApps(nextApps, files, graph);
  reportMultiplicity(instances, 'transport client', calling, report);
  reportMultiplicity(outcomes, 'GraphQLResponse union', calling, report);

  const { appsWithFiles, operations } = inspectTransportFiles({ files, graph, kit, ts, clientRels, transport, owned, report });
  return { violations, coverage: { status: 'checked', apps: appsWithFiles.size, operations, clients: instances.length, outcomes: outcomes.length } };
}

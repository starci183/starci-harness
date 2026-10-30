// fe-contract-documents.mjs - FE_GRAPHQL_CONTRACT (R113): every GraphQL document a front end sends is one its back end
// serves. An app keeps the contract of each GraphQL service it runs as a snapshot, `be/contracts/<service>/schema.graphql`
// (`starci app emit`, HFS_CONTRACT_SNAPSHOT_DRIFT keeps it current), and its front end keeps every operation it sends
// in a `.graphql` file or a `gql` template under `fe/`. Each operation is judged against the contract of the service that serves its first
// root field (the one snapshot whose root type declares it): a root field no contract declares, a field, argument or input
// field the contract does not declare, a required argument left out, a variable of another type, a leaf with a selection or
// an object without one is a finding on the document. The finding names the service and every problem.
import { operationProblems, parseDocument, parseSchema, rootFieldsOf } from '../../lib/graphql-contract.mjs';
import { found, readText } from './read.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { isConstVariable, sourceLocation } from '../../lib/ts-ast.mjs';
import { lexicalChecker } from '../../lib/ts-analysis.mjs';
import type { Finding, Parsed, Ts } from './rule-types.mjs';

export const FE_GRAPHQL_CONTRACT = 'FE_GRAPHQL_CONTRACT';

const CONTRACT = /^be\/contracts\/([^/]+)\/schema\.graphql$/;
const isFrontend = (file: string) => file.startsWith('fe/') && !file.includes('/__generated__/') && !file.includes('/node_modules/');
const isDocument = (file: string) => isFrontend(file) && file.endsWith('.graphql');
const isSource = (file: string) => isFrontend(file) && /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts');
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Local names of gql imports (including a graphql-tag default import), alongside the canonical gql spelling. */
function addGqlImportNames(ts: Ts, statement: Parsed, names: Parsed) {
  if (!ts.isImportDeclaration(statement)) return;
  const clause = statement.importClause;
  if (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'graphql-tag' && clause?.name) names.add(clause.name.text);
  const bindings = clause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return;
  for (const entry of bindings.elements) {
    if ((entry.propertyName ?? entry.name).text === 'gql') names.add(entry.name.text);
  }
}

function gqlNames(ts: Ts, source: Parsed) {
  const names = new Set(['gql']);
  for (const statement of source.statements) addGqlImportNames(ts, statement, names);
  return names;
}

const isGqlTag = (ts: Ts, tag: Parsed, names: Parsed) => (ts.isIdentifier(tag) && names.has(tag.text)) || (ts.isPropertyAccessExpression(tag) && tag.name.text === 'gql');

/** Resolve literal fragment substitutions without evaluating source code. Unknown or cyclic values cannot be judged. */
function templateText(ts: Ts, node: Parsed, checker: Parsed, names: Parsed, visiting = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    const declaration = symbol?.valueDeclaration;
    if (symbol?.declarations?.length !== 1 || !declaration || !ts.isVariableDeclaration(declaration)
      || !ts.isIdentifier(declaration.name) || !isConstVariable(ts, declaration) || !declaration.initializer || visiting.has(declaration)) return null;
    return templateText(ts, declaration.initializer, checker, names, new Set([...visiting, declaration]));
  }
  if (ts.isTaggedTemplateExpression(node) && isGqlTag(ts, node.tag, names)) return templateText(ts, node.template, checker, names, visiting);
  if (!ts.isTemplateExpression(node)) return null;
  let text = node.head.text;
  for (const span of node.templateSpans) {
    const value = templateText(ts, span.expression, checker, names, visiting);
    if (value === null) return null;
    text += value + span.literal.text;
  }
  return text;
}

/** Actual tagged-template AST nodes: comments, quoted examples and other template tags are not operations. */
function gqlDocuments(ts: Ts, file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = gqlNames(ts, source);
  const templates: Parsed[] = [];
  const visit = (node: Parsed) => {
    if (ts.isTaggedTemplateExpression(node) && isGqlTag(ts, node.tag, names)) templates.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (templates.length === 0) return [];
  const checker = lexicalChecker(ts, source);
  return templates.map((node) => ({ text: templateText(ts, node.template, checker, names), ...sourceLocation(source, node) }));
}

/** The parsed contracts of the app: [{ service, path, schema }], or a finding for a snapshot that does not parse. */
function contractsOf(repoRoot: string, files: string[], findings: Finding[]) {
  const contracts = [];
  for (const file of files) {
    const match = CONTRACT.exec(file);
    if (!match) continue;
    const text = readText(repoRoot, file);
    if (text === null) continue;
    try {
      contracts.push({ service: match[1], path: file, schema: parseSchema(text) });
    } catch (error) {
      findings.push(found(FE_GRAPHQL_CONTRACT, file, `${file} is not a GraphQL schema the front-end documents can be judged against: ${(error as Error).message}. Run \`npm run contract:emit\`.`));
    }
  }
  return contracts;
}

function operationFindings(file: string, document: Parsed, operation: Parsed, contracts: Parsed) {
  const label = operation.name ?? `anonymous ${operation.operation}`;
  const [first] = rootFieldsOf(operation);
  const serving = contracts.filter(({ schema }: { schema: Parsed }) => schema.types.get(schema.roots[operation.operation])?.fields?.has(first));
  if (serving.length === 0) {
    const where = contracts.length === 0 ? 'the app keeps no be/contracts/<service>/schema.graphql' : `no contract of ${contracts.map((c: Parsed) => c.path).join(', ')} declares ${operation.operation} ${first}`;
    return [found(FE_GRAPHQL_CONTRACT, file, `${file}: ${label} asks ${operation.operation} ${first}, but ${where}; the front end sends only what a back end serves.`, { operation: label, service: null })];
  }
  const [contract] = serving;
  const problems = operationProblems(contract.schema, document, operation);
  if (problems.length > 0) return [found(FE_GRAPHQL_CONTRACT, file, `${file}: ${label} does not match the ${contract.service} contract (${contract.path}): ${problems.join('; ')}.`, { operation: label, service: contract.service, problems })];
  return [];
}

function documentFindings(file: string, text: string, contracts: Parsed) {
  let document;
  try {
    document = parseDocument(text);
  } catch (error) {
    return [found(FE_GRAPHQL_CONTRACT, file, `${file} is not a GraphQL document: ${(error as Error).message}.`)];
  }
  return document.operations.flatMap((operation: Parsed) => operationFindings(file, document, operation, contracts));
}

function sourceDocuments(ts: Ts, file: string, text: string, findings: Finding[]) {
  if (!ts) {
    findings.push(found(FE_GRAPHQL_CONTRACT, file, `${file} gql templates cannot be judged: no TypeScript resolves from the app; install the app's dependencies.`));
    return [];
  }
  const documents = [];
  for (const template of gqlDocuments(ts, file, text)) {
    if (template.text === null) findings.push(found(FE_GRAPHQL_CONTRACT, file, `${file}:${template.line} gql template has a substitution that cannot be resolved to static GraphQL text.`, { line: template.line, column: template.column }));
    else documents.push({ file, ...template });
  }
  return documents;
}

function documentsOf(repoRoot: string, files: string[], findings: Finding[]) {
  const candidates = files.filter((file: string) => isDocument(file) || isSource(file)).sort(byCodeUnit);
  const ts = candidates.some(isSource) ? loadTypescript(repoRoot, HERE) : null;
  const documents = [];
  for (const file of candidates) {
    const text = readText(repoRoot, file);
    if (text === null) continue;
    if (isDocument(file)) documents.push({ file, text });
    else documents.push(...sourceDocuments(ts, file, text, findings));
  }
  return documents;
}

/** The findings of R113 over the tracked paths `files` of the app at `repoRoot`. */
export function feContractFindings({ repoRoot, files }: { repoRoot: string; files: string[] }) {
  const findings: Finding[] = [];
  const documents = documentsOf(repoRoot, files, findings);
  if (documents.length === 0) return findings;
  const contracts = contractsOf(repoRoot, files, findings);
  for (const { file, text, line, column } of documents) {
    const entries = documentFindings(file, text, contracts);
    findings.push(...entries.map((entry: Parsed) => line ? { ...entry, line, column } : entry));
  }
  return findings;
}

/**
 * The repeated shapes taught by the BE scaffold are wiring, not copied decisions. Match their imported
 * ports and their small bodies, never a filename suffix or an entire decorated class: a custom method
 * or an extra statement still goes through the clone check.
 */
import type {
  BindingName, CallExpression, ClassDeclaration, ConstructorDeclaration, Expression, Identifier, MethodDeclaration, Node, ParameterDeclaration,
  PropertyAssignment, SourceFile, Statement, SyntaxKind,
} from 'typescript';
import { nameText } from '../../lib/ts-ast.mjs';
import { importsOf, unwrapExpression } from '../../lib/ts-analysis.mjs';
import { nodeDecorators } from './ast-walks.mjs';
import { canonJsxCloneNodes } from './canon-jsx-clones.mjs';
import type { TypeScriptApi } from './config.mjs';

const READ_METHODS = new Set(['find', 'findBy', 'findAndCount', 'findOne', 'findOneBy', 'findOneOrFail', 'findOneByOrFail']);

/** One import binding of the file: the imported name and the module specifier it comes from. */
interface CanonImport {
  name: string;
  source: string;
}

/** What the scaffold matchers share for one source file. */
interface CanonEnv {
  ts: TypeScriptApi;
  imports: Map<string, CanonImport>;
  mappers: Set<string>;
  topLevelVariables: Set<Node>;
  topLevelClasses: Set<Node>;
}

/** A constructor parameter whose name is a plain identifier. */
type IdentifierParameter = ParameterDeclaration & { name: Identifier };

/** Which calls a data mapping may contain besides plain data. */
type AllowCall = (call: CallExpression) => boolean;

function unwrap(ts: TypeScriptApi, node: Node): Node;
function unwrap(ts: TypeScriptApi, node: Node | null | undefined): Node | null | undefined;
function unwrap(ts: TypeScriptApi, node: Node | null | undefined): Node | null | undefined {
  return unwrapExpression(ts, node, { awaitExpressions: true, typeAssertions: false });
}

const identifierText = (ts: TypeScriptApi, name: BindingName | undefined): string | undefined => (name && ts.isIdentifier(name) ? name.text : undefined);

const isIdentifierParameter = (ts: TypeScriptApi, parameter: ParameterDeclaration): parameter is IdentifierParameter => ts.isIdentifier(parameter.name);

const imported = (env: CanonEnv, node: Node | undefined, name: string, source: string): boolean => {
  if (!node || !env.ts.isIdentifier(node)) return false;
  const binding = env.imports.get(node.text);
  return binding?.name === name && binding.source === source;
};

const decoratorsHave = (env: CanonEnv, node: Node, name: string, source: string): boolean => nodeDecorators(env.ts, node)
  .some(decorator => imported(env, env.ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression, name, source));

const portType = (env: CanonEnv, node: Node | undefined, name: string, source: string): boolean => Boolean(node && env.ts.isTypeReferenceNode(node) && imported(env, node.typeName, name, source));

/** Data moves between shapes here; operators, arbitrary calls and executable callbacks remain compared. */
function mapping(env: CanonEnv, input: Node | null | undefined, allowCall: AllowCall = () => false): boolean {
  const { ts } = env;
  const node = unwrap(ts, input);
  if (!node) return false;
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.ThisKeyword].includes(node.kind)) return true;
  if (ts.isPropertyAccessExpression(node)) return mapping(env, node.expression, allowCall);
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(property => {
    if (ts.isShorthandPropertyAssignment(property)) return !property.objectAssignmentInitializer;
    if (ts.isSpreadAssignment(property)) return mapping(env, property.expression, allowCall);
    return ts.isPropertyAssignment(property) && nameText(ts, property.name) !== null && mapping(env, property.initializer, allowCall);
  });
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(item => mapping(env, ts.isSpreadElement(item) ? item.expression : item, allowCall));
  return ts.isCallExpression(node) && allowCall(node);
}

const parameterNames = (ts: TypeScriptApi, method: MethodDeclaration): Set<string> => new Set(method.parameters.filter((parameter): parameter is IdentifierParameter => isIdentifierParameter(ts, parameter)).map(parameter => parameter.name.text));
const propertyParameters = (ts: TypeScriptApi, constructor: ConstructorDeclaration | undefined): Set<string> => {
  const parameters: readonly ParameterDeclaration[] = constructor?.parameters ?? [];
  return new Set(parameters.filter((parameter): parameter is IdentifierParameter => !!parameter.modifiers?.length && isIdentifierParameter(ts, parameter)).map(parameter => parameter.name.text));
};
const inertParameters = (ts: TypeScriptApi, constructor: ConstructorDeclaration): boolean => constructor.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer);

function receiverMember(ts: TypeScriptApi, call: Node): string | null {
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return null;
  const receiver = call.expression.expression;
  return ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword ? receiver.name.text : null;
}

const statementCall = (ts: TypeScriptApi, statement: Statement | undefined): Node | null | undefined => ((statement && (ts.isReturnStatement(statement) || ts.isExpressionStatement(statement))) ? unwrap(ts, statement.expression) : null);

function delegation(env: CanonEnv, _method: MethodDeclaration, statement: Statement | undefined, members: ReadonlySet<string | null>, allowCall: AllowCall = () => false): boolean {
  const call = statementCall(env.ts, statement);
  return Boolean(call && env.ts.isCallExpression(call) && members.has(receiverMember(env.ts, call))
    && call.arguments.every(argument => mapping(env, argument, allowCall)));
}

function canonicalConstructor(env: CanonEnv, constructor: ConstructorDeclaration | undefined, logger = false): constructor is ConstructorDeclaration {
  if (!constructor?.body || !inertParameters(env.ts, constructor)) return false;
  if (!logger) return constructor.body.statements.length === 0;
  const parameters = constructor.parameters.filter(parameter => decoratorsHave(env, parameter, 'InjectLogger', '@modules/platform/logging'));
  if (parameters.length !== 1 || constructor.body.statements.length !== 1) return false;
  const call = statementCall(env.ts, constructor.body.statements[0]);
  if (!call || !env.ts.isCallExpression(call)) return false;
  const [argument] = call.arguments;
  return call.expression.kind === env.ts.SyntaxKind.SuperKeyword
    && call.arguments.length === 1 && argument !== undefined && env.ts.isIdentifier(argument) && argument.text === identifierText(env.ts, parameters[0]?.name);
}

function hasHeritage(env: CanonEnv, declaration: ClassDeclaration, name: string, source: string, kind: SyntaxKind): boolean {
  return declaration.heritageClauses?.some(clause => clause.token === kind && clause.types.some(type => imported(env, type.expression, name, source))) ?? false;
}

function fenceStatement(env: CanonEnv, statement: Statement, claims: string, job: string | undefined): boolean {
  const call = statementCall(env.ts, statement);
  if (!call || !env.ts.isCallExpression(call) || receiverMember(env.ts, call) !== claims || !env.ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== 'advance' || call.arguments.length !== 1) return false;
  const options = unwrap(env.ts, call.arguments[0]);
  if (!options || !env.ts.isObjectLiteralExpression(options) || options.properties.length !== 3) return false;
  const properties = new Map(options.properties.filter(env.ts.isPropertyAssignment).map((property): [string, Expression] => [nameText(env.ts, property.name), property.initializer]));
  const jobField = (node: Node | undefined, field: string): boolean => node !== undefined && env.ts.isPropertyAccessExpression(node) && env.ts.isIdentifier(node.expression) && node.expression.text === job && node.name.text === field;
  return jobField(properties.get('jobId'), 'jobId') && jobField(properties.get('expectedFencingToken'), 'fencingToken')
    && mapping(env, properties.get('step'));
}

function jobMethods(env: CanonEnv, declaration: ClassDeclaration, constructor: ConstructorDeclaration | undefined, excluded: Set<Node>): void {
  const claims = constructor?.parameters.find(parameter => portType(env, parameter.type, 'JobClaims', '@modules/platform/jobs')
    && decoratorsHave(env, parameter, 'InjectJobClaims', '@modules/platform/jobs'));
  if (!claims || !env.ts.isIdentifier(claims.name)) return;
  const claimsName = claims.name.text;
  const members = propertyParameters(env.ts, constructor);
  const runKey = (call: CallExpression): boolean => receiverMember(env.ts, call) === claimsName && env.ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'runKey'
    && call.arguments.length === 2 && call.arguments.every(argument => mapping(env, argument));
  for (const method of declaration.members) {
    if (!env.ts.isMethodDeclaration(method) || nameText(env.ts, method.name) !== 'run' || !method.body || method.parameters.length !== 1
      || !portType(env, method.parameters[0]?.type, 'ClaimedJob', '@modules/platform/jobs')) continue;
    const statements = method.body.statements;
    const job = [...parameterNames(env.ts, method)][0];
    const first = statements[0];
    if (!first || !fenceStatement(env, first, claimsName, job)) continue;
    if (statements.length === 1 || (statements.length === 2 && delegation(env, method, statements[1], members, runKey))) excluded.add(method);
    else excluded.add(first);
  }
  if (canonicalConstructor(env, constructor)) excluded.add(constructor);
}

function queueMethods(env: CanonEnv, declaration: ClassDeclaration, constructor: ConstructorDeclaration | undefined, excluded: Set<Node>): void {
  const outbox = constructor?.parameters.find(parameter => portType(env, parameter.type, 'QueueOutbox', '@modules/platform/queue')
    && decoratorsHave(env, parameter, 'InjectQueueOutbox', '@modules/platform/queue'));
  if (!outbox || !env.ts.isIdentifier(outbox.name)) return;
  for (const method of declaration.members) {
    if (!env.ts.isMethodDeclaration(method) || method.body?.statements.length !== 1) continue;
    const call = statementCall(env.ts, method.body.statements[0]);
    if (call && env.ts.isCallExpression(call) && receiverMember(env.ts, call) === outbox.name.text && env.ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'write'
      && call.arguments.length === 3 && call.arguments.every(argument => mapping(env, argument))) excluded.add(method);
  }
  if (canonicalConstructor(env, constructor)) excluded.add(constructor);
}

function rowMapper(env: CanonEnv, call: Node | null | undefined, row: string | undefined): boolean {
  const { ts } = env;
  if (!call) return false;
  if (ts.isObjectLiteralExpression(unwrap(ts, call))) return mapping(env, call, iso => ts.isPropertyAccessExpression(iso.expression)
    && iso.expression.name.text === 'toISOString' && iso.arguments.length === 0 && mapping(env, iso.expression.expression));
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return false;
  const [argument] = call.arguments;
  if (!argument || !ts.isIdentifier(argument) || argument.text !== row || !ts.isIdentifier(call.expression)) return false;
  const binding = env.imports.get(call.expression.text);
  return Boolean(binding && /\.rows(?:\.[cm]?ts)?$/.test(binding.source)) || env.mappers.has(call.expression.text);
}

function readResult(env: CanonEnv, expression: Node | null | undefined, row: string | undefined): boolean {
  const { ts } = env;
  const node = unwrap(ts, expression);
  if (!node) return false;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map'
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === row && node.arguments.length === 1) {
    const mapper = unwrap(ts, node.arguments[0]);
    if (!mapper) return false;
    if (ts.isIdentifier(mapper)) return env.mappers.has(mapper.text) || /\.rows(?:\.[cm]?ts)?$/.test(env.imports.get(mapper.text)?.source ?? '');
    return ts.isArrowFunction(mapper) && mapper.parameters.length === 1 && !ts.isBlock(mapper.body) && rowMapper(env, unwrap(ts, mapper.body), identifierText(ts, mapper.parameters[0]?.name));
  }
  if (!ts.isConditionalExpression(node)) return rowMapper(env, node, row);
  const condition = unwrap(ts, node.condition);
  const simpleNull = ts.isBinaryExpression(condition) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(condition.operatorToken.kind)
    && ts.isIdentifier(condition.left) && condition.left.text === row && condition.right.kind === ts.SyntaxKind.NullKeyword;
  if (!(simpleNull || (ts.isIdentifier(condition) && condition.text === row))) return false;
  return [node.whenTrue, node.whenFalse].every(branch => unwrap(ts, branch).kind === ts.SyntaxKind.NullKeyword || rowMapper(env, unwrap(ts, branch), row));
}

function readCall(env: CanonEnv, call: Node | null | undefined, managers: ReadonlySet<string | null | undefined>): boolean {
  const { ts } = env;
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || !managers.has(receiverMember(ts, call))) return false;
  if (READ_METHODS.has(call.expression.name.text)) return call.arguments.length <= 2 && call.arguments.every(argument => mapping(env, argument));
  const sql = call.arguments[0];
  return Boolean(call.expression.name.text === 'query' && sql && ts.isIdentifier(sql) && /^(?:FIND|LIST)_/.test(sql.text)
    && /\.sql(?:\.[cm]?ts)?$/.test(env.imports.get(sql.text)?.source ?? '') && call.arguments.every(argument => mapping(env, argument)));
}

function ownedRead(env: CanonEnv, statement: Statement): boolean {
  const { ts } = env;
  const call = statementCall(ts, statement);
  if (!call || !ts.isCallExpression(call) || !imported(env, call.expression, 'requireOwnedEntity', '@modules/platform/database') || call.arguments.length !== 5) return false;
  if (!call.arguments.slice(0, 4).every(argument => mapping(env, argument))) return false;
  const callback = unwrap(ts, call.arguments[4]);
  if (!callback || !ts.isArrowFunction(callback) || callback.parameters.length || !ts.isBlock(callback.body) || callback.body.statements.length !== 1) return false;
  const thrown = callback.body.statements[0];
  if (!thrown || !ts.isThrowStatement(thrown) || !thrown.expression || !ts.isNewExpression(thrown.expression) || thrown.expression.arguments?.length !== 1) return false;
  const options = thrown.expression.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options) || !mapping(env, options)) return false;
  const code = options.properties.find((property): property is PropertyAssignment => ts.isPropertyAssignment(property) && nameText(ts, property.name) === 'code');
  return Boolean(code && ts.isPropertyAccessExpression(code.initializer) && code.initializer.name.text === 'NotFound');
}

function readMethods(env: CanonEnv, declaration: ClassDeclaration, constructor: ConstructorDeclaration | undefined, excluded: Set<Node>): void {
  const managers = new Set((constructor?.parameters ?? []).filter(parameter => portType(env, parameter.type, 'EntityManager', 'typeorm')
    && nodeDecorators(env.ts, parameter).some(decorator => {
      const call = env.ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
      const binding = env.ts.isIdentifier(call) ? env.imports.get(call.text) : null;
      return binding?.source === '@modules/platform/database' && /^Inject.*EntityManager$/.test(binding.name);
    })).map(parameter => identifierText(env.ts, parameter.name)));
  for (const method of declaration.members) {
    if (!env.ts.isMethodDeclaration(method) || !method.body) continue;
    const statements = method.body.statements;
    const [first, second] = statements;
    if (statements.length === 1 && first && ownedRead(env, first)) { excluded.add(method); continue; }
    if (statements.length !== 2 || !first || !second || !env.ts.isVariableStatement(first) || !env.ts.isReturnStatement(second)) continue;
    const variables = first.declarationList.declarations;
    const [variable] = variables;
    if (variables.length !== 1 || !variable || !env.ts.isIdentifier(variable.name) || !variable.initializer) continue;
    const call = unwrap(env.ts, variable.initializer);
    if (readCall(env, call, managers) && readResult(env, second.expression, variable.name.text)) excluded.add(method);
  }
  if (managers.size && canonicalConstructor(env, constructor)) excluded.add(constructor);
}

function queueDefinition(env: CanonEnv, node: Node): boolean {
  const { ts } = env;
  if (!env.topLevelVariables.has(node) || !ts.isVariableDeclaration(node) || !node.initializer) return false;
  const value = unwrap(ts, node.initializer);
  if (ts.isCallExpression(value) && imported(env, value.expression, 'defineQueue', '@modules/platform/queue'))
    return value.arguments.length === 1 && value.arguments[0] !== undefined && ts.isObjectLiteralExpression(unwrap(ts, value.arguments[0])) && mapping(env, value.arguments[0]);
  if (!ts.isArrowFunction(value) || !portType(env, value.type, 'QueueSchedulerDefinition', '@modules/platform/queue')) return false;
  const returned = ts.isBlock(value.body) && value.body.statements.length === 1 ? value.body.statements[0] : undefined;
  const body = returned && ts.isReturnStatement(returned) ? returned.expression : value.body;
  const object = unwrap(ts, body);
  return Boolean(object && ts.isObjectLiteralExpression(object) && mapping(env, object));
}

function canonEnvironment(ts: TypeScriptApi, sourceFile: SourceFile): CanonEnv {
  const env: CanonEnv = { ts, imports: importsOf(ts, sourceFile, { moduleKey: 'source', stringLiteralsOnly: true }), mappers: new Set<string>(), topLevelVariables: new Set<Node>(), topLevelClasses: new Set<Node>(sourceFile.statements.filter(ts.isClassDeclaration)) };
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const variable of statement.declarationList.declarations) {
      env.topLevelVariables.add(variable);
      const value = variable.initializer && unwrap(ts, variable.initializer);
      if (ts.isIdentifier(variable.name) && value && ts.isArrowFunction(value) && ts.isObjectLiteralExpression(unwrap(ts, value.body)) && mapping(env, value.body)) env.mappers.add(variable.name.text);
    }
  }
  return env;
}

function classScaffolding(env: CanonEnv, node: ClassDeclaration, excluded: Set<Node>): void {
  const { ts } = env;
  const constructor = node.members.find(ts.isConstructorDeclaration);
  if (hasHeritage(env, node, 'ICQRSHandler', '@modules/platform/cqrs', ts.SyntaxKind.ExtendsKeyword)
    && ['CommandHandler', 'QueryHandler'].some(name => decoratorsHave(env, node, name, '@nestjs/cqrs'))) {
    if (canonicalConstructor(env, constructor, true)) excluded.add(constructor);
    const members = propertyParameters(ts, constructor);
    for (const method of node.members) if (ts.isMethodDeclaration(method) && nameText(ts, method.name) === 'process'
      && method.body?.statements.length === 1 && delegation(env, method, method.body.statements[0], members)) excluded.add(method);
  }
  if (hasHeritage(env, node, 'JobStep', '@modules/platform/jobs', ts.SyntaxKind.ImplementsKeyword)) jobMethods(env, node, constructor, excluded);
  queueMethods(env, node, constructor, excluded);
  readMethods(env, node, constructor, excluded);
}

export function canonCloneNodes(ts: TypeScriptApi, sourceFile: SourceFile, profile: string): Set<Node> {
  if (profile === 'fe') return canonJsxCloneNodes(ts, sourceFile);
  const excluded = new Set<Node>();
  const env = canonEnvironment(ts, sourceFile);
  const visit = (node: Node): void => {
    if (queueDefinition(env, node)) { excluded.add(node); return; }
    if (env.topLevelClasses.has(node) && ts.isClassDeclaration(node)) classScaffolding(env, node, excluded);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return excluded;
}

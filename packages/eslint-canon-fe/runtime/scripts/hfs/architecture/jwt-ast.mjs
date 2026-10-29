// jwt-ast.mjs - shared TypeScript-symbol and expression helpers of the identity checks (token verification and the principal).
// Recognition follows imported declarations and inferred types, never local spelling alone.
import { unwrapExpression } from '../../lib/ts-analysis.mjs';
import { accessName as memberName, hasAnyFlag } from '../../lib/ts-ast.mjs';
export { accessName as memberName } from '../../lib/ts-ast.mjs';

export const moduleNameOf = (ts, node) => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (!ts.isCallExpression(node)) return null;
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  return (dynamic || required) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null;
};

export const importedFrom = (kit, checker, node, modules, names = null) => {
  const binding = kit.importBinding(checker, node);
  return Boolean(binding && modules.has(binding.module) && (names === null || names.has(binding.name)));
};

export const unwrap = (ts, node) => unwrapExpression(ts, node, { awaitExpressions: true, satisfiesExpressions: false });

export const callName = (ts, call) => ts.isCallExpression(call) ? memberName(ts, call.expression) : null;

export const chainParts = (ts, expression) => {
  const names = [];
  let current = unwrap(ts, expression);
  while (current) {
    if (ts.isCallExpression(current)) {
      current = unwrap(ts, current.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const name = memberName(ts, current);
      if (name) names.unshift(name);
      current = unwrap(ts, current.expression);
      continue;
    }
    break;
  }
  return names;
};

export const reportAt = (violations, kit, ruleId, file, node, message, extra = {}) => {
  violations.push({ ruleId, ...kit.at(file.rel, file.sourceFile, node), message, ...extra });
};

const declarationsOf = (ts, checker, node) => {
  const target = ts.isPropertyAccessExpression(node) ? node.name : node;
  // A shorthand property (`issuer,`) names the variable it reads, not the property it creates.
  let symbol = ts.isShorthandPropertyAssignment(target.parent ?? {}) && target.parent.name === target
    ? checker.getShorthandAssignmentValueSymbol(target.parent)
    : checker.getSymbolAtLocation(target);
  if (symbol && hasAnyFlag(symbol.flags, ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations ?? [];
};

const configType = (checker, node) => {
  const type = checker.getTypeAtLocation(node);
  return [type.symbol, type.aliasSymbol].some(symbol => symbol?.declarations?.some(declaration =>
    /(?:\.config|\.options|\.env)\.ts$|\/modules\/config\/|\/node_modules\/@nestjs\/config\//u.test(String(declaration.getSourceFile().fileName).replaceAll('\\', '/'))
    || /(?:Config|Options|Env)$/u.test(symbol.name)));
};

/** Trace an issuer or audience to typed configuration values through local URL/string transformations. */
const fromConfig = (ts, checker, expression, seen = new Set()) => {
  const node = unwrap(ts, expression);
  if (!node || seen.has(node)) return false;
  const next = new Set(seen).add(node);
  if (ts.isIdentifier(node)) {
    return declarationsOf(ts, checker, node).some(declaration => {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return fromConfig(ts, checker, declaration.initializer, next);
      if (ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration)) return configType(checker, node);
      return /(?:\.config|\.env)\.ts$|\/modules\/config\//u.test(String(declaration.getSourceFile().fileName).replaceAll('\\', '/'));
    });
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return fromConfig(ts, checker, node.expression, next) || declarationsOf(ts, checker, node).some(declaration =>
      (ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration)) && !declaration.initializer && configType(checker, node));
  }
  if (ts.isTemplateExpression(node)) return node.templateSpans.some(span => fromConfig(ts, checker, span.expression, next));
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return fromConfig(ts, checker, node.left, next) || fromConfig(ts, checker, node.right, next);
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return fromConfig(ts, checker, node.expression, next) || node.arguments?.some(argument => fromConfig(ts, checker, argument, next));
  }
  return false;
};

const objectValue = (ts, checker, expression) => {
  const node = unwrap(ts, expression);
  if (!node) return null;
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return null;
  return declarationsOf(ts, checker, node).find(declaration => ts.isVariableDeclaration(declaration)
    && declaration.initializer && ts.isObjectLiteralExpression(unwrap(ts, declaration.initializer)))?.initializer ?? null;
};

const literalString = (ts, checker, expression) => {
  const node = unwrap(ts, expression);
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  const type = checker.getTypeAtLocation(node);
  return type.isStringLiteral?.() ? type.value : null;
};

/** A role read must belong to the payload produced by this verification, including destructuring aliases. */
const verifiedPayload = (ts, checker, expression, call, seen = new Set()) => {
  const node = unwrap(ts, expression);
  if (!node || seen.has(node)) return false;
  const next = new Set(seen).add(node);
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(ts, node) === 'payload') {
    const value = unwrap(ts, node.expression);
    if (value === call) return true;
    if (ts.isIdentifier(value)) return declarationsOf(ts, checker, value).some(declaration =>
      ts.isVariableDeclaration(declaration) && unwrap(ts, declaration.initializer) === call);
  }
  if (!ts.isIdentifier(node)) return false;
  return declarationsOf(ts, checker, node).some(declaration => {
    if (ts.isVariableDeclaration(declaration)) return declaration.initializer && verifiedPayload(ts, checker, declaration.initializer, call, next);
    if (!ts.isBindingElement(declaration) || (declaration.propertyName ?? declaration.name).getText() !== 'payload') return false;
    return unwrap(ts, declaration.parent.parent.initializer) === call;
  });
};

const rejects = (ts, statement) => {
  if (ts.isBlock(statement)) {
    const exit = statement.statements.find(item => ts.isThrowStatement(item) || ts.isReturnStatement(item));
    return Boolean(exit && rejects(ts, exit));
  }
  if (ts.isThrowStatement(statement)) return true;
  if (!ts.isReturnStatement(statement)) return false;
  const value = statement.expression && unwrap(ts, statement.expression);
  return !value || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isCallExpression(value) && /^(?:refused|err|fail|failure)$/u.test(value.expression.getText()));
};

const roleCondition = (ts, checker, condition, call, equality = false) => {
  const node = unwrap(ts, condition);
  if (!node || !ts.isBinaryExpression(node)) return false;
  const combined = equality ? ts.SyntaxKind.AmpersandAmpersandToken : ts.SyntaxKind.BarBarToken;
  if (node.operatorToken.kind === combined) return roleCondition(ts, checker, node.left, call, equality) || roleCondition(ts, checker, node.right, call, equality);
  const operators = equality ? [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]
    : [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken];
  if (!operators.includes(node.operatorToken.kind)) return false;
  const role = expression => (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && memberName(ts, expression) === 'role' && verifiedPayload(ts, checker, expression.expression, call);
  return (role(node.left) && literalString(ts, checker, node.right) === 'authenticated')
    || (role(node.right) && literalString(ts, checker, node.left) === 'authenticated');
};

const returnsPrincipal = (ts, statement) => {
  let accepted = false;
  const visit = node => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && !rejects(ts, node)) accepted = true;
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return accepted;
};

const statementsAfterVerify = (ts, call) => {
  let statement = call;
  while (statement.parent && !ts.isBlock(statement.parent)) statement = statement.parent;
  const block = statement.parent;
  if (!block || !ts.isBlock(block)) return [];
  return block.statements.slice(block.statements.indexOf(statement) + 1);
};

const rejectsRoleGuard = (ts, checker, statement, call) => {
  if (!ts.isIfStatement(statement)) return false;
  if (roleCondition(ts, checker, statement.expression, call) && rejects(ts, statement.thenStatement)) return true;
  return Boolean(statement.elseStatement && roleCondition(ts, checker, statement.expression, call, true) && rejects(ts, statement.elseStatement));
};

const rejectsOtherRoles = (ts, checker, call) => {
  for (const item of statementsAfterVerify(ts, call)) {
    if (ts.isReturnStatement(item) || ts.isThrowStatement(item)) return false;
    if (rejectsRoleGuard(ts, checker, item, call)) return true;
    if (returnsPrincipal(ts, item)) return false;
  }
  return false;
};

/** R260 is shared by the architecture machine and the published typed ESLint rule. */
export const jwtPolicyProblems = (ts, checker, call) => {
  const problems = [];
  const options = objectValue(ts, checker, call.arguments[2]);
  const property = name => options?.properties.findLast(entry =>
    (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry))
    && (ts.isIdentifier(entry.name) || ts.isStringLiteralLike(entry.name)) && entry.name.text === name);
  const value = name => {
    const entry = property(name);
    return entry && unwrap(ts, ts.isPropertyAssignment(entry) ? entry.initializer : entry.name);
  };
  const algorithms = value('algorithms');
  const secure = new Set(['ES256', 'RS256', 'EdDSA']);
  if (!algorithms || !ts.isArrayLiteralExpression(algorithms) || !algorithms.elements.length
    || algorithms.elements.some(item => !ts.isStringLiteralLike(item) || !secure.has(item.text))
    || options?.properties.some(entry => ts.isSpreadAssignment(entry))) {
    problems.push('BE_JWT_ALG_PINNED: algorithms must be a non-empty literal subset of ES256, RS256 and EdDSA.');
  }
  if (!fromConfig(ts, checker, value('issuer'))) problems.push('BE_JWT_ALG_PINNED: issuer must derive from typed configuration.');
  // The principal is bound either by an audience of typed configuration (an OIDC client such as Keycloak, the app's own
  // Passport tokens) or, where the audience is shared by every token of the issuer (Supabase's literal 'authenticated'),
  // by rejecting every role other than authenticated before the principal is returned.
  if (!fromConfig(ts, checker, value('audience')) && !rejectsOtherRoles(ts, checker, call)) {
    problems.push('BE_JWT_ALG_PINNED: an OIDC verifier audience must derive from typed configuration, or the verified principal must reject every role other than authenticated before returning it.');
  }
  return problems;
};

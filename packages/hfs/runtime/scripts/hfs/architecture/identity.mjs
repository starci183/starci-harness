// identity.mjs - the back-end identity machine. Under lite the one token verifier is be.integrations.passport: jose's jwtVerify
// there checks the app's OWN key set (createLocalJWKSet over the keys it signs with, never createRemoteJWKSet), pins issuer,
// audience and algorithms, and no file decodes a token unverified or reads authorization claims from a request body (R329).
// In both editions every jwtVerify call holds the JWT policy (R260, jwtPolicyProblems).
import path from 'node:path';
import { machineKit } from './machine-ast.mjs';
import { importedFrom, jwtPolicyProblems, reportAt, unwrap } from './jwt-ast.mjs';
import { accessName } from '../../lib/ts-ast.mjs';

const PASSPORT_SLOT = 'be.integrations.passport';
const BE_JWT_VERIFIED = 'BE_AUTH_JWT_OWN_JWKS';

/** The rule ids the back-end identity machine reports. */
export const IDENTITY_RULE_IDS = Object.freeze(['BE_AUTH_JWT_OWN_JWKS', 'BE_JWT_ALG_PINNED']);
const JWT_MODULES = new Set(['jose', 'jsonwebtoken', 'jwt-decode']);
const CLAIM_NAMES = new Set(['role', 'roles', 'membership', 'memberships']);

const objectLiteral = (kit, checker, node) => {
  const current = unwrap(kit.ts, node);
  if (kit.ts.isObjectLiteralExpression(current)) return current;
  if (!kit.ts.isIdentifier(current)) return null;
  for (const declaration of kit.declarationsOf(checker, current)) {
    if (kit.ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const value = unwrap(kit.ts, declaration.initializer);
      if (kit.ts.isObjectLiteralExpression(value)) return value;
    }
  }
  return null;
};

const staticStrings = (kit, checker, node) => {
  const current = unwrap(kit.ts, node);
  if (kit.ts.isStringLiteralLike(current)) return [current.text];
  if (kit.ts.isArrayLiteralExpression(current) && current.elements.every((element) => kit.ts.isStringLiteralLike(element))) return current.elements.map((element) => element.text);
  const value = kit.stringValue(checker, current);
  return value === null ? null : [value];
};

const jwksArgument = (kit, checker, node) => {
  const current = unwrap(kit.ts, node);
  if (kit.ts.isCallExpression(current)) return importedFrom(kit, checker, current.expression, new Set(['jose']), new Set(['createLocalJWKSet']));
  if (!kit.ts.isIdentifier(current)) return false;
  return kit.declarationsOf(checker, current).some((declaration) => kit.ts.isVariableDeclaration(declaration) && declaration.initializer
    && jwksArgument(kit, checker, declaration.initializer));
};

const importedCall = (kit, checker, call) => {
  const direct = kit.importBinding(checker, call.expression);
  if (direct?.module === 'jwt-decode' && direct.name === 'default') return { module: direct.module, name: 'jwtDecode' };
  if (direct) return direct;
  if (!kit.ts.isPropertyAccessExpression(call.expression) || !kit.ts.isIdentifier(call.expression.expression)) return null;
  const owner = kit.importBinding(checker, call.expression.expression);
  return owner?.name === 'default' ? { module: owner.module, name: call.expression.name.text } : null;
};

const requestLike = (ts, node) => {
  const current = unwrap(ts, node);
  if (ts.isIdentifier(current)) return /^(?:req|request)$/iu.test(current.text);
  return (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) && accessName(ts, current) === 'request';
};

const fromRequestBody = (kit, checker, node, seen = new Set()) => {
  const current = unwrap(kit.ts, node);
  if (!current || seen.has(current)) return false;
  seen.add(current);
  if (kit.ts.isPropertyAccessExpression(current) || kit.ts.isElementAccessExpression(current)) {
    if (accessName(kit.ts, current) === 'body' && requestLike(kit.ts, current.expression)) return true;
    return fromRequestBody(kit, checker, current.expression, seen);
  }
  if (!kit.ts.isIdentifier(current)) return false;
  return kit.declarationsOf(checker, current).some(declaration => kit.ts.isVariableDeclaration(declaration) && declaration.initializer
    && fromRequestBody(kit, checker, declaration.initializer, seen));
};

function verifyJwtCall(kit, checker, file, node, counters, violations) {
  counters.verifyCalls += 1;
  if (file.slot !== PASSPORT_SLOT) {
    reportAt(violations, kit, BE_JWT_VERIFIED, file, node, `jwtVerify is called outside ${PASSPORT_SLOT}; the integration is the one token verifier.`);
    return true;
  }
  const options = objectLiteral(kit, checker, node.arguments[2]);
  const property = name => options ? kit.propertyOf(options, name) : null;
  const values = name => {
    const entry = property(name);
    return entry ? staticStrings(kit, checker, kit.valueOfProperty(entry)) : null;
  };
  const issuer = property('issuer');
  const audience = values('audience');
  const algorithms = values('algorithms');
  const good = jwksArgument(kit, checker, node.arguments[1]) && issuer != null && audience !== null && audience.length > 0
    && algorithms !== null && algorithms.length > 0;
  if (!good) {
    reportAt(violations, kit, BE_JWT_VERIFIED, file, node, 'jwtVerify must check the app\'s own key set (createLocalJWKSet(...) over the keys integrations/passport signs with) and pin issuer, audience and a non-empty algorithms list; jwtVerify then enforces signature and exp.');
  } else counters.verifiedCalls += 1;
  return false;
}

function inspectJwtCall(kit, checker, file, node, counters, violations) {
  const binding = importedCall(kit, checker, node);
  if (binding && JWT_MODULES.has(binding.module) && ['decode', 'decodeJwt', 'jwtDecode'].includes(binding.name)) {
    reportAt(violations, kit, BE_JWT_VERIFIED, file, node, `${binding.module}.${binding.name} decodes a token without proving its signature; verify it through integrations/passport.`, { module: binding.module, method: binding.name });
  }
  if (binding?.module === 'jose' && binding.name === 'jwtVerify') return verifyJwtCall(kit, checker, file, node, counters, violations);
  return false;
}

function inspectRequestClaims(kit, file, node, checker, violations) {
  const { ts } = kit;
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && CLAIM_NAMES.has(accessName(ts, node))) {
    const claim = accessName(ts, node);
    if (fromRequestBody(kit, checker, node.expression)) reportAt(violations, kit, BE_JWT_VERIFIED, file, node, `${claim} is read from the request body; authorization claims come only from the verified token or the database.`, { claim });
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && fromRequestBody(kit, checker, node.initializer)) {
    for (const element of node.name.elements) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property) && CLAIM_NAMES.has(property.text)) reportAt(violations, kit, BE_JWT_VERIFIED, file, element, `${property.text} is destructured from the request body; authorization claims come only from the verified token or the database.`, { claim: property.text });
    }
  }
}

function inspectBackendNode(kit, checker, file, node, counters, violations) {
  const handled = kit.ts.isCallExpression(node) && inspectJwtCall(kit, checker, file, node, counters, violations);
  if (!handled) inspectRequestClaims(kit, file, node, checker, violations);
}

function checkOwnJwks(input) {
  const kit = machineKit(input);
  const violations = [];
  const integrations = [...input.graph.files.values()].filter((file) => file.slot === PASSPORT_SLOT);
  if (!integrations.length) return { violations, coverage: { status: 'not-applicable', integrationFiles: 0, verifiedCalls: 0 } };
  const counters = { verifyCalls: 0, verifiedCalls: 0 };
  for (const file of input.graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, node => inspectBackendNode(kit, checker, file, node, counters, violations));
  }
  if (counters.verifyCalls === 0) {
    const anchor = integrations.find((file) => path.posix.basename(file.rel).endsWith('.tokens.ts')) ?? integrations[0];
    reportAt(violations, kit, BE_JWT_VERIFIED, anchor, anchor.sourceFile, `${PASSPORT_SLOT} has no jose.jwtVerify call backed by createLocalJWKSet over the app's own keys.`);
  }
  return { violations, coverage: { status: 'checked', integrationFiles: integrations.length, verifyCalls: counters.verifyCalls, verifiedCalls: counters.verifiedCalls } };
}

/** R260 BE_JWT_ALG_PINNED: every jose jwtVerify call pins a literal secure algorithm list and a configured issuer, and binds the principal by a configured audience or the authenticated role. */
export function checkJwtPolicy(input) {
  const kit = machineKit(input);
  const violations = [];
  let verifyCalls = 0;
  for (const file of input.graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, node => {
      if (!kit.ts.isCallExpression(node) || !kit.isImportOf(checker, node.expression, 'jwtVerify', 'jose')) return;
      verifyCalls += 1;
      const problems = jwtPolicyProblems(kit.ts, checker, node);
      if (problems.length) reportAt(violations, kit, 'BE_JWT_ALG_PINNED', file, node, problems.join(' '));
    });
  }
  return { violations, coverage: { status: 'checked', verifyCalls } };
}

/** The back-end identity machine: the own-JWKS law where the passport integration exists (lite), the JWT policy everywhere. */
export function checkBackendIdentity(input) {
  const slot = input.graph.resolver.slot(PASSPORT_SLOT);
  const own = slot && input.graph.resolver.slotEnabled(slot) ? checkOwnJwks(input) : { violations: [], coverage: { status: 'not-applicable', reason: 'no passport integration slot (full edition)' } };
  const policy = checkJwtPolicy(input);
  return { violations: [...own.violations, ...policy.violations], coverage: { status: 'checked', ownJwks: own.coverage, jwtPolicy: policy.coverage } };
}

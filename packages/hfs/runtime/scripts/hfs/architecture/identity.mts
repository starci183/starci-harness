// identity.mts - the back-end identity machine. Under lite the one token verifier is @starci/auth, composed by be.integrations.passport:
// no app file calls jose's jwtVerify, decodes a token unverified or reads authorization claims from a request body (R329), and the
// passport integration imports @starci/auth/server. In both editions every jwtVerify call holds the JWT policy (R260, jwtPolicyProblems).
import path from 'node:path';
import type { CallExpression, Expression, Node, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile } from './hfs-graph.mjs';
import type { CheckResult, HfsCheckInput, MachineKit } from './context-map.mjs';
import { machineKit } from './machine-ast.mjs';
import { jwtPolicyProblems, reportAt, unwrap } from './jwt-ast.mjs';
import { accessName } from '../../lib/ts-ast.mjs';

const PASSPORT_SLOT = 'be.integrations.passport';
const PACKAGE_ENTRY = '@starci/auth/server';
const BE_JWT_VERIFIED = 'BE_AUTH_JWT_OWN_JWKS';

/** How many jwtVerify calls were seen (each is a finding). */
interface Counters {
  verifyCalls: number;
}

/** The rule ids the back-end identity machine reports. */
export const IDENTITY_RULE_IDS = Object.freeze(['BE_AUTH_JWT_OWN_JWKS', 'BE_JWT_ALG_PINNED']);
const JWT_MODULES = new Set(['jose', 'jsonwebtoken', 'jwt-decode']);
const CLAIM_NAMES = new Set(['role', 'roles', 'membership', 'memberships']);

const importedCall = (kit: MachineKit, checker: TypeChecker, call: CallExpression): { module: string; name: string } | null => {
  const direct = kit.importBinding(checker, call.expression);
  if (direct?.module === 'jwt-decode' && direct.name === 'default') return { module: direct.module, name: 'jwtDecode' };
  if (direct) return direct;
  if (!kit.ts.isPropertyAccessExpression(call.expression) || !kit.ts.isIdentifier(call.expression.expression)) return null;
  const owner = kit.importBinding(checker, call.expression.expression);
  return owner?.name === 'default' ? { module: owner.module, name: call.expression.name.text } : null;
};

const requestLike = (ts: TypeScriptApi, node: Expression): boolean => {
  const current = unwrap(ts, node);
  if (ts.isIdentifier(current)) return /^(?:req|request)$/iu.test(current.text);
  return (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) && accessName(ts, current) === 'request';
};

const fromRequestBody = (kit: MachineKit, checker: TypeChecker, node: Expression | undefined, seen = new Set<Node>()): boolean => {
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

function inspectJwtCall(kit: MachineKit, checker: TypeChecker, file: GraphFile, node: CallExpression, counters: Counters, violations: ArchitectureViolation[]): boolean {
  const binding = importedCall(kit, checker, node);
  if (binding && JWT_MODULES.has(binding.module) && ['decode', 'decodeJwt', 'jwtDecode'].includes(binding.name)) {
    reportAt(violations, kit, BE_JWT_VERIFIED, file, node, `${binding.module}.${binding.name} decodes a token without proving its signature; verify it through integrations/passport.`, { module: binding.module, method: binding.name });
  }
  if (binding?.module === 'jose' && binding.name === 'jwtVerify') {
    counters.verifyCalls += 1;
    reportAt(violations, kit, BE_JWT_VERIFIED, file, node, 'jwtVerify is called in the app; @starci/auth verifies the own access tokens, reached through ' + PASSPORT_SLOT + '.');
    return true;
  }
  return false;
}

function inspectRequestClaims(kit: MachineKit, file: GraphFile, node: Node, checker: TypeChecker, violations: ArchitectureViolation[]): void {
  const { ts } = kit;
  const claim = accessName(ts, node);
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && claim !== null && CLAIM_NAMES.has(claim)) {
    if (fromRequestBody(kit, checker, node.expression)) reportAt(violations, kit, BE_JWT_VERIFIED, file, node, `${claim} is read from the request body; authorization claims come only from the verified token or the database.`, { claim });
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && fromRequestBody(kit, checker, node.initializer)) {
    for (const element of node.name.elements) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property) && CLAIM_NAMES.has(property.text)) reportAt(violations, kit, BE_JWT_VERIFIED, file, element, `${property.text} is destructured from the request body; authorization claims come only from the verified token or the database.`, { claim: property.text });
    }
  }
}

function inspectBackendNode(kit: MachineKit, checker: TypeChecker, file: GraphFile, node: Node, counters: Counters, violations: ArchitectureViolation[]): void {
  const handled = kit.ts.isCallExpression(node) && inspectJwtCall(kit, checker, file, node, counters, violations);
  if (!handled) inspectRequestClaims(kit, file, node, checker, violations);
}

function checkOwnJwks(input: HfsCheckInput): CheckResult {
  const kit = machineKit(input);
  const violations: ArchitectureViolation[] = [];
  const integrations = [...input.graph.files.values()].filter((file) => file.slot === PASSPORT_SLOT);
  if (!integrations.length) return { violations, coverage: { status: 'not-applicable', integrationFiles: 0, verifyCalls: 0 } };
  const counters: Counters = { verifyCalls: 0 };
  for (const file of input.graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => inspectBackendNode(kit, checker, file, node, counters, violations));
  }
  const composes = integrations.some((file) => file.sourceFile.statements.some((statement) => kit.ts.isImportDeclaration(statement)
    && kit.ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === PACKAGE_ENTRY));
  const anchor = integrations.find((file) => path.posix.basename(file.rel) === 'index.ts') ?? integrations[0];
  if (!composes && anchor)
    reportAt(violations, kit, BE_JWT_VERIFIED, anchor, anchor.sourceFile, PASSPORT_SLOT + ' does not import ' + PACKAGE_ENTRY + ', the one verifier of the own access tokens.');
  return { violations, coverage: { status: 'checked', integrationFiles: integrations.length, verifyCalls: counters.verifyCalls, composesPackage: composes } };
}

/** R260 BE_JWT_ALG_PINNED: every jose jwtVerify call pins a literal secure algorithm list and a configured issuer, and binds the principal by a configured audience or the authenticated role. */
export function checkJwtPolicy(input: HfsCheckInput): CheckResult {
  const kit = machineKit(input);
  const violations: ArchitectureViolation[] = [];
  let verifyCalls = 0;
  for (const file of input.graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => {
      if (!kit.ts.isCallExpression(node) || !kit.isImportOf(checker, node.expression, 'jwtVerify', 'jose')) return;
      verifyCalls += 1;
      const problems = jwtPolicyProblems(kit.ts, checker, node);
      if (problems.length) reportAt(violations, kit, 'BE_JWT_ALG_PINNED', file, node, problems.join(' '));
    });
  }
  return { violations, coverage: { status: 'checked', verifyCalls } };
}

/** The back-end identity machine: the own-JWKS law where the passport integration exists (lite), the JWT policy everywhere. */
export function checkBackendIdentity(input: HfsCheckInput): CheckResult {
  const slot = input.graph.resolver.slot(PASSPORT_SLOT);
  const own = slot && input.graph.resolver.slotEnabled(slot) ? checkOwnJwks(input) : { violations: [], coverage: { status: 'not-applicable', reason: 'no passport integration slot (full edition)' } };
  const policy = checkJwtPolicy(input);
  return { violations: [...own.violations, ...policy.violations], coverage: { status: 'checked', ownJwks: own.coverage, jwtPolicy: policy.coverage } };
}

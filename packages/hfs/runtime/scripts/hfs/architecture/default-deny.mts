import { machineKit } from './machine-ast.mjs';
import type { ProviderEntry } from './machine-ast.mjs';
import type { CallExpression, Declaration, ExpressionWithTypeArguments, Node, Symbol as TsSymbol, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, CheckInput, GraphFile, HfsGraph } from './hfs-graph.mjs';

type Kit = ReturnType<typeof machineKit>;
type Role = 'throttler' | 'csrf' | 'credential' | 'auth';
type KeyCache = Map<string, Set<TsSymbol>>;

interface GuardRole {
  guard: ProviderEntry;
  role: Role | null;
}

interface GuardMessage {
  node: Node;
  message: string;
}

/**
 * R41 `default-deny-app-guard` (BE_DEFAULT_DENY). Every api app root provides its `APP_GUARD` entries in the order
 * throttler -> CSRF origin guard -> CredentialGuard -> AuthGuard, each exactly once, so no request reaches a handler before it was
 * rate-limited, origin-checked, credential-authenticated and admitted. A guard is classified by structure, never by name or folder alone
 * (BE-CONVENTION 1.7 names the roles, not a library):
 *   - throttler: a class of @nestjs/throttler or one that extends it, or a guard that reads through a Reflector the
 *     per-door metadata (the `@RateLimit(tier)` decorator) that a SetMetadata call of its own capability writes;
 *   - CSRF origin guard: a guard declared in platform/http-security that reads the request origin or referer header;
 *   - CredentialGuard: the `CredentialGuard` class declared in domain/identity;
 *   - AuthGuard: the `AuthGuard` class declared in domain/identity.
 * Other guards are permitted between them; a missing, repeated or reordered one of the three is a finding.
 */
export const DEFAULT_DENY_RULE_IDS = ['BE_DEFAULT_DENY'];

const RULE = 'BE_DEFAULT_DENY';
const ORDER: Role[] = ['throttler', 'csrf', 'credential', 'auth'];
const ORIGIN_HEADERS = new Set(['origin', 'referer', 'referrer']);
const METADATA_READERS = new Set(['get', 'getAll', 'getAllAndMerge', 'getAllAndOverride']);
const LABEL: Record<Role, string> = { throttler: 'the throttler guard', csrf: 'the CSRF origin guard of platform/http-security', credential: 'CredentialGuard of domain/identity', auth: 'AuthGuard of domain/identity' };

const keySymbol = (kit: Kit, checker: TypeChecker, node: Node | null | undefined): TsSymbol | null => (node ? kit.aliased(checker, kit.symbolAt(checker, node)) ?? null : null);

const extendsThrottlerType = (kit: Kit, checker: TypeChecker, declaration: Node, type: ExpressionWithTypeArguments, depth: number): boolean => {
  if (kit.isImportOf(checker, type.expression, 'ThrottlerGuard', '@nestjs/throttler')) return true;
  return kit.declarationsOf(checker, type.expression).some(parent => parent !== declaration && extendsThrottler(kit, parent, depth + 1));
};

function extendsThrottler(kit: Kit, declaration: Node, depth = 0): boolean {
  const ts: TypeScriptApi = kit.ts;
  if (!ts.isClassDeclaration(declaration) || depth > 8) return false;
  const checker = kit.checkerOf(declaration.getSourceFile());
  if (!checker) return false;
  const types = (declaration.heritageClauses ?? []).flatMap(clause => [...clause.types]);
  return types.some(type => extendsThrottlerType(kit, checker, declaration, type, depth));
}

const collectSetMetadataKeys = (kit: Kit, file: GraphFile, keys: Set<TsSymbol>): void => {
  const { ts } = kit;
  const checker = kit.checkerOf(file.sourceFile);
  if (!checker) return;
  kit.walk(file.sourceFile, (node: Node) => {
    if (ts.isCallExpression(node) && kit.isImportOf(checker, node.expression, 'SetMetadata', '@nestjs/common')) {
      const key = keySymbol(kit, checker, node.arguments[0]);
      if (key) keys.add(key);
    }
    return true;
  });
};

/** The symbols a SetMetadata call of the owner writes as metadata keys: what its door decorators (`@RateLimit(tier)`) attach. */
const writtenKeys = (kit: Kit, graph: HfsGraph, owner: { root: string }, cache: KeyCache): Set<TsSymbol> => {
  const cached = cache.get(owner.root);
  if (cached) return cached;
  const keys = new Set<TsSymbol>();
  for (const file of graph.files.values()) {
    if (file.owner?.root === owner.root) collectSetMetadataKeys(kit, file, keys);
  }
  cache.set(owner.root, keys);
  return keys;
};

/** True when the class reads a request origin or referer header (the origin/referer allowlist of the CSRF guard). */
const readsOrigin = (kit: Kit, declaration: Node): boolean => {
  const { ts } = kit;
  let found = false;
  kit.walk(declaration, (node: Node) => {
    let name: string | null = null;
    if (ts.isPropertyAccessExpression(node)) name = node.name.text;
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) name = node.argumentExpression.text;
    if (name && ORIGIN_HEADERS.has(name.toLowerCase())) found = true;
    return !found;
  });
  return found;
};

const isMetadataRead = (ts: TypeScriptApi, node: Node): node is CallExpression => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && METADATA_READERS.has(node.expression.name.text);

/** True when the class reads, through a metadata getter, a key its own capability's SetMetadata decorators write. */
const readsDoorMetadata = (kit: Kit, graph: HfsGraph, keyCache: KeyCache, declaration: Node, owner: { root: string }): boolean => {
  const checker = kit.checkerOf(declaration.getSourceFile());
  if (!checker) return false;
  const keys = writtenKeys(kit, graph, owner, keyCache);
  let found = false;
  kit.walk(declaration, (node: Node) => {
    if (isMetadataRead(kit.ts, node)) {
      const key = keySymbol(kit, checker, node.arguments[0]);
      if (key && keys.has(key)) found = true;
    }
    return !found;
  });
  return found;
};

const classifyDeclaration = (kit: Kit, graph: HfsGraph, keyCache: KeyCache, declaration: Declaration): Role | null => {
  const ts: TypeScriptApi = kit.ts;
  const owner = kit.ownerOfDeclaration(declaration);
  if (owner?.tier === 'platform' && owner.name === 'http-security' && ts.isClassDeclaration(declaration)) {
    if (readsOrigin(kit, declaration)) return 'csrf';
    if (readsDoorMetadata(kit, graph, keyCache, declaration, owner)) return 'throttler';
  }
  if (owner?.tier === 'domain' && owner.name === 'identity' && ts.isClassDeclaration(declaration) && declaration.name?.text === 'AuthGuard') return 'auth';
  if (owner?.tier === 'domain' && owner.name === 'identity' && ts.isClassDeclaration(declaration) && declaration.name?.text === 'CredentialGuard') return 'credential';
  return null;
};

const classify = (kit: Kit, graph: HfsGraph, keyCache: KeyCache, checker: TypeChecker, node: Node | null | undefined): Role | null => {
  if (!node) return null;
  if (kit.importBinding(checker, node)?.module === '@nestjs/throttler') return 'throttler';
  const declarations = kit.declarationsOf(checker, node);
  if (declarations.some(declaration => extendsThrottler(kit, declaration))) return 'throttler';
  for (const declaration of declarations) {
    const role = classifyDeclaration(kit, graph, keyCache, declaration);
    if (role) return role;
  }
  return null;
};

const roleMessages = (app: { name: string }, roles: GuardRole[], anchor: Node): GuardMessage[] => {
  const out: GuardMessage[] = [];
  for (const role of ORDER) {
    const entries = roles.filter(item => item.role === role);
    if (entries.length === 0) out.push({ node: anchor, message: `App ${app.name} does not provide ${LABEL[role]} as an APP_GUARD; an api app is denied by default: throttler, then CSRF origin guard, then CredentialGuard, then AuthGuard.` });
    else if (entries.length > 1 && entries[1]) out.push({ node: entries[1].guard.node, message: `App ${app.name} provides ${LABEL[role]} more than once as an APP_GUARD.` });
  }
  return out;
};

const orderMessages = (app: { name: string }, roles: GuardRole[]): GuardMessage[] => {
  const indexes = ORDER.map(role => roles.findIndex(item => item.role === role));
  if (!indexes.every(index => index >= 0)) return [];
  const out: GuardMessage[] = [];
  for (let i = 1; i < indexes.length; i += 1) {
    const index = indexes[i];
    const previous = indexes[i - 1];
    const role = ORDER[i];
    const before = ORDER[i - 1];
    const entry = index === undefined ? undefined : roles[index];
    if (index === undefined || previous === undefined || role === undefined || before === undefined || entry === undefined) continue;
    if (index < previous) out.push({ node: entry.guard.node, message: `App ${app.name} provides ${LABEL[role]} before ${LABEL[before]}; the APP_GUARD order is throttler, CSRF origin guard, CredentialGuard, AuthGuard.` });
  }
  return out;
};

export function checkDefaultDeny(input: CheckInput) {
  const { config } = input;
  const kit = machineKit(input);
  const violations: ArchitectureViolation[] = [];
  const keyCache: KeyCache = new Map();
  let apps = 0;

  for (const app of config.apps.filter(item => item.kind === 'api')) {
    const root = kit.appRoot(app.name);
    if (!root) continue;
    apps += 1;
    const guards = kit.providersOf(root, 'APP_GUARD', '@nestjs/core');
    const roles: GuardRole[] = guards.map(guard => ({ guard, role: classify(kit, input.graph, keyCache, guard.checker, guard.useClass) }));
    const anchor = guards[0]?.node ?? root.sourceFile.statements[0] ?? root.sourceFile;
    const messages = [...roleMessages(app, roles, anchor), ...orderMessages(app, roles)];
    for (const { node, message } of messages) violations.push({ ruleId: RULE, path: root.rel, ...kit.at(root.rel, root.sourceFile, node), app: app.name, message });
  }
  return { violations, coverage: { status: 'checked', apps } };
}

import path from 'node:path';
import type {
  AsExpression, CallExpression, Declaration, Decorator, Expression, Identifier, Node, NonNullExpression, ObjectLiteralExpression,
  ParenthesizedExpression, PropertyAccessExpression, SatisfiesExpression, TypeChecker, VariableDeclaration,
} from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, CheckInput, GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { DeclarationOwner, MachineKit } from './machine-ast.mjs';
import type { TypeContext } from './type-context.mjs';
import { pascal } from './machine-ast.mjs';
import { DATABASE_DIR } from './connection-map.mjs';

/** The TypeScript reading kit `machineKit` builds for the machine checks. */
export type { MachineKit };

/** The slot resolver (config.hfs). */
export type SlotResolver = ArchitectureConfig['hfs'];

/** The TypeScript context (programs, source files, import edges) the checks read. */
export type TypeScriptContext = TypeContext;

/** What every HFS graph check receives: the layout config, the TypeScript context and the file and owner graph. */
export type HfsCheckInput = CheckInput;

/** What a check returns: its findings and how much of the program it could judge. */
export interface CheckResult {
  violations: ArchitectureViolation[];
  coverage: { status: string; [detail: string]: unknown };
}

/** A source file of the program that a persistence array or a registration literal sits in, and the node there. */
export interface RegistrationSite {
  file: GraphFile;
  node: Node;
}

/** A capability's persistence arrays as registered: its name and the connections it is registered on (first site each). */
export interface RegisteredCapability {
  name: string;
  connections: Map<string, RegistrationSite>;
}

/** One registration literal of the program; `connection` is null when its name cannot be resolved. */
export interface RegistrationLiteral extends RegistrationSite {
  connection: string | null;
}

/** The persistence location of a be.persistence file: the persistence root, its capability, the folder below it and the path below the root. */
export interface PersistenceInfo {
  root: string;
  capability: string;
  folder: string;
  below: string[];
}

/** What `collectRegistrations` reads: the kit, the graph and the persistence classifier. */
export interface RegistrationInput {
  kit: MachineKit;
  graph: HfsGraph;
  persistenceOf: (rel: string) => PersistenceInfo | null;
}

/** What `collectRegistrations` returns. */
export interface RegistrationMap {
  registered: Map<string, RegisteredCapability>;
  registrations: number;
  all: RegistrationLiteral[];
}

/** A declared connection of hfs.json. */
export interface DeclaredConnection {
  name: string;
  owner: string;
}

/** The bounded-context model of a program. */
export interface ContextModel {
  declared: Map<string, DeclaredConnection>;
  registered: Map<string, RegisteredCapability>;
  registrations: RegistrationLiteral[];
  perConnection: Set<string>;
  contextOfCapability: (root: string) => string | null;
  contextOfFile: (rel: string) => string | null;
  connectionOfManager: (checker: TypeChecker, expression: Node) => string | null;
  unparen: (node: Node) => Node | undefined;
}

/** A declared connection passed to the database module registration by an app's composition. */
export interface ComposedConnection {
  connection: string;
  node: Node;
  file: GraphFile;
}

/** The property-assignment sources of one name over the program. */
interface PropertySource {
  declaration: Declaration | null;
  initializer: Expression;
  checker: TypeChecker;
}

/** A capability array (`<c>Entities` / `<c>Migrations`) a registration literal lists. */
interface CapabilityArray {
  key: string;
  name: string;
}

interface NamingContext {
  kit: MachineKit;
  graph: HfsGraph;
  persistenceOf: (rel: string) => PersistenceInfo | null;
  propertySources: Map<string, PropertySource[]>;
}

type ExpressionWrapper = ParenthesizedExpression | AsExpression | NonNullExpression;
type RegistrationWrapper = ExpressionWrapper | SatisfiesExpression;

/** A variable declaration whose name is an identifier. */
interface NamedVariable extends VariableDeclaration {
  name: Identifier;
}

const camel = (name: string): string => { const text: string = pascal(name); return text.charAt(0).toLowerCase() + text.slice(1); };

function unparenWhile<W extends Node & { expression: Node }>(node: Node, isWrapper: (node: Node) => node is W): Node;
function unparenWhile<W extends Node & { expression: Node }>(node: Node | undefined, isWrapper: (node: Node) => node is W): Node | undefined;
function unparenWhile<W extends Node & { expression: Node }>(node: Node | undefined, isWrapper: (node: Node) => node is W): Node | undefined {
  let current: Node | undefined = node;
  while (current && isWrapper(current)) current = current.expression;
  return current;
}

const isExpressionWrapper = (ts: TypeScriptApi, node: Node): node is ExpressionWrapper => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node);

const isRegistrationWrapper = (ts: TypeScriptApi, node: Node): node is RegistrationWrapper => isExpressionWrapper(ts, node) || Boolean(ts.isSatisfiesExpression?.(node));

const unparenRegistration = (ts: TypeScriptApi, node: Node): Node => unparenWhile(node, (current: Node): current is RegistrationWrapper => isRegistrationWrapper(ts, current));

const returnedExpression = (ts: TypeScriptApi, declaration: Node): Node | null => {
  const fn = ts.isVariableDeclaration(declaration) && declaration.initializer ? unparenRegistration(ts, declaration.initializer) : declaration;
  if (!(ts.isArrowFunction(fn) || ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) || !fn.body) return null;
  if (!ts.isBlock(fn.body)) return fn.body;
  const statements = fn.body.statements.filter(ts.isReturnStatement);
  return statements.length === 1 ? statements[0]?.expression ?? null : null;
};

/** Every `name:` property assignment of an object literal over the program: [{declaration, initializer, checker}], memoised per name. */
const assignmentsOf = (ctx: NamingContext, name: string): PropertySource[] => {
  const cached = ctx.propertySources.get(name);
  if (cached) return cached;
  const { kit } = ctx;
  const { ts } = kit;
  const list: PropertySource[] = [];
  for (const file of ctx.graph.files.values()) {
    if (!file.sourceFile.text.includes(name)) continue;
    const checker: TypeChecker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => {
      if (ts.isPropertyAssignment(node) && kit.propertyNameText(node.name) === name && ts.isObjectLiteralExpression(node.parent)) {
        // the property of the type the literal is checked against, so a typed const and a typed return meet the same declaration
        const contextual = checker.getContextualType(node.parent)?.getProperty(name);
        const symbol = contextual ?? checker.getSymbolAtLocation(node.name);
        list.push({ declaration: symbol?.declarations?.[0] ?? null, initializer: node.initializer, checker });
      }
      return true;
    });
  }
  ctx.propertySources.set(name, list);
  return list;
};

const nameOfLiteral = (ctx: NamingContext, checker: TypeChecker, literal: ObjectLiteralExpression, depth: number): string | null => {
  const { kit } = ctx;
  const own = kit.propertyOf(literal, 'name');
  if (own) return kit.stringValue(checker, kit.valueOfProperty(own));
  for (const property of literal.properties) {
    if (!kit.ts.isSpreadAssignment(property)) continue;
    const value = nameOfExpression(ctx, checker, property.expression, depth + 1);
    if (value) return value;
  }
  return null;
};

const nameFromCall = (ctx: NamingContext, checker: TypeChecker, node: CallExpression, depth: number): string | null => {
  const { kit } = ctx;
  const declarations: Declaration[] = kit.declarationsOf(checker, node.expression);
  for (const declaration of declarations) {
    const body = returnedExpression(kit.ts, declaration);
    const value = body ? nameOfExpression(ctx, kit.checkerOf(declaration.getSourceFile()), body, depth + 1) : null;
    if (value) return value;
  }
  return null;
};

const nameFromIdentifier = (ctx: NamingContext, checker: TypeChecker, node: Identifier, depth: number): string | null => {
  const { kit } = ctx;
  const declaration: Declaration | undefined = kit.declarationsOf(checker, node)[0];
  return declaration && kit.ts.isVariableDeclaration(declaration) && declaration.initializer
    ? nameOfExpression(ctx, kit.checkerOf(declaration.getSourceFile()), declaration.initializer, depth + 1) : null;
};

/** True when `declaration` is a property of the `<app>.env.ts` reader's own interface that sits beside the options file declaring `target`: the reader feeds the options value, so its property is the same slot. */
const feedsOptions = (declaration: Declaration | null | undefined, target: Declaration): boolean => {
  const home = declaration?.getSourceFile().fileName ?? '';
  return home.endsWith('.env.ts') && path.posix.dirname(home) === path.posix.dirname(target.getSourceFile().fileName);
};

const nameFromProperty = (ctx: NamingContext, checker: TypeChecker, node: PropertyAccessExpression, depth: number): string | null => {
  const target: Declaration | undefined = ctx.kit.declarationsOf(checker, node.name)[0];
  if (!target) return null;
  const names = new Set(assignmentsOf(ctx, node.name.text).filter(item => item.declaration === target || feedsOptions(item.declaration, target))
    .map(item => nameOfExpression(ctx, item.checker, item.initializer, depth + 1)).filter(Boolean));
  return names.size === 1 ? [...names][0] ?? null : null;
};

function nameOfExpression(ctx: NamingContext, checker: TypeChecker, expression: Node, depth: number): string | null {
  const { ts } = ctx.kit;
  const node = unparenRegistration(ts, expression);
  if (!node || depth > 5) return null;
  if (ts.isObjectLiteralExpression(node)) return nameOfLiteral(ctx, checker, node, depth);
  if (ts.isCallExpression(node)) return nameFromCall(ctx, checker, node, depth);
  if (ts.isIdentifier(node)) return nameFromIdentifier(ctx, checker, node, depth);
  if (ts.isPropertyAccessExpression(node)) return nameFromProperty(ctx, checker, node, depth);
  return null;
}

const isCapabilityArray = (owner: PersistenceInfo | null, name: string): owner is PersistenceInfo => owner?.below.length === 1 && owner.below[0] === 'connection.ts' && [`${camel(owner.capability)}Entities`, `${camel(owner.capability)}Migrations`].includes(name);

const arrayDeclarationOf = (kit: MachineKit, checker: TypeChecker, node: Node): NamedVariable | null => {
  const { ts } = kit;
  const declaration: Declaration | undefined = kit.declarationsOf(checker, ts.isPropertyAccessExpression(node) ? node.name : node)[0];
  // the identifier name was just checked, so the declaration is a named variable
  return declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) ? declaration as NamedVariable : null;
};

/** The capability arrays (`<c>Entities` / `<c>Migrations` of persistence/connection.ts) an expression lists. */
function arraysIn(ctx: NamingContext, checker: TypeChecker, expression: Node, out: CapabilityArray[], depth: number): void {
  const { kit } = ctx;
  const { ts } = kit;
  const node = unparenRegistration(ts, expression);
  if (!node || depth > 6) return;
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) { arraysIn(ctx, checker, ts.isSpreadElement(element) ? element.expression : element, out, depth + 1); }
    return;
  }
  if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return;
  const declaration = arrayDeclarationOf(kit, checker, node);
  if (!declaration) return;
  const rel: string | null = kit.graphPath(declaration);
  const owner = rel ? ctx.persistenceOf(rel) : null;
  if (isCapabilityArray(owner, declaration.name.text)) {
    out.push({ key: path.posix.dirname(owner.root), name: owner.capability });
  } else if (declaration.initializer) arraysIn(ctx, kit.checkerOf(declaration.getSourceFile()), declaration.initializer, out, depth + 1);
}

const registrationArrays = (ctx: NamingContext, checker: TypeChecker, literal: ObjectLiteralExpression): CapabilityArray[] => {
  const arrays: CapabilityArray[] = [];
  for (const key of ['entities', 'migrations']) {
    const property = ctx.kit.propertyOf(literal, key);
    if (property) arraysIn(ctx, checker, ctx.kit.valueOfProperty(property), arrays, 0);
  }
  return arrays;
};

const recordRegistration = (registered: Map<string, RegisteredCapability>, arrays: CapabilityArray[], connection: string, site: RegistrationSite): void => {
  for (const { key, name } of new Map(arrays.map((item): [string, CapabilityArray] => [item.key, item])).values()) {
    let entry = registered.get(key);
    if (!entry) {
      entry = { name, connections: new Map() };
      registered.set(key, entry);
    }
    const sites = entry.connections;
    if (!sites.has(connection)) sites.set(connection, site);
  }
};

/**
 * Where the persistence arrays of every capability are registered: the object literals (`DatabaseModule.register` connections and the
 * migrate/cli app's) that list `<c>Entities` / `<c>Migrations` of a capability's `persistence/connection.ts` under a connection `name`.
 * The one walk BE_SCHEMA_OWNER and the bounded-context rules (R174 to R178) share, so a capability's context is decided once, by origin.
 *
 * @param {{kit: object, graph: object, persistenceOf: (rel: string) => ({root: string, capability: string, folder: string, below: string[]} | null)}} input
 * @returns {{registered: Map<string, {name: string, connections: Map<string, {file: object, node: object}>}>, registrations: number, all: Array<{file: object, node: object, connection: string | null}>}}
 *   `registered`: capability root -> its name and the connections it is registered on (first site each).
 */
export function collectRegistrations({ kit, graph, persistenceOf }: RegistrationInput): RegistrationMap {
  const { ts } = kit;
  const ctx: NamingContext = { kit, graph, persistenceOf, propertySources: new Map() }; // property name -> [{declaration, initializer, checker}] over the program
  const all: RegistrationLiteral[] = []; // every registration literal: {file, node, connection | null when the name cannot be resolved}
  const registered = new Map<string, RegisteredCapability>(); // capability root -> {name, connections: Map(connection -> first site)}
  let registrations = 0;
  for (const file of graph.files.values()) {
    const checker: TypeChecker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => {
      if (!ts.isObjectLiteralExpression(node)) return;
      const arrays = registrationArrays(ctx, checker, node);
      if (!arrays.length) return;
      registrations += 1;
      const connection = nameOfLiteral(ctx, checker, node, 0);
      all.push({ file, node, connection });
      if (connection !== null) recordRegistration(registered, arrays, connection, { file, node });
    });
  }
  return { registered, registrations, all };
}

const PERSISTENCE_SLOT = 'be.persistence';
/** The slot tiers whose capabilities belong to a bounded context: the domain and the projections (a projection is owned by the context whose connection holds its tables). */
const CONTEXT_TIERS = new Set(['domain', 'projections']);

/** True for a platform capability the manifest lists as `perConnection` (its tables exist on every connection that uses it); `root` is the capability root. */
export const isPerConnection = (resolver: SlotResolver, root: string, name: string): boolean => root.split('/').includes('platform') && (resolver.slot(PERSISTENCE_SLOT)?.perConnection ?? []).includes(name);

/**
 * `persistenceOf(rel)`: {root, capability, folder, below} of a be.persistence file (`folder` the directory below persistence/, '' at its root),
 * null for any other file. `root` is the persistence root, its dirname the capability root.
 */
export const persistenceOfFactory = (resolver: SlotResolver) => (rel: string): PersistenceInfo | null => {
  const classified = resolver.classifyPath(rel);
  if (classified.slot !== PERSISTENCE_SLOT) return null;
  const below: string[] = rel.slice(classified.root.length + 1).split('/');
  return { root: classified.root, capability: path.posix.basename(path.posix.dirname(classified.root)), folder: below.length > 1 ? below[0] ?? '' : '', below };
};

/** The declared connection named by a decorator whose callee is declared in src/modules/platform/database/<conn>.decorators.ts, else null. */
const connectionOfDecorators = (kit: MachineKit, declared: Map<string, DeclaredConnection>, checker: TypeChecker, declaration: Node): string | null => {
  const { ts } = kit;
  const decorators: readonly Decorator[] = kit.decorators(declaration);
  for (const decorator of decorators) {
    const callee = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
    const targets: Declaration[] = kit.declarationsOf(checker, callee);
    for (const target of targets) {
      const rel: string | null = kit.graphPath(target);
      const name = rel ? [...declared.keys()].find(connection => rel === `${DATABASE_DIR}/${connection}.decorators.ts`) : null;
      if (name) return name;
    }
  }
  return null;
};

const managerTarget = (ts: TypeScriptApi, node: Node): Node | null => {
  if (ts.isPropertyAccessExpression(node)) return node.name;
  return ts.isIdentifier(node) ? node : null;
};

/** The receiver expression of the `.transaction(callback)` call whose first callback parameter is `declaration`, else null. */
const transactionReceiver = (ts: TypeScriptApi, declaration: Declaration): Expression | null => {
  const callback = declaration.parent;
  if (!ts.isParameter(declaration) || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) || callback.parameters[0] !== declaration) return null;
  const call = callback.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(callback) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'transaction') return null;
  return call.expression.expression;
};

/**
 * The declared connection whose entity manager `expression` is: a property or parameter injected with `Inject<Conn>EntityManager`, or the
 * manager parameter of the callback of a `.transaction(...)` on such a manager. Null when the origin cannot be proven (never guessed).
 */
function connectionOfManagerIn(kit: MachineKit, declared: Map<string, DeclaredConnection>, checker: TypeChecker, expression: Node, depth = 0): string | null {
  const { ts } = kit;
  const node = unparenWhile(expression, (current: Node): current is ExpressionWrapper => isExpressionWrapper(ts, current));
  if (!node || depth > 4) return null;
  const target = managerTarget(ts, node);
  if (!target) return null;
  const declaration: Declaration | undefined = kit.declarationsOf(checker, target)[0];
  if (!declaration) return null;
  if (ts.isPropertyDeclaration(declaration) || ts.isParameter(declaration)) {
    const direct = connectionOfDecorators(kit, declared, checker, declaration);
    if (direct) return direct;
  }
  const receiver = transactionReceiver(ts, declaration);
  return receiver ? connectionOfManagerIn(kit, declared, checker, receiver, depth + 1) : null;
}

/**
 * The bounded-context model of a program: which context (declared connection) each capability belongs to, and which connection an expression's
 * entity manager is. A context is a connection; a capability belongs to the one declared connection its persistence arrays are registered on
 * (collectRegistrations), a platform capability named by the manifest's `perConnection` list to none (it is infrastructure on every connection).
 * Everything is decided by declarations and origins: the registration literal, the `Inject<Conn>EntityManager` decorator's home file, the
 * transaction callback parameter's receiver. Nothing is matched by a variable name.
 */
const MODELS = new WeakMap<HfsGraph, ContextModel>();

export function contextModelOf(kit: MachineKit, graph: HfsGraph): ContextModel {
  const cached = MODELS.get(graph);
  if (cached) return cached;
  const { ts, resolver } = kit;
  const persistenceOf = persistenceOfFactory(resolver);
  const connections: DeclaredConnection[] = resolver.repo.connections;
  const declared = new Map<string, DeclaredConnection>(connections.map((connection): [string, DeclaredConnection] => [connection.name, connection]));
  const { registered, all } = collectRegistrations({ kit, graph, persistenceOf });
  const perConnection = new Set<string>();
  const contextOfRoot = new Map<string, string>(); // capability root -> declared connection name (single registration only)
  for (const [root, { name, connections: sites }] of registered) {
    if (isPerConnection(resolver, root, name)) { perConnection.add(root); continue; }
    const names = [...sites.keys()].filter(connection => declared.has(connection));
    const [only] = names;
    if (names.length === 1 && only !== undefined) contextOfRoot.set(root, only);
  }
  /** The declared connection a capability root belongs to, or null (no registration, several, or a per-connection platform capability). */
  const contextOfCapability = (root: string): string | null => contextOfRoot.get(root) ?? null;
  /** The context of the capability owning `rel` when that capability is of a context tier (domain, projections), else null: only these are bounded contexts. */
  const contextOfFile = (rel: string): string | null => {
    const file = graph.files.get(rel);
    if (!file?.owner || !CONTEXT_TIERS.has(file.tier ?? '')) return null;
    return contextOfCapability(file.owner.root);
  };
  const model: ContextModel = {
    declared, registered, registrations: all, perConnection, contextOfCapability, contextOfFile,
    connectionOfManager: (checker, expression) => connectionOfManagerIn(kit, declared, checker, expression),
    unparen: node => unparenWhile(node, (current: Node): current is ExpressionWrapper => isExpressionWrapper(ts, current)),
  };
  MODELS.set(graph, model);
  return model;
}

const composedConnection = (kit: MachineKit, declared: Set<string>, checker: TypeChecker, inner: Node): string | null => {
  const { ts } = kit;
  const parent = inner.parent;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent)) && parent.name === inner) return null;
  if (!(ts.isIdentifier(inner) || ts.isStringLiteralLike(inner) || ts.isPropertyAccessExpression(inner))) return null;
  const value: string | null = kit.stringValue(checker, inner);
  return value !== null && declared.has(value) ? value : null;
};

const collectComposedConnections = (kit: MachineKit, declared: Set<string>, checker: TypeChecker, call: CallExpression, file: GraphFile, items: ComposedConnection[]): void => {
  for (const argument of call.arguments) {
    kit.walk(argument, (inner: Node) => {
      const value = composedConnection(kit, declared, checker, inner);
      if (value === null) return true;
      items.push({ connection: value, node: inner, file });
      return false;
    });
  }
};

/**
 * The declared connection names the composition of `app` (its root app.module.ts and the composition groups of compose/) passes to
 * the database module registration, as [{connection, node, file}] in path then source order.
 */
export function connectionsComposedBy(kit: MachineKit, app: string): { root: GraphFile | null; items: ComposedConnection[] } {
  const { ts } = kit;
  const files: GraphFile[] = kit.appCompositionFiles(app);
  if (!files.length) return { root: null, items: [] };
  const connections: DeclaredConnection[] = kit.resolver.repo.connections;
  const declared = new Set<string>(connections.map(connection => connection.name));
  const items: ComposedConnection[] = [];
  for (const file of files) {
    const checker: TypeChecker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => {
      if (!(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register')) return;
      const declarations: Declaration[] = kit.declarationsOf(checker, node.expression.expression);
      const owner: DeclarationOwner | null | undefined = declarations.map(kit.ownerOfDeclaration).find(Boolean);
      if (owner?.tier !== 'platform' || owner.name !== 'database') return;
      collectComposedConnections(kit, declared, checker, node, file, items);
    });
  }
  return { root: files[0] ?? null, items };
}

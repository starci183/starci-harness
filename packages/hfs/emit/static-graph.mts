/**
 * What a Nest application serves over GraphQL, read from its SOURCE: the module graph an app root composes and the resolver
 * classes Nest GraphQL's explorers would collect from it. Nothing is executed and no configuration is needed: the app root and
 * every module it reaches are parsed with the TypeScript compiler API and their `@Module` metadata and static registration
 * methods (`register`, `forRoot`, ...) are interpreted symbolically. The interpretation is lazy and only follows what decides
 * the graph: module imports, providers, `forwardRef`, spreads, conditionals (both branches are taken: the contract is the
 * superset a deployment can serve), static methods called with the options of a deployment (unknown values), the options of
 * `GraphQLModule.forRoot` / `forRootAsync`.
 *
 * Mirrors Nest: a module's providers are the `@Module({ providers })` of its class plus the `providers` of a dynamic module;
 * likewise its imports. A GraphQL server reads the providers of EVERY module of the application unless its options carry
 * `include`, which whitelists module classes and their transitive imports (Nest's `BaseExplorerService.getModules`).
 *
 * Anything the interpreter cannot decide in a position that decides the graph (a module import or a provider list) is an
 * error naming the file and line: an answer is exact or it is not given.
 *
 * Injected: `ts` (the TypeScript module), `host.read(file)` (text or null) and `host.resolve(fromFile, specifier)` (an
 * absolute file of the repository, or null for an external package). Pure of the file system otherwise.
 */

import type TypeScript from 'typescript';

// ---- the value model of the interpreter ----

/** A literal the graph forces: a string, a number or a boolean. */
interface LitValue { readonly t: 'lit'; readonly v: string | number | boolean }
/** `undefined`. */
interface UndefValue { readonly t: 'undef' }
/** `null`. */
interface NulValue { readonly t: 'nul' }
/** A value the interpreter cannot decide, with the reason. */
interface FreeValue { readonly t: 'free'; readonly why: string }
/** A class declared in the repository. */
interface ClassValue { readonly t: 'class'; readonly file: string; readonly name: string; readonly node: TypeScript.ClassDeclaration }
/** A name imported from an external package. */
interface ExtValue { readonly t: 'ext'; readonly spec: string; readonly name: string }
/** A function with the environment it closes over. */
interface FnValue { readonly t: 'fn'; readonly node: TypeScript.FunctionLikeDeclaration; readonly env: Env }
/** An object literal; `open` when a spread of something unknown may add properties. */
interface ObjValue { readonly t: 'obj'; readonly props: Map<string, Value>; readonly open: boolean }
/** A spread element of a list. */
interface SpreadItem { readonly t: 'spread'; readonly v: Value }
/** A list; its items may be spreads. */
interface ArrValue { readonly t: 'arr'; readonly items: Array<Value | SpreadItem> }
/** A choice the literals do not decide: every alternative stays. */
interface AltValue { readonly t: 'alt'; readonly alts: Value[] }
/** A dynamic module: the module class or external module, with the imports and providers its static method adds. */
interface DynValue { readonly t: 'dyn'; readonly module: Value; readonly imports: Value[]; readonly providers: Value[]; readonly args: Value[]; readonly ext?: string }
/** A value computed on demand and memoised. */
interface ThunkValue {
  readonly t: 'thunk';
  readonly node?: TypeScript.Node;
  readonly env?: Env;
  readonly compute?: () => Value;
  done: boolean;
  value: Value | undefined;
  forcing?: boolean;
}
type Value = LitValue | UndefValue | NulValue | FreeValue | ClassValue | ExtValue | FnValue | ObjValue | ArrValue | AltValue | DynValue | ThunkValue;
/** A value with its thunks forced. */
type Forced = Exclude<Value, ThunkValue>;

/** The names visible while a node is evaluated. */
interface Env {
  file: string;
  vars: Map<string, Value>;
  cache: object;
  depth: number;
  thisClass?: ClassValue;
}

/** A top-level declaration of a file. */
type Decl =
  | { readonly kind: 'class'; readonly node: TypeScript.ClassDeclaration }
  | { readonly kind: 'function'; readonly node: TypeScript.FunctionDeclaration }
  | { readonly kind: 'var'; readonly node: TypeScript.VariableDeclaration }
  | { readonly kind: 'opaque'; readonly node: TypeScript.Node };

/** What a file exports under one name. */
type ExportEntry =
  | { readonly local: string }
  | { readonly spec: string; readonly name: string }
  | { readonly expression: TypeScript.Expression };

/** A file read once: its imports, declarations, exports and `export *` sources. */
interface FileRecord {
  readonly sourceFile: TypeScript.SourceFile;
  readonly imports: Map<string, { spec: string; name: string }>;
  readonly decls: Map<string, Decl>;
  readonly exports: Map<string, ExportEntry>;
  readonly stars: string[];
}

/** A name found in a file, in the repository, in an external package, or opaque. */
type Located = (Decl & { readonly file: string; readonly name: string }) | { readonly kind: 'expression'; readonly file: string; readonly name: string; readonly node: TypeScript.Expression };
type Resolved = Located | { readonly ext: string; readonly name: string } | { readonly opaque: true } | null;

/** The file system seen by the reader: `read` answers text or null, `resolve` an absolute repository file or null for a package. */
export interface GraphHost {
  read(file: string): string | null;
  resolve(from: string, specifier: string): string | null;
}

/** One module instance of the walked graph. */
interface ModuleNode {
  readonly module: Forced;
  readonly dynamic: DynValue | null;
  readonly providers: Value[];
  readonly imports: ModuleNode[];
  server: DynValue | null;
}

/** A class the composition names, by file and name. */
export interface ClassRef { readonly file: string; readonly name: string }

/** What a composed app serves over GraphQL. */
export interface Composition {
  readonly resolvers: ClassRef[];
  readonly scalars: ClassRef[];
  readonly include: ClassRef[];
}

const NEST_COMMON = '@nestjs/common';
const NEST_GRAPHQL = '@nestjs/graphql';

/** GraphQL server options that change the printed schema and that this reader does not model: presence is an error. */
const SCHEMA_OPTIONS_NOT_MODELED = ['buildSchemaOptions', 'typeDefs', 'schema', 'transformSchema', 'transformAutoSchemaFile'];

const undef: UndefValue = { t: 'undef' };
const nul: NulValue = { t: 'nul' };
const free = (why: string): FreeValue => ({ t: 'free', why });

/**
 * JavaScript's abstract equality (`==`) for the literal kinds this graph forces - string, number, boolean - without
 * the `==` operator: one type compares strictly, a boolean compares as its number, and a number meets a string as
 * Number(string), exactly as the language coerces them (so '' == 0, '1' == true, NaN never equals).
 */
export function looseLiteralEqual(x: string | number | boolean, y: string | number | boolean): boolean {
  if (typeof x === typeof y) return x === y;
  if (typeof x === 'boolean') return looseLiteralEqual(Number(x), y);
  if (typeof y === 'boolean') return looseLiteralEqual(x, Number(y));
  if (typeof x === 'number' && typeof y === 'string') return x === Number(y);
  if (typeof x === 'string' && typeof y === 'number') return Number(x) === y;
  return false;
}

/** TypeScript's syntactic modifier reader: public at run time in every release, absent from the published typings. */
interface TsInternals {
  getSyntacticModifierFlags(node: TypeScript.Node): number;
}

export function createGraphReader({ ts, host }: { ts: typeof TypeScript, host: GraphHost }): { compose(appFile: string, exportName?: string): Composition | null } {
  const internals = ts as typeof TypeScript & TsInternals;
  const files = new Map<string, FileRecord>();
  const classes = new Map<string, ClassValue>();
  const thunks = new WeakMap<object, Map<TypeScript.Node, ThunkValue>>();

  const where = (node: TypeScript.Node) => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return `${sf.fileName}:${line + 1}`;
  };

  // ---- files: imports, declarations, exports ----
  function info(file: string): FileRecord {
    const known = files.get(file);
    if (known) return known;
    const text = host.read(file);
    if (text === null || text === undefined) throw new Error(`cannot read ${file}`);
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const record: FileRecord = { sourceFile, imports: new Map(), decls: new Map(), exports: new Map(), stars: [] };
    files.set(file, record);
    const exported = (node: TypeScript.Node) => (internals.getSyntacticModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
    const isDefault = (node: TypeScript.Node) => (internals.getSyntacticModifierFlags(node) & ts.ModifierFlags.Default) !== 0;
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const spec = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (!clause) continue;
        if (clause.name) record.imports.set(clause.name.text, { spec, name: 'default' });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) record.imports.set(element.name.text, { spec, name: (element.propertyName ?? element.name).text });
        } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) record.imports.set(clause.namedBindings.name.text, { spec, name: '*' });
      } else if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name) {
        record.decls.set(statement.name.text, ts.isClassDeclaration(statement) ? { kind: 'class', node: statement } : { kind: 'function', node: statement });
        if (exported(statement)) record.exports.set(isDefault(statement) ? 'default' : statement.name.text, { local: statement.name.text });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            record.decls.set(declaration.name.text, { kind: 'var', node: declaration });
            if (exported(statement)) record.exports.set(declaration.name.text, { local: declaration.name.text });
          } else {
            for (const element of declaration.name.elements ?? []) {
              if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                record.decls.set(element.name.text, { kind: 'opaque', node: element });
                if (exported(statement)) record.exports.set(element.name.text, { local: element.name.text });
              }
            }
          }
        }
      } else if (ts.isEnumDeclaration(statement)) {
        record.decls.set(statement.name.text, { kind: 'opaque', node: statement });
        if (exported(statement)) record.exports.set(statement.name.text, { local: statement.name.text });
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (element.isTypeOnly) continue;
            record.exports.set(element.name.text, spec ? { spec, name: (element.propertyName ?? element.name).text } : { local: (element.propertyName ?? element.name).text });
          }
        } else if (!statement.exportClause && spec) record.stars.push(spec);
      } else if (ts.isExportAssignment(statement)) record.exports.set('default', { expression: statement.expression });
    }
    return record;
  }

  const target = (file: string, spec: string) => host.resolve(file, spec);

  /** A top-level name of a file: its own declaration, or what an import binding leads to. */
  function resolveName(file: string, name: string, seen = new Set<string>()): Resolved {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const record = info(file);
    const decl = record.decls.get(name);
    if (decl) return { file, name, ...decl };
    const binding = record.imports.get(name);
    if (!binding) return null;
    const to = target(file, binding.spec);
    if (to === null) return { ext: binding.spec, name: binding.name };
    if (binding.name === '*') return { opaque: true };
    return resolveExport(to, binding.name, seen);
  }

  /** A name a file exports, followed through re-exports and `export *`. */
  function resolveExport(file: string, name: string, seen = new Set<string>()): Resolved {
    const record = info(file);
    const entry = record.exports.get(name);
    if (entry && 'local' in entry) return resolveName(file, entry.local, seen);
    if (entry && 'spec' in entry) {
      const to = target(file, entry.spec);
      return to === null ? { ext: entry.spec, name: entry.name } : resolveExport(to, entry.name, seen);
    }
    if (entry && 'expression' in entry) return { file, name, kind: 'expression', node: entry.expression };
    for (const spec of record.stars) {
      const to = target(file, spec);
      if (to === null) continue;
      const found = resolveExport(to, name, seen);
      if (found) return found;
    }
    return null;
  }

  const classRef = (found: Extract<Located, { kind: 'class' }>): ClassValue => {
    const key = `${found.file}#${found.name}`;
    const known = classes.get(key);
    if (known) return known;
    const created: ClassValue = { t: 'class', file: found.file, name: found.name, node: found.node };
    classes.set(key, created);
    return created;
  };

  // ---- values ----
  const thunk = (node: TypeScript.Node, env: Env): ThunkValue => {
    const key = env.cache;
    let memo = thunks.get(key);
    if (!memo) {
      memo = new Map();
      thunks.set(key, memo);
    }
    let made = memo.get(node);
    if (!made) {
      made = { t: 'thunk', node, env, done: false, value: undefined };
      memo.set(node, made);
    }
    return made;
  };
  const lazy = (compute: () => Value): ThunkValue => ({ t: 'thunk', compute, done: false, value: undefined });
  const force = (value: Value): Forced => {
    let current: Value | undefined = value;
    while (current && current.t === 'thunk') {
      if (!current.done) {
        if (current.forcing) return free('circular value');
        current.forcing = true;
        current.value = current.compute ? current.compute() : ev(current.node!, current.env!); // a thunk without compute carries its node and environment
        current.forcing = false;
        current.done = true;
      }
      current = current.value;
    }
    return current!; // a forced thunk always holds a value
  };
  const newEnv = (file: string, extra: Partial<Env> = {}): Env => ({ file, vars: new Map(), cache: {}, depth: 0, ...extra });

  const TRANSPARENT = new Set([ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.AsExpression, ts.SyntaxKind.SatisfiesExpression, ts.SyntaxKind.NonNullExpression, ts.SyntaxKind.TypeAssertionExpression, ts.SyntaxKind.AwaitExpression]);
  const unwrapped = (node: TypeScript.Node): TypeScript.Node => {
    let current = node;
    while (TRANSPARENT.has(current.kind)) current = (current as TypeScript.ParenthesizedExpression).expression; // every kind in TRANSPARENT wraps an expression
    return current;
  };

  // ---- conditions: only what literals decide is folded; the rest is recorded and judged at the end ----
  const undecidedRecords: Array<{ node: TypeScript.Node, alts: Value[] }> = [];
  /** A choice the literals do not decide: both outcomes stay, and it is an error at the end unless they serve the same resolvers. */
  function undecided(conditionNode: TypeScript.Node, alts: Value[]): AltValue {
    undecidedRecords.push({ node: conditionNode, alts });
    return { t: 'alt', alts };
  }

  /** The truthiness of a value: true, false, or null when it depends on something unknown. */
  function truthiness(value: Forced): boolean | null {
    switch (value.t) {
      case 'lit': return Boolean(value.v);
      case 'undef': case 'nul': return false;
      case 'obj': case 'arr': case 'class': case 'fn': case 'dyn': case 'ext': return true;
      case 'alt': {
        const all = value.alts.map((alt) => truthiness(force(alt)));
        return all.every((item) => item === all[0]) ? all[0] ?? null : null;
      }
      default: return null;
    }
  }

  /** Strict/loose equality of two forced values, or null when unknown. */
  function equality(a: Forced, b: Forced, loose: boolean): boolean | null {
    if (a.t === 'free' || b.t === 'free' || a.t === 'alt' || b.t === 'alt') return null;
    const nullish = (v: Forced) => v.t === 'undef' || v.t === 'nul';
    if (nullish(a) && nullish(b)) return loose ? true : a.t === b.t;
    if (nullish(a) || nullish(b)) return ['lit', 'class', 'obj', 'arr'].includes(nullish(a) ? b.t : a.t) ? false : null;
    if (a.t === 'lit' && b.t === 'lit') return loose ? looseLiteralEqual(a.v, b.v) : a.v === b.v;
    if (a.t === 'class' && b.t === 'class') return a === b;
    return null;
  }

  /** The value of a condition expression: true, false, or null when literals do not decide it. */
  function condition(rawNode: TypeScript.Node, env: Env): boolean | null {
    const node = unwrapped(rawNode);
    const K = ts.SyntaxKind;
    if (ts.isPrefixUnaryExpression(node) && node.operator === K.ExclamationToken) {
      const inner = condition(node.operand, env);
      return inner === null ? null : !inner;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken || op === K.BarBarToken) {
        const left = condition(node.left, env);
        const right = condition(node.right, env);
        if (op === K.AmpersandAmpersandToken) return left === false || right === false ? false : left === true && right === true ? true : null;
        return left === true || right === true ? true : left === false && right === false ? false : null;
      }
      if (op === K.EqualsEqualsEqualsToken || op === K.ExclamationEqualsEqualsToken || op === K.EqualsEqualsToken || op === K.ExclamationEqualsToken) {
        const equal = equality(force(thunk(node.left, env)), force(thunk(node.right, env)), op === K.EqualsEqualsToken || op === K.ExclamationEqualsToken);
        return equal === null ? null : op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken ? equal : !equal;
      }
    }
    return truthiness(force(thunk(node, env)));
  }

  function ev(rawNode: TypeScript.Node, env: Env): Value {
    const node = unwrapped(rawNode);
    if (env.depth > 60) return free('evaluation too deep');
    if (ts.isIdentifier(node)) return identifier(node.text, node, env);
    if (ts.isArrayLiteralExpression(node)) return { t: 'arr', items: node.elements.map((element): Value | SpreadItem => (ts.isSpreadElement(element) ? { t: 'spread', v: thunk(element.expression, env) } : thunk(element, env))) };
    if (ts.isObjectLiteralExpression(node)) return objectLiteral(node, env);
    if (ts.isConditionalExpression(node)) {
      const decided = condition(node.condition, env);
      if (decided === true) return thunk(node.whenTrue, env);
      if (decided === false) return thunk(node.whenFalse, env);
      return undecided(node.condition, [thunk(node.whenTrue, env), thunk(node.whenFalse, env)]);
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken) {
        const left = force(thunk(node.left, env));
        if (left.t === 'undef' || left.t === 'nul') return thunk(node.right, env);
        return left.t === 'free' ? undecided(node.left, [left, thunk(node.right, env)]) : left;
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        const decided = condition(node.left, env);
        const orElse = op === ts.SyntaxKind.BarBarToken;
        if (decided === null) return undecided(node.left, [thunk(node.right, env), orElse ? thunk(node.left, env) : undef]);
        return decided === orElse ? thunk(node.left, env) : thunk(node.right, env);
      }
      if (op === ts.SyntaxKind.EqualsToken) return thunk(node.right, env);
      return free('binary expression');
    }
    if (ts.isPropertyAccessExpression(node)) return member(thunk(node.expression, env), node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return member(thunk(node.expression, env), node.argumentExpression.text);
    if (ts.isCallExpression(node)) return call(node, env);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { t: 'fn', node, env };
    if (ts.isStringLiteralLike(node)) return { t: 'lit', v: node.text };
    if (ts.isNumericLiteral(node)) return { t: 'lit', v: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { t: 'lit', v: node.kind === ts.SyntaxKind.TrueKeyword };
    if (node.kind === ts.SyntaxKind.NullKeyword) return nul;
    return free(`unmodelled expression ${ts.SyntaxKind[node.kind]}`);
  }

  function identifier(name: string, _node: TypeScript.Node, env: Env): Value {
    if (env.vars.has(name)) return env.vars.get(name)!;
    if (name === 'undefined') return undef;
    const found = resolveName(env.file, name);
    if (!found) return free(`unresolved name ${name}`);
    return declared(found);
  }

  function declared(found: NonNullable<Resolved>): Value {
    if ('ext' in found) return { t: 'ext', spec: found.ext, name: found.name };
    if ('opaque' in found || found.kind === 'opaque') return free('opaque declaration');
    if (found.kind === 'class') return classRef(found);
    const env = newEnv(found.file);
    if (found.kind === 'function') return { t: 'fn', node: found.node, env };
    if (found.kind === 'expression') return thunk(found.node, env);
    const initializer = found.node.initializer;
    return initializer ? thunk(initializer, newEnv(found.file, { cache: found.node })) : free('declaration without a value');
  }

  function objectLiteral(node: TypeScript.ObjectLiteralExpression, env: Env): ObjValue {
    const props = new Map<string, Value>();
    let open = false;
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) props.set(property.name.text, thunk(property.initializer, env));
      else if (ts.isShorthandPropertyAssignment(property)) props.set(property.name.text, thunk(property.name, env));
      else if (ts.isSpreadAssignment(property)) {
        const spread = force(thunk(property.expression, env));
        if (spread.t === 'obj') {
          for (const [key, value] of spread.props) props.set(key, value);
          open = open || spread.open;
        } else if (spread.t === 'dyn') {
          props.set('module', spread.module);
          props.set('imports', { t: 'arr', items: spread.imports });
          props.set('providers', { t: 'arr', items: spread.providers });
        } else open = true;
      } else if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) props.set(property.name.text, { t: 'fn', node: property, env });
      else open = true;
    }
    return { t: 'obj', props, open };
  }

  function member(baseThunk: Value, key: string): ThunkValue {
    return lazy(() => {
      const base = force(baseThunk);
      switch (base.t) {
        case 'obj':
          return base.props.get(key) ?? (base.open ? free(`property ${key} of an open object`) : undef);
        case 'dyn':
          return key === 'module' ? base.module : key === 'imports' || key === 'providers' ? { t: 'arr', items: base[key] } : undef;
        case 'alt':
          return { t: 'alt', alts: base.alts.map((alt) => member(alt, key)) };
        case 'class': {
          const property = base.node.members.find((item): item is TypeScript.PropertyDeclaration & { initializer: TypeScript.Expression } => ts.isPropertyDeclaration(item) && item.name !== undefined && ts.isIdentifier(item.name) && item.name.text === key && item.initializer !== undefined);
          return property ? thunk(property.initializer, newEnv(base.file, { cache: property })) : free(`static ${key} of ${base.name}`);
        }
        case 'undef':
        case 'nul':
          return undef;
        default:
          return free(`property ${key} of ${base.t}`);
      }
    });
  }

  // ---- calls ----
  function call(node: TypeScript.CallExpression, env: Env): Value {
    const callee = unwrapped(node.expression);
    const args = node.arguments.map((argument) => thunk(argument, env));
    if (callee.kind === ts.SyntaxKind.SuperKeyword) return free('super call');
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.expression.kind === ts.SyntaxKind.SuperKeyword) return superCall(env);
      const base = force(thunk(callee.expression, env));
      return methodCall(base, callee.name.text, args, node);
    }
    const target = force(thunk(callee, env));
    if (target.t === 'ext' && target.spec === NEST_COMMON && target.name === 'forwardRef') {
      const [forwarded] = args;
      return forwarded ? lazy(() => callFunction(force(forwarded), [])) : free('forwardRef without a value');
    }
    if (target.t === 'fn') return callFunction(target, args);
    return free(`call of ${target.t}`);
  }

  /** `super.register(...)` of a class built on Nest's ConfigurableModuleBuilder: the class itself, no user additions. */
  const superCall = (env: Env): DynValue => ({ t: 'dyn', module: env.thisClass ?? free('super outside a class'), imports: [], providers: [], args: [] });

  /** Array methods over a list whose items are known (`arr`) or unknown (`free`: one representative item). */
  function arrayMethod(base: ArrValue | FreeValue, name: string, args: Value[]): Value | null {
    const items: Array<Value | SpreadItem> = base.t === 'arr' ? base.items : [free('an item of a list from the options of a deployment')];
    if (name === 'map' || name === 'flatMap') {
      const fn = args[0] ? force(args[0]) : null;
      if (fn?.t !== 'fn') return free(`${name} without a function`);
      const mapped: ArrValue = { t: 'arr', items: items.map((item) => callFunction(fn, [item as Value, undef])) }; // a spread item is passed on as the interpreter always did
      return base.t === 'arr' ? mapped : undecided(fn.node, [mapped, { t: 'arr', items: [] }]);
    }
    if (name === 'filter' || name === 'slice' || name === 'sort' || name === 'reverse') return base;
    if (name === 'concat') return { t: 'arr', items: [{ t: 'spread', v: base }, ...args.map((argument): SpreadItem => ({ t: 'spread', v: argument }))] };
    return null;
  }

  function methodCall(base: Forced, name: string, args: Value[], node: TypeScript.Node): Value {
    if ((base.t === 'arr' || base.t === 'free') && ['map', 'flatMap', 'filter', 'slice', 'sort', 'reverse', 'concat'].includes(name)) {
      const result = arrayMethod(base, name, args);
      if (result) return result;
    }
    if (base.t === 'alt') return { t: 'alt', alts: base.alts.map((alt) => lazy(() => methodCall(force(alt), name, args, node))) };
    if (base.t === 'ext') return { t: 'dyn', module: base, imports: listOf(args[0], 'imports'), providers: [], args, ext: name };
    if (base.t === 'class') {
      const found = staticMethod(base, name);
      if (found) return callFunction({ t: 'fn', node: found.method, env: newEnv(found.owner.file, { thisClass: base }) }, args);
      return { t: 'dyn', module: base, imports: [], providers: [], args };
    }
    return free(`method ${name} of ${base.t} at ${where(node)}`);
  }

  /** The static method of a class or of its in-repository base classes; null when none (the base is external). */
  function staticMethod(cls: ClassValue, name: string): { method: TypeScript.MethodDeclaration, owner: ClassValue } | null {
    const method = cls.node.members.find((item): item is TypeScript.MethodDeclaration => ts.isMethodDeclaration(item) && item.name && ts.isIdentifier(item.name) && item.name.text === name && (internals.getSyntacticModifierFlags(item) & ts.ModifierFlags.Static) !== 0 && item.body !== undefined);
    if (method) return { method, owner: cls };
    const heritage = cls.node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (!heritage) return null;
    const base = force(thunk(heritage.expression, newEnv(cls.file)));
    return base.t === 'class' ? staticMethod(base, name) : null;
  }

  /** The `imports` array a call's first argument carries (forRootAsync-style options), as a list of thunks. */
  function listOf(argument: Value | undefined, key: string): Value[] {
    if (!argument) return [];
    const options = force(argument);
    if (options.t !== 'obj' || !options.props.has(key)) return [];
    return [options.props.get(key)!];
  }

  function callFunction(fn: Forced, args: Value[]): Value {
    if (fn.t !== 'fn') return free(`call of ${fn.t}`);
    const env = newEnv(fn.env.file, { ...fn.env, vars: new Map(fn.env.vars), depth: fn.env.depth + 1, cache: {} });
    fn.node.parameters.forEach((parameter, index) => bindParameter(parameter.name, args[index] ?? undef, env));
    const body = fn.node.body;
    if (!body) return free('function without a body');
    if (!ts.isBlock(body)) return thunk(body, env);
    const outcome = runStatements(body.statements, env);
    return outcome.returned ? outcome.value : undef;
  }

  function bindParameter(name: TypeScript.BindingName, value: Value, env: Env): void {
    if (ts.isIdentifier(name)) env.vars.set(name.text, value);
    else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const key = ((element.propertyName ?? element.name) as TypeScript.Identifier).text; // an identifier key, the only form a module option destructures
        if (ts.isIdentifier(element.name)) env.vars.set(element.name.text, member(value, key));
      }
    }
  }

  /** True when a statement returns or changes a list a later `return` may hand back: what an undecided branch must not hide. */
  function hasEffect(node: TypeScript.Node): boolean {
    let found = false;
    const visit = (child: TypeScript.Node): void => {
      if (found) return;
      if (ts.isReturnStatement(child) || (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken)) found = true;
      else if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && ['push', 'unshift', 'splice'].includes(child.expression.name.text)) found = true;
      else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  }

  const SILENT_STATEMENTS = new Set([ts.SyntaxKind.EmptyStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration]);

  /**
   * Runs statements in order against an environment: declarations bind lazily, `if` follows the branch its condition decides
   * (an undecidable condition over statements that return or change a list is an error), `push` appends to a local list and
   * `return` ends the run. Answers `{ returned, value }`. A loop, switch or try that returns or changes a list is an error.
   */
  function runStatements(statements: readonly TypeScript.Statement[], env: Env): { returned: boolean, value: Value } {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.initializer) bindParameter(declaration.name, thunk(declaration.initializer, env), env);
        }
      } else if (ts.isReturnStatement(statement)) return { returned: true, value: statement.expression ? thunk(statement.expression, env) : undef };
      else if (ts.isIfStatement(statement)) {
        const decided = condition(statement.expression, env);
        if (decided === null && hasEffect(statement)) throw new Error(`${where(statement)}: the condition ${statement.expression.getText()} cannot be decided from literals and a branch returns or adds providers; the schema is not known`);
        const branch = decided === false ? statement.elseStatement : decided === true ? statement.thenStatement : null;
        if (branch) {
          const outcome = runStatements(ts.isBlock(branch) ? branch.statements : [branch], env);
          if (outcome.returned) return outcome;
        }
      } else if (ts.isBlock(statement)) {
        const outcome = runStatements(statement.statements, env);
        if (outcome.returned) return outcome;
      } else if (ts.isExpressionStatement(statement)) pushStatement(statement, env);
      else if (!SILENT_STATEMENTS.has(statement.kind) && hasEffect(statement)) throw new Error(`${where(statement)}: a ${ts.SyntaxKind[statement.kind]} that returns or changes a list is not modeled by this reader`);
    }
    return { returned: false, value: undef };
  }

  /** `list.push(...)` on a local list and `name = value` on a local name; any other expression statement has no effect here. */
  function pushStatement(statement: TypeScript.ExpressionStatement, env: Env): void {
    const expression = unwrapped(statement.expression);
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expression.left) && env.vars.has(expression.left.text)) {
      env.vars.set(expression.left.text, thunk(expression.right, env));
      return;
    }
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return;
    const name = expression.expression.name.text;
    if (name !== 'push' && name !== 'unshift') return;
    const list = force(thunk(expression.expression.expression, env));
    if (list.t !== 'arr') throw new Error(`${where(statement)}: ${name} on something that is not a local list`);
    const added = expression.arguments.map((argument): Value | SpreadItem => (ts.isSpreadElement(argument) ? { t: 'spread', v: thunk(argument.expression, env) } : thunk(argument, env)));
    if (name === 'push') list.items.push(...added); else list.items.unshift(...added);
  }

  // ---- modules ----
  // reason: the repository's own TypeScript may predate 4.8, where decorators sat on `node.decorators`.
  const decoratorsOf = (node: TypeScript.Node): readonly TypeScript.Decorator[] => (ts.canHaveDecorators?.(node) ? ts.getDecorators(node) ?? [] : (node as { decorators?: readonly TypeScript.Decorator[] }).decorators ?? []);

  /** The `@Module({...})` metadata object of a class (an obj value), or null. */
  function moduleMetadata(cls: ClassValue): ObjValue | null {
    for (const decorator of decoratorsOf(cls.node)) {
      const expression = decorator.expression;
      if (!ts.isCallExpression(expression)) continue;
      const callee = force(thunk(expression.expression, newEnv(cls.file)));
      if (callee.t === 'ext' && callee.spec === NEST_COMMON && callee.name === 'Module') {
        const argument = expression.arguments[0];
        const metadata: Forced = argument ? force(thunk(argument, newEnv(cls.file, { thisClass: cls }))) : { t: 'obj', props: new Map(), open: false };
        if (metadata.t !== 'obj' || metadata.open) throw new Error(`${where(expression)}: the @Module metadata of ${cls.name} cannot be decided`);
        return metadata;
      }
    }
    return null;
  }

  /** Flattens a value into its module/provider entries: arrays, spreads and both branches of a conditional. */
  function entries(value: Value, out: Forced[] = []): Forced[] {
    const v = force(value);
    if (v.t === 'arr') for (const item of v.items) entries(item.t === 'spread' ? item.v : item, out);
    else if (v.t === 'alt') for (const alt of v.alts) entries(alt, out);
    else if (v.t !== 'undef' && v.t !== 'nul' && !(v.t === 'lit' && !v.v)) out.push(v);
    return out;
  }

  const isGraphqlServer = (module: Forced) => module.t === 'ext' && module.spec === NEST_GRAPHQL && module.name === 'GraphQLModule';

  /** A module entry as `{ module, dyn }`: a class, an external module, a dynamic module, or a `{ module, ... }` literal. */
  function normalize(value: Forced, origin: string): { module: Forced, dyn: DynValue | null, key: object | string } {
    if (value.t === 'class' || value.t === 'ext') return { module: value, dyn: null, key: value.t === 'class' ? value : `${value.spec}#${value.name}` };
    if (value.t === 'dyn') return { module: force(value.module), dyn: value, key: value };
    if (value.t === 'obj' && value.props.has('module')) {
      if (value.open && !(value.props.has('imports') && value.props.has('providers'))) throw new Error(`${origin}: a module object with an unknown spread may add imports or providers`);
      const dyn: DynValue = { t: 'dyn', module: value.props.get('module')!, imports: value.props.has('imports') ? [value.props.get('imports')!] : [], providers: value.props.has('providers') ? [value.props.get('providers')!] : [], args: [] };
      return { module: force(dyn.module), dyn, key: value };
    }
    throw new Error(`${origin}: an import cannot be decided (${(value.t === 'free' ? value.why : undefined) ?? value.t})`);
  }

  /**
   * Walks the module graph from a root entry. Answers the module instances `{ module, providers, imports, server }` in
   * discovery order; `imports` are instances of the same list. A static class is one instance; every dynamic module value is
   * its own instance (Nest keys them by their metadata).
   */
  function walk(root: Value): ModuleNode[] {
    const order: ModuleNode[] = [];
    const seen = new Map<object | string, ModuleNode>();
    function visit(entry: Value, origin: string): ModuleNode[] {
      const nodes: ModuleNode[] = [];
      for (const value of entries(entry)) {
        const { module, dyn, key } = normalize(value, origin);
        if (module.t === 'free') throw new Error(`${origin}: a dynamic module's class cannot be decided (${module.why})`);
        if (seen.has(key)) {
          nodes.push(seen.get(key)!);
          continue;
        }
        const node: ModuleNode = { module, dynamic: dyn, providers: [], imports: [], server: null };
        seen.set(key, node);
        order.push(node);
        nodes.push(node);
        const children: Value[] = [];
        const statics = module.t === 'class' ? moduleMetadata(module) : null;
        if (statics?.props.has('imports')) children.push(statics.props.get('imports')!);
        if (statics?.props.has('providers')) node.providers.push(statics.props.get('providers')!);
        if (dyn) {
          children.push(...dyn.imports);
          node.providers.push(...dyn.providers);
          if (isGraphqlServer(module)) node.server = dyn;
        }
        const name = module.t === 'class' ? `${module.name} (${module.file})` : `${'name' in module ? module.name : undefined}`;
        for (const child of children) node.imports.push(...visit(child, name));
      }
      return nodes;
    }
    visit(root, 'the application root');
    return order;
  }

  /** The instances of the modules a GraphQL server reads: all of them, or the `include` whitelist and its transitive imports. */
  function servedNodes(nodes: ModuleNode[], include: readonly Forced[]): ModuleNode[] {
    if (include.length === 0) return nodes;
    const served = new Set<ModuleNode>();
    const pending = nodes.filter((node) => include.includes(node.module));
    while (pending.length) {
      const node = pending.pop()!;
      if (served.has(node)) continue;
      served.add(node);
      pending.push(...node.imports);
    }
    return nodes.filter((node) => served.has(node));
  }

  /** The provider classes of instances: plain class providers and `useClass` providers, unique, in order. */
  function providerClasses(nodes: ModuleNode[]): ClassValue[] {
    const found: ClassValue[] = [];
    for (const node of nodes) {
      for (const list of node.providers) {
        for (const provider of entries(list)) {
          const cls = provider.t === 'class' ? provider : provider.t === 'obj' && provider.props.has('useClass') ? force(provider.props.get('useClass')!) : null;
          if (provider.t === 'free') throw new Error(`${('name' in node.module ? node.module.name : undefined) ?? 'a module'}: a provider list cannot be decided (${provider.why})`);
          if (cls && cls.t === 'class' && !found.includes(cls)) found.push(cls);
        }
      }
    }
    return found;
  }

  /** True when a class carries `@Resolver` or `@Scalar` of @nestjs/graphql (by where the decorator was imported from). */
  function graphqlKind(cls: ClassValue): string | null {
    for (const decorator of decoratorsOf(cls.node)) {
      const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
      const callee = force(thunk(expression, newEnv(cls.file)));
      if (callee.t === 'ext' && callee.spec === NEST_GRAPHQL && (callee.name === 'Resolver' || callee.name === 'Scalar')) return callee.name;
    }
    return null;
  }

  /** The options of a GraphQL server: its literal, or what the factory of `forRootAsync` returns. */
  function serverOptions(server: DynValue, origin: string): { include: ClassValue[] } {
    const argument = server.args[0];
    if (!argument) return { include: [] };
    let options: Forced = force(argument);
    if (options.t === 'obj' && options.props.has('useFactory')) {
      const result = callFunction(force(options.props.get('useFactory')!), (options.props.has('inject') ? entries(options.props.get('inject')!) : []).map(() => free('injected value')));
      options = force(result);
    }
    const objects = options.t === 'alt' ? options.alts.map(force) : [options];
    const props = new Map<string, Value>();
    for (const object of objects) {
      if (object.t !== 'obj' || object.open) throw new Error(`${origin}: the GraphQL server options cannot be decided (${(object.t === 'free' ? object.why : undefined) ?? (object.t === 'obj' && object.open ? 'an unknown spread' : object.t)})`);
      for (const [key, value] of object.props) props.set(key, value);
    }
    for (const key of SCHEMA_OPTIONS_NOT_MODELED) {
      if (props.has(key)) throw new Error(`${origin}: GraphQL server option ${key} changes the schema and is not modeled by this reader`);
    }
    const auto = props.has('autoSchemaFile') ? force(props.get('autoSchemaFile')!) : undef;
    if (auto.t === 'undef' || (auto.t === 'lit' && auto.v === false)) throw new Error(`${origin}: the GraphQL server is not code-first (no autoSchemaFile)`);
    const listed = props.has('include') ? entries(props.get('include')!) : [];
    const include = listed.filter((item): item is ClassValue => item.t === 'class');
    if (include.length !== listed.length) throw new Error(`${origin}: the GraphQL include list cannot be decided`);
    return { include };
  }

  /** The keys of the resolver and scalar classes one branch of an undecided choice would serve. */
  function graphqlClassKeys(alt: Value): Set<string> {
    const keys = new Set<string>();
    for (const value of entries(alt)) {
      if (value.t === 'class' && graphqlKind(value)) keys.add(`${value.file}#${value.name}`);
      const moduleLike = value.t === 'dyn' || (value.t === 'obj' && value.props.has('module')) || (value.t === 'class' && moduleMetadata(value) !== null);
      if (!moduleLike) continue;
      for (const cls of providerClasses(walk(value))) if (graphqlKind(cls)) keys.add(`${cls.file}#${cls.name}`);
    }
    return keys;
  }

  /**
   * Every choice the literals did not decide (a condition on the options of a deployment, an unknown list) must serve the same
   * resolvers whichever way it goes; when the branches differ the schema is not known and that is an error, never a guess.
   */
  function assertUndecidedHarmless() {
    for (let at = 0; at < undecidedRecords.length; at += 1) {
      const { node, alts } = undecidedRecords[at]!;
      const [first, ...rest] = alts.map(graphqlClassKeys) as [Set<string>, ...Set<string>[]]; // an undecided choice always has alternatives
      for (const other of rest) {
        const differing = [...first].filter((key) => !other.has(key)).concat([...other].filter((key) => !first.has(key)));
        if (differing.length) throw new Error(`${where(node)}: ${node.getText()} cannot be decided from literals and its branches serve different resolvers (${differing.map((key) => key.split('#')[1]).join(', ')})`);
      }
    }
  }

  /**
   * Composes an app root file. Answers null when the file exports no `AppModule` class or its module graph holds no GraphQL server, else
   * `{ resolvers: [{ file, name }], scalars: [{ file, name }], include: [{ file, name }] }`.
   */
  function compose(appFile: string, exportName = 'AppModule'): Composition | null {
    const found = resolveExport(appFile, exportName);
    if (!found || !('kind' in found) || found.kind !== 'class') return null;
    const root = classRef(found);
    const register = staticMethod(root, 'register');
    const rootValue: Value = register ? { t: 'arr', items: [root, callFunction({ t: 'fn', node: register.method, env: newEnv(register.owner.file, { thisClass: root }) }, [free('the options of a deployment')])] } : root;
    const nodes = walk(rootValue);
    const servers = nodes.filter((node): node is ModuleNode & { server: DynValue } => node.server !== null);
    if (servers.length === 0) return null;
    if (servers.length > 1) throw new Error(`${appFile} composes ${servers.length} GraphQL servers; a contract snapshot describes exactly one`);
    const { include } = serverOptions(servers[0]!.server, `${exportName} of ${appFile}`);
    const classesOf = providerClasses(servedNodes(nodes, include));
    assertUndecidedHarmless();
    const pick = (kind: string) => classesOf.filter((cls) => graphqlKind(cls) === kind).map((cls) => ({ file: cls.file, name: cls.name }));
    return { resolvers: pick('Resolver'), scalars: pick('Scalar'), include: include.map((cls) => ({ file: cls.file, name: cls.name })) };
  }

  return { compose };
}

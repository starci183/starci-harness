import path from 'node:path';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install, typed by the version this package develops against. */
type Ts = typeof import('typescript');

/** What naming a type reads of the app: its compiler, program and one source file. */
export interface NamingContext {
  ts: Ts;
  program: TsTypes.Program;
  checker: TsTypes.TypeChecker;
  options: TsTypes.CompilerOptions;
  source: TsTypes.SourceFile;
  /** The absolute, forward-slash name of the file being annotated. */
  file: string;
  text: string;
}

/** One type the app declares and exports by name, which an inferred structural type can be replaced by. */
interface NamedType { name: string; type: TsTypes.Type; file: string }

const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.mts', '.d.mts', '.cts', '.d.cts', '/index.ts', '/index.tsx', '/index.d.ts'];
const posix = (file: string): string => file.replaceAll('\\', '/');

/** The source file of the program a module path (absolute, without its extension) names, or undefined. */
export function moduleFile(c: NamingContext, modulePath: string): TsTypes.SourceFile | undefined {
  for (const extension of EXTENSIONS) {
    const found = c.program.getSourceFile(posix(modulePath) + extension);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The symbol a module exports under `name`, with aliases resolved, or undefined. */
export function exportedSymbol(c: NamingContext, file: TsTypes.SourceFile, name: string): TsTypes.Symbol | undefined {
  const module = c.checker.getSymbolAtLocation(file);
  if (module === undefined) return undefined;
  const found = c.checker.getExportsOfModule(module).find(symbol => symbol.name === name);
  if (found === undefined) return undefined;
  return (found.flags & c.ts.SymbolFlags.Alias) === 0 ? found : c.checker.getAliasedSymbol(found);
}

/** The key that groups candidate types before the expensive assignability test: the sorted property names. */
const shapeKey = (names: readonly string[]): string => [...names].sort().join(',');

const indexes = new WeakMap<TsTypes.Program, Map<string, NamedType[]>>();

/** The exported, non-generic object types of the app's own files (never installed packages or declaration files), by their property names. */
function namedTypes(c: NamingContext): Map<string, NamedType[]> {
  const known = indexes.get(c.program);
  if (known !== undefined) return known;
  const found = new Map<string, NamedType[]>();
  for (const file of c.program.getSourceFiles()) {
    if (file.isDeclarationFile || c.program.isSourceFileFromExternalLibrary(file) || file.fileName.includes('/node_modules/')) continue;
    const module = c.checker.getSymbolAtLocation(file);
    if (module === undefined) continue;
    for (const symbol of c.checker.getExportsOfModule(module)) {
      const target = (symbol.flags & c.ts.SymbolFlags.Alias) === 0 ? symbol : c.checker.getAliasedSymbol(symbol);
      if ((target.flags & (c.ts.SymbolFlags.TypeAlias | c.ts.SymbolFlags.Interface)) === 0) continue;
      const type = c.checker.getDeclaredTypeOfSymbol(target);
      const generic = (type as TsTypes.InterfaceType).typeParameters?.length ?? type.aliasTypeArguments?.length ?? 0;
      if (generic > 0 || (type.flags & c.ts.TypeFlags.Object) === 0) continue;
      const key = shapeKey(c.checker.getPropertiesOfType(type).map(property => property.name));
      if (key === '') continue;
      found.set(key, [...(found.get(key) ?? []), { name: symbol.name, type, file: file.fileName }]);
    }
  }
  indexes.set(c.program, found);
  return found;
}

/** The names that can be written at `enclosing` without an import, as symbols; what a function body declares is not visible from its signature. */
export function namesInScope(c: NamingContext, enclosing: TsTypes.Node): Map<string, TsTypes.Symbol> {
  const flags = c.ts.SymbolFlags.Type | c.ts.SymbolFlags.Namespace | c.ts.SymbolFlags.Alias;
  const body = (enclosing as { body?: TsTypes.Node }).body;
  const inBody = (symbol: TsTypes.Symbol): boolean => body !== undefined && symbol.declarations?.length !== 0 && symbol.declarations?.every(declaration => declaration.pos >= body.pos && declaration.end <= body.end) === true;
  return new Map(c.checker.getSymbolsInScope(enclosing, flags).filter(symbol => !inBody(symbol)).map(symbol => [symbol.name, symbol]));
}

/**
 * The one exported type of the app that is interchangeable with the inferred object type `type` (each assignable to the other and the same property names),
 * preferring a name the file already has in scope; undefined when none or more than one fits, so a guess never stands for the inference.
 */
function matchingName(c: NamingContext, type: TsTypes.Type, enclosing: TsTypes.Node): NamedType | undefined {
  if ((type.flags & c.ts.TypeFlags.Object) === 0) return undefined;
  const key = shapeKey(c.checker.getPropertiesOfType(type).map(property => property.name));
  const fits = (namedTypes(c).get(key) ?? []).filter(named => c.checker.isTypeAssignableTo(type, named.type) && c.checker.isTypeAssignableTo(named.type, type));
  if (fits.length <= 1) return fits[0];
  const scope = namesInScope(c, enclosing);
  const local = fits.filter(named => scope.has(named.name));
  return local.length === 1 ? local[0] : undefined;
}

/** The type argument nodes of `node` paired with the type arguments the checker holds for `type`. */
function argumentsOf(c: NamingContext, type: TsTypes.Type): readonly TsTypes.Type[] {
  if ((type.flags & c.ts.TypeFlags.Object) !== 0 && ((type as TsTypes.ObjectType).objectFlags & c.ts.ObjectFlags.Reference) !== 0) return c.checker.getTypeArguments(type as TsTypes.TypeReference);
  return type.aliasTypeArguments ?? [];
}

/**
 * `node` (the type node the checker wrote for `type`) with every anonymous object type that an exported type of the app stands for replaced by a
 * reference to that type. It follows type arguments (`Promise<{...}>`), arrays and unions; any other anonymous part stays for the caller to refuse.
 */
export function nameAnonymousParts(c: NamingContext, node: TsTypes.TypeNode, type: TsTypes.Type, enclosing: TsTypes.Node): TsTypes.TypeNode {
  const { ts } = c;
  const reference = (named: NamedType): TsTypes.TypeNode | undefined => c.checker.typeToTypeNode(named.type, enclosing, ts.NodeBuilderFlags.NoTruncation);
  if (ts.isTypeLiteralNode(node) && node.members.length > 0) {
    const named = matchingName(c, type, enclosing);
    return (named === undefined ? undefined : reference(named)) ?? node;
  }
  if (ts.isArrayTypeNode(node) || ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)) {
    const given = ts.isArrayTypeNode(node) ? [node.elementType] : node.typeArguments ?? [];
    const held = argumentsOf(c, type);
    if (!given.length || held.length < given.length) return node;
    const named = given.map((child, at) => nameAnonymousParts(c, child, held[at] as TsTypes.Type, enclosing));
    if (named.every((child, at) => child === given[at])) return node;
    const { factory } = ts;
    if (ts.isArrayTypeNode(node)) return factory.updateArrayTypeNode(node, named[0] as TsTypes.TypeNode);
    if (ts.isImportTypeNode(node)) return factory.updateImportTypeNode(node, node.argument, node.attributes, node.qualifier, named, node.isTypeOf);
    return factory.updateTypeReferenceNode(node, node.typeName, factory.createNodeArray(named));
  }
  if (ts.isUnionTypeNode(node) && type.isUnion()) {
    const members = type.types.filter(member => (member.flags & ts.TypeFlags.Object) !== 0);
    const used = new Set<TsTypes.Type>();
    const named = node.types.map(child => {
      if (!ts.isTypeLiteralNode(child)) return child;
      const key = shapeKey(child.members.map(member => (member.name === undefined ? '' : ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : '')));
      const match = members.find(member => !used.has(member) && shapeKey(c.checker.getPropertiesOfType(member).map(property => property.name)) === key);
      if (match === undefined) return child;
      used.add(match);
      return nameAnonymousParts(c, child, match, enclosing);
    });
    return named.every((child, at) => child === node.types[at]) ? node : ts.factory.updateUnionTypeNode(node, ts.factory.createNodeArray(named));
  }
  return node;
}

/** The directory-relative form of `target` from the folder of `from`, without extension, the way a relative import is written. */
export function relativeSpecifier(from: string, target: string): string {
  const relative = posix(path.relative(path.dirname(from), target)).replace(/\.(?:d\.)?[cm]?tsx?$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

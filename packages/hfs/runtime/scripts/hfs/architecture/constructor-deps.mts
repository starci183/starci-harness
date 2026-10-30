import path from 'node:path';
import type { BindingElement, CallExpression, ClassDeclaration, ConstructorDeclaration, Declaration, Decorator, Expression, FunctionDeclaration, Identifier, Node, ParameterDeclaration, SourceFile, TypeChecker, TypeNode, VariableDeclaration } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { MachineKit } from './machine-ast.mjs';

/** The identifier a decorator names and the call it is applied through, when it is one. */
interface DecoratorHead {
  callee: Identifier;
  call: CallExpression | null;
}

/** A token the decorator names: the exported name it is declared under, and where it is declared. */
export interface ResolvedToken {
  kind: 'token';
  name: string;
  declaration: VariableDeclaration | BindingElement | null;
  argument: Identifier;
  external: boolean;
  node?: undefined;
}

/** A dependency (or token) the reader cannot follow, with why and the node to report at. */
export interface UnresolvedToken {
  kind: 'unresolved';
  reason: string;
  node: Node | null;
}

export type TokenOfArgument = ResolvedToken | UnresolvedToken;

/** What a custom `Inject<Thing>()` or raw `@Inject(TOKEN)` decorator resolves to, with the decorator's own facts. */
export type InjectToken = TokenOfArgument & TokenFacts;

/** The decorator's own facts a resolved inject decorator carries. */
interface TokenFacts {
  decorator: string;
  decoratorDeclaration?: Declaration | null;
  decoratorFile?: null;
  injectorCall?: CallExpression;
}

/** A parameter and the node a finding about it is reported at. */
interface Located {
  parameter: ParameterDeclaration;
  node: Node;
}

/** One constructor parameter's dependency. */
export type ClassDependency =
  | (Omit<ResolvedToken, 'node'> & TokenFacts & Located)
  | (Omit<UnresolvedToken, 'node'> & TokenFacts & Located)
  | { kind: 'class'; name: string; parameter: ParameterDeclaration; node: Node }
  | { kind: 'unresolved'; reason: string; parameter: ParameterDeclaration; node: Node };

/** A service class of the program with the file declaring it. */
export interface ServiceClass {
  file: GraphFile;
  declaration: ClassDeclaration;
}

type NamedClass = ClassDeclaration & { name: Identifier };

/**
 * The constructor dependencies of a service, read the way the injection law (R85) writes them, shared by the unit-spec
 * provider check (R48 `unit-spec-providers`) and the token export check (R85 `injection-token-exported`).
 *
 * A constructor parameter is one of
 *   - `token`: decorated with a custom `Inject<Thing>()` decorator. The decorator is declared in a `<cap>.decorators.ts`
 *     as `injector<T>(TOKEN)`; the dependency is the TOKEN it names, identified by the name the token is exported under
 *     (the declaration's own name), never by the decorator's or the parameter's name. A raw `@Inject(TOKEN)` is read the same way.
 *   - `class`: no injection decorator and a class type; the dependency is that class.
 *   - `unresolved`: anything else (a token expression that is not a plain identifier, a decorator the reader cannot follow,
 *     a type that is not a class).
 */
const INJECT_NAME = /^Inject(?:[A-Z][A-Za-z0-9]*)?$/u;

/** The identifier a decorator names: `@InjectFoo()` -> InjectFoo, `@Inject(TOKEN)` -> Inject; null for a non-identifier decorator. */
function decoratorCallee(ts: TypeScriptApi, decorator: Decorator): DecoratorHead | null {
  const expression = decorator.expression;
  const callee = ts.isCallExpression(expression) ? expression.expression : expression;
  return ts.isIdentifier(callee) ? { callee, call: ts.isCallExpression(expression) ? expression : null } : null;
}

/** The token a `injector(<arg>)` call names, judged where the argument is declared. */
function tokenOfArgument(kit: MachineKit, checker: TypeChecker, argument: Expression | undefined): TokenOfArgument {
  const { ts } = kit;
  if (!argument || !ts.isIdentifier(argument)) return { kind: 'unresolved', reason: 'its token is not a plain identifier of an exported const', node: argument ?? null };
  const declaration = kit.declarationsOf(checker, argument).find((item): item is VariableDeclaration | BindingElement => ts.isVariableDeclaration(item) || ts.isBindingElement(item));
  if (declaration) {
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : argument.text;
    return { kind: 'token', name, declaration, argument, external: false };
  }
  const binding = kit.importBinding(checker, argument);
  if (binding && !binding.module.startsWith('.')) return { kind: 'token', name: binding.name, declaration: null, argument, external: true };
  return { kind: 'unresolved', reason: `the token ${argument.text} does not resolve to a declaration`, node: argument };
}

/** The first `injector(...)` call under a decorator declaration, or null. */
function injectorCallOf(kit: MachineKit, declaration: Declaration): CallExpression | null {
  const { ts } = kit;
  let injectorCall: CallExpression | null = null;
  kit.walk(declaration, node => {
    if (injectorCall) return false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = kit.importBinding(kit.checkerOf(declaration.getSourceFile()), node.expression);
      if ((binding?.name ?? node.expression.text) === 'injector') injectorCall = node;
    }
    return true;
  });
  return injectorCall;
}

/** The injector token of a custom `Inject<Thing>()` decorator, or an unresolved reason. */
function tokenOfInjectDecorator(kit: MachineKit, checker: TypeChecker, parameter: ParameterDeclaration, decorator: Decorator): InjectToken | null {
  const { ts } = kit;
  const head = decoratorCallee(ts, decorator);
  if (!head || !INJECT_NAME.test(head.callee.text)) return null;
  if (head.callee.text === 'Inject' && head.call?.arguments.length) return { ...tokenOfArgument(kit, checker, head.call.arguments[0]), decorator: head.callee.text, decoratorDeclaration: null, decoratorFile: null };
  const declaration = kit.declarationsOf(checker, head.callee).find((item): item is VariableDeclaration | FunctionDeclaration => ts.isVariableDeclaration(item) || ts.isFunctionDeclaration(item));
  if (!declaration) return { kind: 'unresolved', reason: `${head.callee.text}() does not resolve to a declaration`, node: parameter, decorator: head.callee.text };
  const injectorCall = injectorCallOf(kit, declaration);
  if (!injectorCall) return { kind: 'unresolved', reason: `${head.callee.text}() is not built with injector<T>(TOKEN)`, node: parameter, decorator: head.callee.text };
  const declarationChecker = kit.checkerOf(declaration.getSourceFile());
  return { ...tokenOfArgument(kit, declarationChecker, injectorCall.arguments[0]), decorator: head.callee.text, decoratorDeclaration: declaration, injectorCall };
}

/** The class a parameter type names, judged where the type is declared; null when it is not a class type. */
function classOfType(kit: MachineKit, checker: TypeChecker, type: TypeNode | undefined): string | null {
  const { ts } = kit;
  if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return null;
  const declarations = kit.declarationsOf(checker, type.typeName);
  const declared = declarations.find((item): item is NamedClass => ts.isClassDeclaration(item) && Boolean(item.name));
  if (declared) return declared.name.text;
  if (declarations.length) return null;
  const binding = kit.importBinding(checker, type.typeName);
  return binding && binding.name !== 'default' && binding.name !== '*' ? binding.name : null;
}

/** The dependencies of one class, in constructor order: [{kind, name?, node, parameter, ...}]. */
export function constructorDependencies(kit: MachineKit, file: { sourceFile: SourceFile }, classDeclaration: ClassDeclaration): ClassDependency[] {
  const { ts } = kit;
  const checker = kit.checkerOf(file.sourceFile);
  const constructor = classDeclaration.members.find((member): member is ConstructorDeclaration => ts.isConstructorDeclaration(member) && member.body !== undefined)
    ?? classDeclaration.members.find((member): member is ConstructorDeclaration => ts.isConstructorDeclaration(member));
  if (!constructor) return [];
  return constructor.parameters.map((parameter): ClassDependency => {
    for (const decorator of kit.decorators(parameter)) {
      const token = tokenOfInjectDecorator(kit, checker, parameter, decorator);
      if (token) return { ...token, parameter, node: token.node ?? parameter };
    }
    const name = classOfType(kit, checker, parameter.type);
    if (name) return { kind: 'class', name, parameter, node: parameter };
    return { kind: 'unresolved', reason: 'it has no Inject<Thing>() decorator and its type is not a class', parameter, node: parameter };
  });
}

/** Every service class of the program: [{file, declaration}] for each class of a `*.service.ts` file. */
export function serviceClasses(kit: MachineKit, graph: HfsGraph): ServiceClass[] {
  const { ts } = kit;
  const found: ServiceClass[] = [];
  for (const file of graph.files.values()) {
    if (!path.posix.basename(file.rel).endsWith('.service.ts')) continue;
    for (const statement of file.sourceFile.statements) if (ts.isClassDeclaration(statement) && statement.name) found.push({ file, declaration: statement });
  }
  return found;
}

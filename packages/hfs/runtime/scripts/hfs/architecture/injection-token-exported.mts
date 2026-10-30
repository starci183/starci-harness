import path from 'node:path';
import type { CallExpression, Declaration, Node, Statement, VariableStatement } from 'typescript';
import { machineKit } from './machine-ast.mjs';
import type { MachineInput, MachineKit } from './machine-ast.mjs';
import { constructorDependencies, serviceClasses } from './constructor-deps.mjs';
import type { ClassDependency } from './constructor-deps.mjs';
import type { TypeScriptApi } from './config.mjs';
import type { GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { Violation } from './ast-walks.mjs';

/** A dependency whose decorator is declared in the program and built with an `injector(...)` call. */
type InjectorDependency = Extract<ClassDependency, { decorator: string }> & { decoratorDeclaration: Declaration; injectorCall: CallExpression };

const hasInjector = (dependency: ClassDependency): dependency is InjectorDependency => 'decoratorDeclaration' in dependency && 'injectorCall' in dependency
  && Boolean(dependency.decoratorDeclaration) && Boolean(dependency.injectorCall);

export interface InjectionTokenExportedResult {
  violations: Violation[];
  coverage: { status: 'checked'; decorators: number; files: number };
}

/**
 * R85 `injection-token-exported` (BE_RAW_INJECT), the injection law's last obligation: a spec can only provide a token it
 * can import. Every `Inject<Thing>()` decorator that a service constructor uses resolves to a token (the argument of its
 * `injector<T>(TOKEN)`), and that token must be EXPORTED, by name, from the file of the decorator (`<cap>.decorators.ts`),
 * from the `<cap>.decorators.ts` that declares it, or from the index.ts of the capability that owns either file. A token
 * that is a private (non-exported) const, or one only a sibling file of the capability can reach, cannot be provided by a
 * unit spec and is a finding. A token that a package declares (a Nest options token, say) is the package's export.
 * The finding sits on the decorator's `injector(...)` call, once per decorator, however many services use it.
 */
export const INJECTION_TOKEN_EXPORTED_RULE_IDS = ['BE_RAW_INJECT'];

const RULE = 'BE_RAW_INJECT';

const exportedVariableHasName = (ts: TypeScriptApi, kit: MachineKit, statement: Statement, name: string): boolean => {
  // The modifier flags are read off the statement itself; the kit types its argument as a declaration.
  if (!ts.isVariableStatement(statement) || !kit.isExported(statement as VariableStatement & Declaration)) return false;
  return statement.declarationList.declarations.some(declaration =>
    (ts.isIdentifier(declaration.name) && declaration.name.text === name)
    || (ts.isObjectBindingPattern(declaration.name) && declaration.name.elements.some(element => ts.isIdentifier(element.name) && element.name.text === name)));
};

const exportedDeclarationHasName = (ts: TypeScriptApi, statement: Statement, name: string): boolean => {
  if (!ts.isExportDeclaration(statement)) return false;
  const clause = statement.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.some(element => element.name.text === name);
};

const exportsName = (ts: TypeScriptApi, kit: MachineKit, file: GraphFile | null | undefined, name: string): boolean => file?.sourceFile.statements.some(statement =>
  exportedVariableHasName(ts, kit, statement, name) || exportedDeclarationHasName(ts, statement, name)) === true;

const indexOf = (graph: HfsGraph, file: GraphFile | null | undefined): GraphFile | null | undefined => (file?.owner ? graph.files.get(`${file.owner.root}/index.ts`) : null);

/** The graph file declaring `declaration`, when the program holds it. */
const graphFileOf = (graph: HfsGraph, kit: MachineKit, declaration: Declaration): GraphFile | undefined => {
  const rel = kit.graphPath(declaration);
  return rel === null ? undefined : graph.files.get(rel);
};

const injectionViolationFor = (graph: HfsGraph, kit: MachineKit, ts: TypeScriptApi, dependency: InjectorDependency): Violation | null => {
  const decoratorFile = graphFileOf(graph, kit, dependency.decoratorDeclaration);
  if (dependency.kind === 'unresolved') {
    return decoratorFile ? { ruleId: RULE, path: decoratorFile.rel, ...kit.at(decoratorFile.rel, decoratorFile.sourceFile, dependency.injectorCall), decorator: dependency.decorator,
      message: `${dependency.decorator}() cannot be followed to its token (${dependency.reason}); name an exported \`unique symbol\` const so a unit spec can provide it.` } : null;
  }
  const tokenFile = dependency.declaration ? graphFileOf(graph, kit, dependency.declaration) : null;
  const homes = [decoratorFile, tokenFile && path.posix.basename(tokenFile.rel).endsWith('.decorators.ts') ? tokenFile : null, indexOf(graph, decoratorFile), indexOf(graph, tokenFile)];
  if (!decoratorFile || homes.some(home => exportsName(ts, kit, home, dependency.name))) return null;
  return { ruleId: RULE, path: decoratorFile.rel, ...kit.at(decoratorFile.rel, decoratorFile.sourceFile, dependency.injectorCall), decorator: dependency.decorator, token: dependency.name,
    message: `${dependency.decorator}() injects ${dependency.name}, which is not exported from ${path.posix.basename(decoratorFile.rel)} nor from the capability index.ts; export the token so a unit spec can provide it (\`{ provide: ${dependency.name}, useValue: double }\`).` };
};

export function checkInjectionTokenExported(input: MachineInput): InjectionTokenExportedResult {
  const { graph } = input;
  const kit = machineKit(input);
  const { ts } = kit;
  const violations: Violation[] = [];
  const seen = new Set<Node>();
  let decorators = 0;

  for (const { file, declaration } of serviceClasses(kit, graph)) {
    for (const dependency of constructorDependencies(kit, file, declaration)) {
      if (!hasInjector(dependency) || (dependency.kind === 'token' && dependency.external) || seen.has(dependency.injectorCall)) continue;
      seen.add(dependency.injectorCall);
      decorators += 1;
      const violation = injectionViolationFor(graph, kit, ts, dependency);
      if (violation) violations.push(violation);
    }
  }
  return { violations, coverage: { status: 'checked', decorators, files: graph.files.size } };
}

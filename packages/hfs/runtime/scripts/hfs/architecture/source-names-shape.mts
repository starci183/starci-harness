import type { CallExpression, ClassDeclaration, Declaration, Decorator, EnumDeclaration, Node, SourceFile, Statement, SyntaxKind, Symbol as TsSymbol, TypeChecker, VariableDeclaration } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { TypeContext } from './type-context.mjs';
import { relativePath, UNPROVEN_FRAMEWORK, unwrapExpression } from './typescript.mjs';
import { constructedDecoratorKind, mutableDecoratorKind, nodeDecorators, tracedFrameworkKinds, violation } from './ast-walks.mjs';
import type { TraceOptions, Violation } from './ast-walks.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

/** A source file's basename split into its base and its role suffix (`user.service.ts` -> base `user.service`, role `service`). */
export interface SourceRole {
  base: string;
  role: string | null;
  spec: boolean;
}

/** The framework symbols a program binds (symbol -> framework export name) and the reasons any binding could not be proved. */
export interface FrameworkBindings {
  bySymbol: Map<TsSymbol, string>;
  reasons: string[];
}

/** Whether an exported declaration's value is a class, and the class names it can resolve to. */
export interface ClassValueStatus {
  status: 'class' | 'not-class' | 'unavailable';
  names: string[];
}

/** Whether a type declaration is an object contract. */
export type ObjectStatus = 'object' | 'unavailable' | 'not-object';

/** What the GraphQL `@Query` / `@Mutation` / `@Subscription` field-name check reads. */
export interface GraphqlFieldInput {
  config: ArchitectureConfig;
  context: TypeContext;
  sourceFile: SourceFile;
  node: Node;
  decorator: Decorator;
  kind: string;
  namingReasons: string[];
  violations: Violation[];
}

/** One basis the source-shape coverage reports: checked, or unavailable with the reasons. */
export interface ShapeStatus {
  status: string;
  reason?: string;
  details?: string[];
}

/** The coverage of the backend source-shape check. */
export interface ShapeCoverage {
  files: number;
  layout: ShapeStatus;
  naming: ShapeStatus;
}

/** What the backend source-shape check returns. */
export interface ShapeResult {
  violations: Violation[];
  coverage: ShapeCoverage;
}

/** The helpers and constants `source-names.mts` hands the shape walk (it cannot be imported back without a cycle). */
export interface SourceShapeHelpers {
  absoluteRoots: (root: string, relatives: string[]) => string[];
  canonical: (file: string) => string;
  frameworkTargets: (config: ArchitectureConfig, context: TypeContext, checker: TypeChecker, localFiles: Set<string>) => FrameworkBindings;
  locatedRoot: (roots: string[], fileName: string) => string | null;
  sourceRole: (ts: TypeScriptApi, sourceFile: SourceFile) => SourceRole;
  kebabSourceBase: (base: string) => boolean;
  exportedDeclarations: (ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile) => Set<Declaration>;
  classValueStatus: (ts: TypeScriptApi, checker: TypeChecker, expression: Node | null | undefined, seen?: Set<TsSymbol>, depth?: number) => ClassValueStatus;
  objectContractStatus: (ts: TypeScriptApi, checker: TypeChecker, node: Node) => ObjectStatus;
  companionInterfaceAllowed: (ts: TypeScriptApi, sourceFile: SourceFile, name: string) => boolean;
  hasModifier: (ts: TypeScriptApi, node: Node, kind: SyntaxKind) => boolean;
  graphqlField: (input: GraphqlFieldInput) => void;
  graphqlArgument: (config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, node: Node, decorator: Decorator, namingReasons: string[], violations: Violation[]) => void;
  graphqlEnumRegistration: (config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, call: CallExpression, namingReasons: string[], violations: Violation[]) => void;
  selectedCallKind: (ts: TypeScriptApi, checker: TypeChecker, call: CallExpression, targets: Map<TsSymbol, string>) => string | null;
  callsNamedHelper: (ts: TypeScriptApi, checker: TypeChecker, call: CallExpression, name: string) => boolean;
  implementsFramework: (ts: TypeScriptApi, checker: TypeChecker, declaration: ClassDeclaration, targets: Map<TsSymbol, string>, name: string) => boolean;
  implementedPortNames: (ts: TypeScriptApi, checker: TypeChecker, declaration: ClassDeclaration) => string[];
  decoratorKind: (ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<TsSymbol, string>) => string | null;
  SOURCE_LAYOUT_RULE_ID: string;
  SOURCE_NAME_RULE_ID: string;
  APPLICATION_ROLES: Set<string>;
  TRANSPORT_ROLES: Set<string>;
  APPLICATION_LAYER_ROLES: Set<string>;
  TRANSPORT_LAYER_ROLES: Set<string>;
  CLASS_ROLE_SUFFIX: Map<string, string>;
  TRANSPORT_OBJECT_SUFFIX: Map<string, string>;
  NON_CLASS_ROLES: Set<string>;
  SPECIAL_BASENAMES: Set<string>;
  TRACE_NEW: TraceOptions;
}

/** The feature and module roots a check judges and the files of the program. */
interface ShapeRoots {
  featureRoots: string[];
  moduleRoots: string[];
  localFiles: Set<string>;
}

/** What the walk counts and reports across files. */
interface ShapeState {
  frameworkByChecker: Map<TypeChecker, FrameworkBindings>;
  violations: Violation[];
  layoutReasons: string[];
  namingReasons: string[];
  checkedFiles: number;
}

/** Everything the per-file inspections read about the file being judged. */
interface SourceInfo {
  config: ArchitectureConfig;
  context: TypeContext;
  sourceFile: SourceFile;
  fileName: string;
  featureRoot: string | null;
  moduleRoot: string | null;
  checker: TypeChecker;
  framework: FrameworkBindings;
  directories: string[];
  transportIndex: number;
  inApplication: boolean;
  inTransport: boolean;
  role: SourceRole;
  relative: string;
  migrationName: boolean;
  persistencePath: boolean;
  special: boolean;
  publicDeclarations: Set<Declaration>;
}

function locateSource(h: SourceShapeHelpers, config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, roots: ShapeRoots, state: ShapeState): SourceInfo | null {
  const { featureRoots, moduleRoots, localFiles } = roots;
  const { canonical, frameworkTargets, locatedRoot, sourceRole, exportedDeclarations, SPECIAL_BASENAMES } = h;
  const fileName = canonical(sourceFile.fileName);
  const featureRoot = locatedRoot(featureRoots, fileName);
  const moduleRoot = locatedRoot(moduleRoots, fileName);
  const ownerRoot = featureRoot ?? moduleRoot;
  if (!ownerRoot) return null;
  state.checkedFiles += 1;
  const checker = context.checkerFor(fileName);
  if (!checker) return null;
  if (!state.frameworkByChecker.has(checker)) state.frameworkByChecker.set(checker, frameworkTargets(config, context, checker, localFiles));
  const framework = state.frameworkByChecker.get(checker) ?? frameworkTargets(config, context, checker, localFiles);
  const relativeToOwner = relativePath(ownerRoot, fileName);
  const parts = relativeToOwner.split('/');
  const directories = parts.slice(0, -1).map(part => part.toLowerCase());
  const applicationIndex = directories.indexOf('application');
  const transportIndex = directories.indexOf('transport');
  const inApplication = applicationIndex >= 0;
  const inTransport = transportIndex >= 0;
  const role = sourceRole(context.ts, sourceFile);
  const relative = relativePath(config.root, fileName);
  const migrationName = /^\d{10,}-[A-Z][A-Za-z0-9]*$/.test(role.base);
  const persistencePath = !role.spec && (migrationName || directories.includes('migrations'));
  const special = SPECIAL_BASENAMES.has(role.base.toLowerCase()) || migrationName
    || ['constants', 'enums', 'errors', 'migrations'].some(folder => directories.includes(folder));
  const publicDeclarations = exportedDeclarations(context.ts, checker, sourceFile);
  return { config, context, sourceFile, fileName, featureRoot, moduleRoot, checker, framework, directories, transportIndex,
    inApplication, inTransport, role, relative, migrationName, persistencePath, special, publicDeclarations };
}

function reportSourceName(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const { kebabSourceBase, SOURCE_NAME_RULE_ID } = h;
  const { config, sourceFile, migrationName, role, relative } = info;
  if (!migrationName && !kebabSourceBase(role.base)) state.violations.push(violation(config, sourceFile, sourceFile, SOURCE_NAME_RULE_ID,
    `Source basename ${role.base} must use kebab-case segments plus an explicit role suffix.`));
  if (!role.role && !info.special) state.namingReasons.push(`${relative} has no statically identifiable source role`);
}

function reportFeatureRoleConflicts(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const { SOURCE_LAYOUT_RULE_ID, APPLICATION_ROLES, TRANSPORT_ROLES } = h;
  const { config, sourceFile, role, directories, inApplication, inTransport, transportIndex } = info;
  const { violations } = state;
  if (inApplication && inTransport) violations.push(violation(config, sourceFile, sourceFile, SOURCE_LAYOUT_RULE_ID,
    'A feature source cannot belong to both application and transport layers.'));
  if (role.role && APPLICATION_ROLES.has(role.role) && !inApplication) violations.push(violation(config, sourceFile, sourceFile,
    SOURCE_LAYOUT_RULE_ID, `${role.role} source belongs under the feature application/ layer.`));
  if (role.role && TRANSPORT_ROLES.has(role.role) && !inTransport) violations.push(violation(config, sourceFile, sourceFile,
    SOURCE_LAYOUT_RULE_ID, `${role.role} source belongs under the feature transport/<protocol>/ layer.`));
  if (inApplication && role.role && TRANSPORT_ROLES.has(role.role)) violations.push(violation(config, sourceFile, sourceFile,
    SOURCE_LAYOUT_RULE_ID, `Transport role ${role.role} cannot live in application/.`));
  if (inTransport && role.role && APPLICATION_ROLES.has(role.role)) violations.push(violation(config, sourceFile, sourceFile,
    SOURCE_LAYOUT_RULE_ID, `Application role ${role.role} cannot live in transport/.`));
  if (inTransport && transportIndex >= directories.length - 1) violations.push(violation(config, sourceFile, sourceFile,
    SOURCE_LAYOUT_RULE_ID, 'Feature transport source must name a protocol below transport/.'));
}

/** A non-index source whose role is neither one of the layer's own roles nor one the other layer or the schema owns. */
function unselectedLayerRole(role: SourceRole, layerRoles: Set<string>, otherRoles: Set<string>): boolean {
  return role.base !== 'index' && (!role.role || !layerRoles.has(role.role)) && !(role.role && (otherRoles.has(role.role) || role.role === 'entity'));
}

function reportFeatureRoleSelection(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const { APPLICATION_ROLES, TRANSPORT_ROLES, APPLICATION_LAYER_ROLES, TRANSPORT_LAYER_ROLES } = h;
  const { role, relative, directories, inApplication, inTransport, persistencePath } = info;
  const topLevelFeatureFile = directories.length === 1 && (role.base === 'index' || role.role === 'module' || role.spec);
  if (inApplication && unselectedLayerRole(role, APPLICATION_LAYER_ROLES, TRANSPORT_ROLES)) {
    state.layoutReasons.push(`${relative} role ${role.role ?? '(unclassified)'} is not a selected application-layer role`);
  }
  if (inTransport && unselectedLayerRole(role, TRANSPORT_LAYER_ROLES, APPLICATION_ROLES)) {
    state.layoutReasons.push(`${relative} role ${role.role ?? '(unclassified)'} is not a selected transport-layer role`);
  }
  if (inApplication || inTransport || topLevelFeatureFile) return;
  if (role.role && role.role !== 'entity' && !APPLICATION_ROLES.has(role.role) && !TRANSPORT_ROLES.has(role.role)) {
    state.layoutReasons.push(`${relative} role ${role.role} has no statically selected feature layer`);
  }
  if (!role.role && !persistencePath) state.layoutReasons.push(`${relative} has no statically selected feature layer`);
}

function reportFeatureSchemaPlacement(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const { SOURCE_LAYOUT_RULE_ID } = h;
  const { config, sourceFile, role, persistencePath } = info;
  if (persistencePath) state.violations.push(violation(config, sourceFile, sourceFile, SOURCE_LAYOUT_RULE_ID,
    'Migration source cannot be owned by a feature; place it under the declared persistence module.'));
  if (role.role === 'entity') state.violations.push(violation(config, sourceFile, sourceFile, SOURCE_LAYOUT_RULE_ID,
    'Entity source cannot be owned by a feature; place schema under the declared persistence module.'));
}

function reportFeatureLayout(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  if (!info.featureRoot) return;
  reportFeatureRoleConflicts(h, info, state);
  reportFeatureRoleSelection(h, info, state);
  reportFeatureSchemaPlacement(h, info, state);
}

function inspectClassPlacement(h: SourceShapeHelpers, info: SourceInfo, declaration: ClassDeclaration, kinds: string[], state: ShapeState): void {
  const { implementsFramework, SOURCE_LAYOUT_RULE_ID } = h;
  const { config, context, sourceFile, featureRoot, inTransport, directories, transportIndex, checker, framework } = info;
  const { ts } = context;
  const graphQlDto = kinds.some(kind => kind === 'ArgsType' || kind === 'InputType' || kind === 'ObjectType');
  if (graphQlDto && (!featureRoot || !inTransport || directories[transportIndex + 1] !== 'graphql')) {
    state.violations.push(violation(config, sourceFile, declaration.name ?? declaration, SOURCE_LAYOUT_RULE_ID,
      'GraphQL DTO classes belong under a feature transport/graphql/ boundary.'));
  }
  const persistenceSchema = kinds.includes('Entity') || kinds.includes('ViewEntity')
    || implementsFramework(ts, checker, declaration, framework.bySymbol, 'MigrationInterface');
  if (persistenceSchema && featureRoot) state.violations.push(violation(config, sourceFile, declaration.name ?? declaration, SOURCE_LAYOUT_RULE_ID,
    'TypeORM entities and migrations cannot be owned by a feature; place schema under its declared persistence module.'));
}

function inspectClassName(h: SourceShapeHelpers, info: SourceInfo, declaration: ClassDeclaration, state: ShapeState): void {
  const { implementedPortNames, SOURCE_NAME_RULE_ID, CLASS_ROLE_SUFFIX, NON_CLASS_ROLES } = h;
  const { config, sourceFile, role, relative, checker } = info;
  const { ts } = info.context;
  const { publicDeclarations } = info;
  const classSuffix = role.role && !NON_CLASS_ROLES.has(role.role) ? CLASS_ROLE_SUFFIX.get(role.role) : null;
  const nameNode = declaration.name;
  if (publicDeclarations.has(declaration) && !nameNode) state.namingReasons.push(`${relative} exports an anonymous class whose role name cannot be proved`);
  else if (publicDeclarations.has(declaration) && nameNode && classSuffix && !nameNode.text.endsWith(classSuffix)
    && !implementedPortNames(ts, checker, declaration).some(port => nameNode.text.endsWith(port))) {
    state.violations.push(violation(config, sourceFile, nameNode, SOURCE_NAME_RULE_ID,
      `Exported class ${nameNode.text} must end in ${classSuffix} for a ${role.role} source file, or in the name of the port it implements.`));
  } else if (publicDeclarations.has(declaration) && nameNode && role.role && !NON_CLASS_ROLES.has(role.role) && !classSuffix) {
    state.namingReasons.push(`${relative} declares exported class ${nameNode.text} with unclassified file role ${role.role}`);
  }
}

function inspectClass(h: SourceShapeHelpers, info: SourceInfo, declaration: ClassDeclaration, state: ShapeState): void {
  const { decoratorKind } = h;
  const { ts } = info.context;
  const { checker, framework } = info;
  const declarationDecorators = nodeDecorators(ts, declaration);
  const kinds = declarationDecorators.map(decorator => decoratorKind(ts, checker, decorator, framework.bySymbol)).filter((kind): kind is string => Boolean(kind));
  inspectClassPlacement(h, info, declaration, kinds, state);
  inspectClassName(h, info, declaration, state);
}

function inspectClasses(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const declarations = info.sourceFile.statements.filter((statement): statement is ClassDeclaration => info.context.ts.isClassDeclaration(statement));
  for (const declaration of declarations) inspectClass(h, info, declaration, state);
}

function inspectClassValue(h: SourceShapeHelpers, info: SourceInfo, declaration: VariableDeclaration, state: ShapeState): void {
  const { classValueStatus, SOURCE_NAME_RULE_ID, CLASS_ROLE_SUFFIX, NON_CLASS_ROLES } = h;
  const { config, sourceFile, relative, role, checker, publicDeclarations } = info;
  const { ts } = info.context;
  if (!publicDeclarations.has(declaration) || !declaration.initializer) return;
  const classValue = classValueStatus(ts, checker, declaration.initializer);
  if (classValue.status === 'unavailable') {
    state.namingReasons.push(`${relative} exports a class-valued declaration whose role identity is not statically proved`);
    return;
  }
  if (classValue.status !== 'class') return;
  const classSuffix = role.role && !NON_CLASS_ROLES.has(role.role) ? CLASS_ROLE_SUFFIX.get(role.role) : null;
  if (!classSuffix || !ts.isIdentifier(declaration.name)) {
    state.namingReasons.push(`${relative} exports a class-valued declaration without a statically selected class role`);
    return;
  }
  const names = [declaration.name.text, ...classValue.names];
  const invalid = names.find(name => !name.endsWith(classSuffix));
  if (invalid) state.violations.push(violation(config, sourceFile, declaration.name, SOURCE_NAME_RULE_ID,
    `Exported class value ${invalid} must end in ${classSuffix} for a ${role.role} source file.`));
}

function inspectClassValues(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  const { ts } = info.context;
  const { sourceFile } = info;
  for (const statement of sourceFile.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) inspectClassValue(h, info, declaration, state);
  }
}

function inspectEnumMembers(h: SourceShapeHelpers, info: SourceInfo, statement: EnumDeclaration, state: ShapeState): void {
  const { SOURCE_NAME_RULE_ID } = h;
  const { config, sourceFile } = info;
  const { ts } = info.context;
  for (const member of statement.members) {
    const name = ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name) ? member.name.text : null;
    const initializer = member.initializer && unwrapExpression(ts, member.initializer);
    if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name) || !initializer || !ts.isStringLiteralLike(initializer)) {
      state.violations.push(violation(config, sourceFile, member.name, SOURCE_NAME_RULE_ID,
        'Enum members must use PascalCase names with explicit static string values.'));
    }
  }
}

function inspectObjectContract(h: SourceShapeHelpers, info: SourceInfo, statement: Statement, state: ShapeState): void {
  const { objectContractStatus, companionInterfaceAllowed, SOURCE_NAME_RULE_ID, TRANSPORT_OBJECT_SUFFIX } = h;
  const { config, sourceFile, role, checker, publicDeclarations } = info;
  const { ts } = info.context;
  // an object contract is an interface or an object type alias, so any other statement has no contract name to judge
  if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) return;
  const contractStatus = objectContractStatus(ts, checker, statement);
  const transportSuffix = role.role === null ? undefined : TRANSPORT_OBJECT_SUFFIX.get(role.role);
  if (contractStatus === 'object' && publicDeclarations.has(statement) && transportSuffix && !role.spec
    && !statement.name.text.endsWith(transportSuffix) && !companionInterfaceAllowed(ts, sourceFile, statement.name.text)) {
    state.violations.push(violation(config, sourceFile, statement.name, SOURCE_NAME_RULE_ID,
      `Public object contract ${statement.name.text} in a ${role.role} source file must end in ${transportSuffix}.`));
  }
}

function inspectEnumAndContract(h: SourceShapeHelpers, info: SourceInfo, statement: Statement, state: ShapeState): void {
  const { hasModifier, SOURCE_NAME_RULE_ID } = h;
  const { config, sourceFile } = info;
  const { ts } = info.context;
  if (ts.isEnumDeclaration(statement)) {
    if (hasModifier(ts, statement, ts.SyntaxKind.ConstKeyword) || !/^[A-Z][A-Za-z0-9]*$/.test(statement.name.text)) {
      state.violations.push(violation(config, sourceFile, statement.name, SOURCE_NAME_RULE_ID,
        'Enums must be non-const declarations with PascalCase names.'));
    }
    inspectEnumMembers(h, info, statement, state);
  }
  inspectObjectContract(h, info, statement, state);
}

function inspectEnumsAndContracts(h: SourceShapeHelpers, info: SourceInfo, state: ShapeState): void {
  for (const statement of info.sourceFile.statements) inspectEnumAndContract(h, info, statement, state);
}

function inspectDynamicDecorator(info: SourceInfo, dynamic: string, state: ShapeState): void {
  const detail = `${info.relative} uses a mutable or constructed ${dynamic} decorator identity`;
  if (['Entity', 'ViewEntity', 'ArgsType', 'InputType', 'ObjectType', 'multiple framework', 'unproven framework'].includes(dynamic)) state.layoutReasons.push(detail);
  if (!['Entity', 'ViewEntity'].includes(dynamic)) state.namingReasons.push(detail);
}

function inspectDecorator(h: SourceShapeHelpers, info: SourceInfo, node: Node, decorator: Decorator, state: ShapeState): void {
  const { graphqlField, graphqlArgument, decoratorKind, TRACE_NEW } = h;
  const { ts } = info.context;
  const { checker, framework } = info;
  const kind = decoratorKind(ts, checker, decorator, framework.bySymbol);
  if (!kind) {
    const dynamic = mutableDecoratorKind(ts, checker, decorator, framework.bySymbol)
      ?? constructedDecoratorKind(ts, checker, decorator, framework.bySymbol, TRACE_NEW);
    if (dynamic) inspectDynamicDecorator(info, dynamic, state);
  }
  if (kind === 'Mutation' || kind === 'Query') graphqlField({ config: info.config, context: info.context, sourceFile: info.sourceFile,
    node, decorator, kind, namingReasons: state.namingReasons, violations: state.violations });
  if (kind === 'Args') graphqlArgument(info.config, info.context, info.sourceFile, node, decorator, state.namingReasons, state.violations);
}

function inspectNodeDecorators(h: SourceShapeHelpers, info: SourceInfo, node: Node, state: ShapeState): void {
  for (const decorator of nodeDecorators(info.context.ts, node)) inspectDecorator(h, info, node, decorator, state);
}

function inspectEnumCalls(h: SourceShapeHelpers, info: SourceInfo, node: Node, state: ShapeState): void {
  const { graphqlEnumRegistration, selectedCallKind, callsNamedHelper } = h;
  const { ts } = info.context;
  const { checker, framework } = info;
  if (!ts.isCallExpression(node)) return;
  if (selectedCallKind(ts, checker, node, framework.bySymbol) === 'registerEnumType') {
    graphqlEnumRegistration(info.config, info.context, info.sourceFile, node, state.namingReasons, state.violations);
  } else if (callsNamedHelper(ts, checker, node, 'createEnumType')) {
    state.namingReasons.push(`${info.relative} calls a project GraphQL enum adapter whose emitted type name is not statically proved`);
  }
}

function inspectConstructedSource(h: SourceShapeHelpers, info: SourceInfo, node: Node, state: ShapeState): void {
  const { SOURCE_LAYOUT_RULE_ID, TRACE_NEW } = h;
  const { ts } = info.context;
  const { checker, framework, publicDeclarations, featureRoot } = info;
  const exportedFactoryCall = ts.isCallExpression(node) && ts.isVariableDeclaration(node.parent) && publicDeclarations.has(node.parent);
  if ((ts.isNewExpression(node) || exportedFactoryCall) && featureRoot) {
    const constructed = tracedFrameworkKinds(ts, checker, node, framework.bySymbol, TRACE_NEW);
    if (constructed.has('EntitySchema')) state.violations.push(violation(info.config, info.sourceFile, node.expression, SOURCE_LAYOUT_RULE_ID,
      'TypeORM EntitySchema cannot be owned by a feature; place schema under its declared persistence module.'));
    if (constructed.has(UNPROVEN_FRAMEWORK)) state.layoutReasons.push(`${info.relative} has a constructed provider identity beyond the bounded static trace`);
  }
}

function visitSourceNode(h: SourceShapeHelpers, info: SourceInfo, node: Node, state: ShapeState): void {
  inspectNodeDecorators(h, info, node, state);
  inspectEnumCalls(h, info, node, state);
  inspectConstructedSource(h, info, node, state);
  info.context.ts.forEachChild(node, child => visitSourceNode(h, info, child, state));
}

function inspectSourceFile(h: SourceShapeHelpers, config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, roots: ShapeRoots, state: ShapeState): void {
  const info = locateSource(h, config, context, sourceFile, roots, state);
  if (!info) return;
  reportSourceName(h, info, state);
  reportFeatureLayout(h, info, state);
  inspectClasses(h, info, state);
  inspectClassValues(h, info, state);
  inspectEnumsAndContracts(h, info, state);
  visitSourceNode(h, info, sourceFile, state);
}

function coverageFor(state: ShapeState): ShapeCoverage {
  for (const framework of state.frameworkByChecker.values()) {
    state.layoutReasons.push(...framework.reasons);
    state.namingReasons.push(...framework.reasons.filter(reason => reason.includes('@nestjs/graphql')));
  }
  if (state.checkedFiles === 0) {
    state.layoutReasons.push('the checked TypeScript program contains no configured backend feature or module source');
    state.namingReasons.push('the checked TypeScript program contains no configured backend feature or module source');
  }
  return {
    files: state.checkedFiles,
    layout: state.layoutReasons.length
      ? { status: 'unavailable', reason: 'one or more backend source placement relations are not statically proved', details: [...new Set(state.layoutReasons)].sort(byCodeUnit) }
      : { status: 'checked' },
    naming: state.namingReasons.length
      ? { status: 'unavailable', reason: 'one or more backend source naming relations are not statically proved', details: [...new Set(state.namingReasons)].sort(byCodeUnit) }
      : { status: 'checked' },
  };
}

/** Check the adopted domain-first backend source layout without inferring semantic ownership from folder names alone. */
export function createBackendSourceShapeChecker(helpers: SourceShapeHelpers): (config: ArchitectureConfig, context: TypeContext) => ShapeResult {
  const { absoluteRoots, canonical } = helpers;
  return function checkBackendSourceShape(config: ArchitectureConfig, context: TypeContext): ShapeResult {
    const featureRoots = absoluteRoots(config.root, config.backend.features);
    const moduleRoots = absoluteRoots(config.root, config.backend.modules);
    const localFiles = new Set(context.files.map(file => canonical(file.fileName)));
    const state: ShapeState = { frameworkByChecker: new Map(), violations: [], layoutReasons: [], namingReasons: [], checkedFiles: 0 };
    const roots: ShapeRoots = { featureRoots, moduleRoots, localFiles };
    for (const sourceFile of context.files) inspectSourceFile(helpers, config, context, sourceFile, roots, state);
    return { violations: state.violations, coverage: coverageFor(state) };
  };
}

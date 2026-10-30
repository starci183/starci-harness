import type { CallExpression, Expression, Node, PropertyAccessExpression, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, CheckInput, GraphFile } from './hfs-graph.mjs';
import type { MachineKit } from './machine-ast.mjs';
import { machineKit } from './machine-ast.mjs';

/**
 * R39 `error-masked` (BE_ERROR_MASKED). Every api app root provides exactly one `APP_FILTER`, its class declared in
 * platform/errors (the one ExceptionFilter that masks everything that is not a DomainError), and every GraphQL module
 * registration of the program passes the `formatError` platform/errors exports. Filters and format functions defined
 * anywhere else, a second filter, or a GraphQL registration without `formatError` leak internal errors to the client.
 */
export const ERROR_MASKED_RULE_IDS = ['BE_ERROR_MASKED'];

const RULE = 'BE_ERROR_MASKED';

/** Whether a node resolves to a declaration owned by platform/errors. */
type InErrors = (checker: TypeChecker, node: Node | null | undefined) => boolean;

const inErrorsOf = (kit: MachineKit) => (checker: TypeChecker, node: Node | null | undefined): boolean => kit.declarationsOf(checker, node).map(kit.ownerOfDeclaration).some(owner => owner?.tier === 'platform' && owner.name === 'errors');

function appFilterViolations(kit: MachineKit, inErrors: InErrors, app: { name: string }, root: GraphFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const filters = kit.providersOf(root, 'APP_FILTER', '@nestjs/core');
  const anchor = filters[0]?.node ?? root.sourceFile.statements[0] ?? root.sourceFile;
  if (filters.length !== 1) {
    violations.push({ ruleId: RULE, ...kit.at(root.rel, root.sourceFile, anchor), app: app.name,
      message: `App ${app.name} provides ${filters.length} APP_FILTER entries; an api app provides exactly one, the ExceptionFilter of platform/errors.` });
  }
  for (const filter of filters) {
    if (!filter.useClass || !inErrors(filter.checker, filter.useClass)) {
      violations.push({ ruleId: RULE, ...kit.at(root.rel, root.sourceFile, filter.node), app: app.name,
        message: 'The APP_FILTER must be `useClass` of the filter declared in platform/errors; any other filter can let an undeclared error reach the client unmasked.' });
    }
  }
  return violations;
}

const isGraphqlRegistration = (kit: MachineKit, checker: TypeChecker, node: Node): node is CallExpression => kit.ts.isCallExpression(node) && kit.ts.isPropertyAccessExpression(node.expression)
  && ['forRoot', 'forRootAsync'].includes(node.expression.name.text)
  && kit.isImportOf(checker, node.expression.expression, 'GraphQLModule', '@nestjs/graphql');

/**
 * The formatter a `formatError` value names: the value itself, or the callee of an arrow whose body only calls it (an arrow that
 * binds the errors service, `(formatted, error) => formatGraphqlError(errors, formatted, error)`).
 */
function formatterOf(ts: TypeScriptApi, value: Expression | null): Expression | null {
  if (value && ts.isArrowFunction(value) && ts.isCallExpression(value.body)) return value.body.expression;
  return value;
}

function passesMaskedFormatError(kit: MachineKit, inErrors: InErrors, checker: TypeChecker, call: CallExpression): boolean {
  const { ts } = kit;
  let masked = false;
  for (const argument of call.arguments) {
    kit.walk(argument, (inner: Node) => {
      if ((ts.isPropertyAssignment(inner) || ts.isShorthandPropertyAssignment(inner)) && kit.propertyNameText(inner.name) === 'formatError'
        && inErrors(checker, formatterOf(ts, kit.valueOfProperty(inner)))) masked = true;
    });
  }
  return masked;
}

export function checkErrorMasked(input: CheckInput) {
  const { config, graph } = input;
  const kit = machineKit(input);
  const violations: ArchitectureViolation[] = [];
  const inErrors = inErrorsOf(kit);
  let apps = 0;
  for (const app of config.apps.filter((item) => item.kind === 'api')) {
    const root = kit.appRoot(app.name);
    if (!root) continue;
    apps += 1;
    violations.push(...appFilterViolations(kit, inErrors, app, root));
  }
  let graphql = 0;
  for (const file of graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    kit.walk(file.sourceFile, (node: Node) => {
      if (!isGraphqlRegistration(kit, checker, node)) return;
      graphql += 1;
      if (!passesMaskedFormatError(kit, inErrors, checker, node)) {
        violations.push({ ruleId: RULE, ...kit.at(file.rel, file.sourceFile, node),
          message: `GraphQLModule.${(node.expression as PropertyAccessExpression).name.text} must pass the \`formatError\` exported by platform/errors; without it a resolver error reaches the client with its internal message.` });
      }
    });
  }
  return { violations, coverage: { status: 'checked', apps, graphqlRegistrations: graphql } };
}

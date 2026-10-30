import { sourceLocation } from '../../lib/ts-ast.mjs';
import type { ExpressionStatement, Node, SourceFile, Statement, StringLiteral } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, CheckInput, GraphFile } from './hfs-graph.mjs';

/** A leading string-literal expression statement of a body or file. */
type Directive = ExpressionStatement & { expression: StringLiteral };

interface ServerDirective {
  node: Directive;
  level: 'file' | 'function';
}

/**
 * The front end serves no API (owner ruling 2026-10-13, both editions, every app): it calls the back end through Apollo GraphQL and
 * axios in modules/api and never runs server code of its own.
 *
 *   - FE_SERVER_ACTION_FORBIDDEN: a `"use server"` directive anywhere in a front-end source file, in the file's directive prologue
 *     (a Server Action module) or in the prologue of any function body (an inline Server Action), apps and packages alike;
 *   - FE_ROUTE_HANDLER_FORBIDDEN: a route handler (`route.ts`, `route.js` and their module variants) under `apps/<app>/src/app/` other than the
 *     liveness probe `health/live/route.ts`.
 *
 * The check is provider-independent: it runs for every front-end repository.
 */
export const SERVER_ACTION_RULE_IDS = Object.freeze(['FE_SERVER_ACTION_FORBIDDEN', 'FE_ROUTE_HANDLER_FORBIDDEN']);

const SERVER_ACTION = 'FE_SERVER_ACTION_FORBIDDEN';
const ROUTE_HANDLER = 'FE_ROUTE_HANDLER_FORBIDDEN';
const ROUTE_FILE = /^apps\/([^/]+)\/src\/app\/(?:.+\/)?route\.[cm]?[jt]s$/u;

const isDirective = (ts: TypeScriptApi, statement: Statement): statement is Directive => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);

/** The statement nodes of a directive prologue: the leading string-literal expression statements. */
function prologue(ts: TypeScriptApi, statements: readonly Statement[] | undefined): Directive[] {
  const directives: Directive[] = [];
  for (const statement of statements ?? []) {
    if (!isDirective(ts, statement)) break;
    directives.push(statement);
  }
  return directives;
}

const useServerIn = (ts: TypeScriptApi, statements: readonly Statement[] | undefined): Directive | null => prologue(ts, statements).find(statement => statement.expression.text === 'use server') ?? null;

/** Every `"use server"` directive of one source file: the file-level one and each function-level one. */
function serverDirectives(ts: TypeScriptApi, sourceFile: SourceFile): ServerDirective[] {
  const found: ServerDirective[] = [];
  const fileLevel = useServerIn(ts, sourceFile.statements);
  if (fileLevel) found.push({ node: fileLevel, level: 'file' });
  const visit = (node: Node): void => {
    // a function with a block body: declaration, expression, arrow, method, constructor or accessor
    if (ts.isFunctionLike(node) && 'body' in node && node.body && ts.isBlock(node.body)) {
      const inline = useServerIn(ts, node.body.statements);
      if (inline) found.push({ node: inline, level: 'function' });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function serverActionViolations(ts: TypeScriptApi, file: GraphFile): ArchitectureViolation[] {
  return serverDirectives(ts, file.sourceFile).map(({ node, level }) => ({
    ruleId: SERVER_ACTION, path: file.rel, ...sourceLocation(file.sourceFile, node), level,
    message: `${file.rel} declares a ${level}-level "use server" directive: the front end runs no Server Action. Call the back end through a modules/api GraphQL operation (or a rest call) from an SWR hook, and move the server work into a be feature.`,
  }));
}

function routeHandlerViolation(file: GraphFile): ArchitectureViolation | null {
  const match = ROUTE_FILE.exec(file.rel);
  if (!match) return null;
  if (file.rel === `apps/${match[1]}/src/app/health/live/route.ts`) return null;
  return {
    ruleId: ROUTE_HANDLER, path: file.rel, line: 1, column: 1,
    message: `${file.rel} is a front-end route handler outside health/live/route.ts: the front end serves no API. Webhooks, cron, public APIs and third-party callbacks belong to be features; the browser reaches the back end through modules/api.`,
  };
}

/** The FE machine check of both bans over every source file of the front-end program. */
export function checkServerActions({ graph, context }: Pick<CheckInput, 'graph' | 'context'>) {
  const ts = context.ts;
  const violations: ArchitectureViolation[] = [];
  let routes = 0;
  for (const file of graph.files.values()) {
    violations.push(...serverActionViolations(ts, file));
    const route = routeHandlerViolation(file);
    if (ROUTE_FILE.test(file.rel)) routes += 1;
    if (route) violations.push(route);
  }
  return { violations, coverage: { status: 'checked', files: graph.files.size, routes } };
}

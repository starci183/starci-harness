// TypeScript queue constants and event-bus topic queue constants for migration parity (R258).
import pg from 'libpg-query';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { sqlParser } from '../../lib/sql-ast.mjs';
import { found, readText } from './read.mjs';
import { DB_PGMQ_DECLARED } from './database-constants.mjs';
import type { Parsed, Ts } from './rule-types.mjs';

await pg.loadModule();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = /^(?:be\/)?src\/modules\/queues\/.*\.ts$/;
const TOPIC_FILE = /^(?:be\/)?src\/modules\/platform\/event-bus\/.*\.ts$/;
const SOURCE_FILE = /^(?:be\/)?(?:src|apps)\/.*\.[cm]?[jt]s$/;
const TEST_FILE = /(?:\.(?:spec|test)|-spec)\.[cm]?[jt]s$|\/(?:tests|__tests__)\//;
const sqlTree = sqlParser(pg);

export function queueProblem(state: Parsed, code: string, file: string, message: string) {
  state.findings.push(found(code, file, `${file}: ${message}`));
}

export function sourceValue(ts: Ts, node: Parsed) {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

export function queueSourceFacts(state: Parsed, files: string[], inspectSql: Parsed) {
  const ts = loadTypescript(state.repoRoot, HERE);
  if (!ts) {
    if (files.some((file: string) => QUEUE_FILE.test(file) || TOPIC_FILE.test(file))) queueProblem(state, DB_PGMQ_DECLARED, 'hfs.json', 'queue declarations require the TypeScript parser');
    return;
  }
  for (const file of files.filter((item: Parsed) => SOURCE_FILE.test(item) && !TEST_FILE.test(item))) {
    const text = readText(state.repoRoot, file);
    if (text === null) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (QUEUE_FILE.test(file)) addLiteralConstants(state, state.constants, ts, source, file, /(?:^QUEUE$|_QUEUE(?:_NAME)?$|^QUEUE_)/, 'queue names');
    if (TOPIC_FILE.test(file)) addLiteralConstants(state, state.topics, ts, source, file, /_TOPIC_QUEUE$/, 'event-bus topic queue names');
    addSourceSql(state, ts, source, file, inspectSql);
  }
}

function addLiteralConstants(state: Parsed, into: Parsed, ts: Ts, source: Parsed, file: string, name: RegExp, what: string) {
  const visit = (node: Parsed) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && name.test(node.name.text)) {
      const value = sourceValue(ts, node.initializer);
      if (value && ts.isStringLiteralLike(value)) into.set(value.text, file);
      else queueProblem(state, DB_PGMQ_DECLARED, file, `${what} must be literal constants so the migrations can be checked against them`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function templateSql(ts: Ts, node: Parsed) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span: Parsed) => `NULL${span.literal.text}`).join('');
}

function addSourceSql(state: Parsed, ts: Ts, source: Parsed, file: string, inspectSql: Parsed) {
  const visit = (node: Parsed) => {
    let text = null;
    if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql$/.test(node.tag.getText(source))) text = templateSql(ts, node.template);
    if (ts.isCallExpression(node) && /(?:^|\.)(?:query|execute)$/.test(node.expression.getText(source)) && node.arguments[0]) text = templateSql(ts, node.arguments[0]);
    if (text !== null) inspectSql(state, sqlTree(text), file, false);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

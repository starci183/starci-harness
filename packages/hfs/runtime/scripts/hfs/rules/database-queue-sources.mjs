// TypeScript queue constants and event-bus topic queue constants for migration parity (R258).
import pg from 'libpg-query';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { sqlParser } from '../../lib/sql-ast.mjs';
import { found, readText } from './read.mjs';
import { DB_PGMQ_DECLARED } from './database-constants.mjs';

await pg.loadModule();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = /^(?:be\/)?src\/modules\/queues\/.*\.ts$/;
const TOPIC_FILE = /^(?:be\/)?src\/modules\/platform\/event-bus\/.*\.ts$/;
const SOURCE_FILE = /^(?:be\/)?(?:src|apps)\/.*\.[cm]?[jt]s$/;
const TEST_FILE = /(?:\.(?:spec|test)|-spec)\.[cm]?[jt]s$|\/(?:tests|__tests__)\//;
const sqlTree = sqlParser(pg);

export function queueProblem(state, code, file, message) {
  state.findings.push(found(code, file, `${file}: ${message}`));
}

export function sourceValue(ts, node) {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

export function queueSourceFacts(state, files, inspectSql) {
  const ts = loadTypescript(state.repoRoot, HERE);
  if (!ts) {
    if (files.some((file) => QUEUE_FILE.test(file) || TOPIC_FILE.test(file))) queueProblem(state, DB_PGMQ_DECLARED, 'hfs.json', 'queue declarations require the TypeScript parser');
    return;
  }
  for (const file of files.filter((item) => SOURCE_FILE.test(item) && !TEST_FILE.test(item))) {
    const text = readText(state.repoRoot, file);
    if (text === null) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (QUEUE_FILE.test(file)) addLiteralConstants(state, state.constants, ts, source, file, /(?:^QUEUE$|_QUEUE(?:_NAME)?$|^QUEUE_)/, 'queue names');
    if (TOPIC_FILE.test(file)) addLiteralConstants(state, state.topics, ts, source, file, /_TOPIC_QUEUE$/, 'event-bus topic queue names');
    addSourceSql(state, ts, source, file, inspectSql);
  }
}

function addLiteralConstants(state, into, ts, source, file, name, what) {
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && name.test(node.name.text)) {
      const value = sourceValue(ts, node.initializer);
      if (value && ts.isStringLiteralLike(value)) into.set(value.text, file);
      else queueProblem(state, DB_PGMQ_DECLARED, file, `${what} must be literal constants so the migrations can be checked against them`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function templateSql(ts, node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) => `NULL${span.literal.text}`).join('');
}

function addSourceSql(state, ts, source, file, inspectSql) {
  const visit = (node) => {
    let text = null;
    if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql$/.test(node.tag.getText(source))) text = templateSql(ts, node.template);
    if (ts.isCallExpression(node) && /(?:^|\.)(?:query|execute)$/.test(node.expression.getText(source)) && node.arguments[0]) text = templateSql(ts, node.arguments[0]);
    if (text !== null) inspectSql(state, sqlTree(text), file, false);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// R213 DB_MIGRATION_SHAPE, transaction control: `starci app db migrate` and the squash replay apply each migration in ONE transaction
// together with its history row (db/postgres.mjs psqlTransaction, `psql -1`), so a migration never opens, ends or splits a transaction.
// Top-level BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE and PREPARE TRANSACTION are findings, and so is a
// COMMIT or ROLLBACK statement inside a DO block; a function or procedure body (dollar-quoted or not) is never judged.
import { found } from './read.mjs';
import { databaseSqlTokens } from './database-migrations.mjs';
import { DB_MIGRATION_SHAPE } from './database-constants.mjs';

const CONTROL_IN_DO = new Set(['commit', 'rollback']);
// PL/pgSQL words after which a statement starts.
const STATEMENT_OPENERS = new Set(['begin', 'then', 'else', 'loop']);

/** The line of the first token of the statement starting at byte `location` (leading blanks and comments skipped). */
function statementLine(text, location, lineAt) {
  const rest = Buffer.from(text, 'utf8').subarray(Math.max(location, 0), Math.max(location, 0) + 4096).toString('utf8');
  const first = databaseSqlTokens(rest)[0];
  return lineAt(Math.max(location, 0)) + (first ? first.line - 1 : 0);
}

const doBody = (node) => (node.args ?? []).find((item) => item.DefElem?.defname === 'as')?.DefElem?.arg?.String?.sval ?? '';

/** Transaction control a migration must not carry, one finding per statement with its file:line. */
export function transactionControlFindings(file, text, stmts, lineAt) {
  const findings = [];
  for (const entry of stmts ?? []) {
    const line = () => statementLine(text, entry.stmt_location ?? 0, lineAt);
    if (entry.stmt?.TransactionStmt) {
      const kind = String(entry.stmt.TransactionStmt.kind ?? '').replace(/^TRANS_STMT_/, '').toLowerCase().replaceAll('_', ' ');
      const at = line();
      findings.push(found(DB_MIGRATION_SHAPE, file, `${file}:${at} carries transaction control (${kind}); a migration is applied in one transaction with its history row, so it never begins, commits, rolls back or sets a savepoint`, { line: at }));
      continue;
    }
    if (!entry.stmt?.DoStmt) continue;
    const body = doBody(entry.stmt.DoStmt);
    const tokens = databaseSqlTokens(body);
    tokens.forEach((token, index) => {
      const before = tokens[index - 1];
      const leads = !before || before.v === ';' || (before.t === 'word' && STATEMENT_OPENERS.has(before.v));
      if (token.t !== 'word' || !CONTROL_IN_DO.has(token.v) || !leads) return;
      const inner = line() + token.line - 1;
      findings.push(found(DB_MIGRATION_SHAPE, file, `${file}:${inner} carries transaction control (${token.v} inside a DO block); a migration is applied in one transaction with its history row`, { line: inner }));
    });
  }
  return findings;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addLiteWebhookInbox } from '../scaffold/add-inbox-lite.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { parseSql } from '../runtime/scripts/hfs/sql/pg-parse.mjs';

const write = (root, relative, text) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('the lite inbox scaffold installs client replay declarations and migrates its one shared inbox', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-client-inbox-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'hfs.json', JSON.stringify({ kind: 'app', edition: 'lite', sides: { be: { patterns: [] } } }));
  write(root, 'be/src/modules/domain/calendars/calendars.service.ts', 'export class CalendarsService {}\n');
  write(root, 'be/src/modules/platform/database/index.ts', 'export { DatabaseError, DatabaseErrorCode } from "./errors/database.error"\n');
  write(root, 'be/src/modules/platform/database/errors/database.error.ts', fs.readFileSync(path.join(
    TEMPLATES_DIR, 'be/skeleton-lite/src/modules/platform/database/errors/database.error.ts',
  ), 'utf8'));

  const created = addLiteWebhookInbox({
    root, repo: { edition: 'lite' }, noun: 'webhook', provider: 'calendar',
    values: { service: 'CalendarsService', serviceModule: '@modules/domain/calendars' },
    now: () => Date.UTC(2026, 9, 24, 11),
  });

  for (const relative of [
    'be/src/modules/platform/inbox/client-operation.policy.ts',
    'be/src/modules/platform/inbox/request-fingerprint.policy.ts',
    'be/src/modules/platform/idempotency/index.ts',
    'be/src/modules/platform/idempotency/errors/idempotency.error.ts',
    'be/src/modules/platform/idempotency/messages/idempotency.messages.ts',
  ]) assert.ok(created.includes(relative) && fs.existsSync(path.join(root, relative)), relative);
  const inboxRoot = path.join(root, 'be/src/modules/platform/inbox');
  assert.doesNotMatch(fs.readFileSync(path.join(inboxRoot, 'index.ts'), 'utf8'), /\bEffectful\b/);
  assert.equal(fs.existsSync(path.join(inboxRoot, 'effectful.decorators.ts')), false, 'a delivery-only inbox does not adopt the client command pattern');
  const migration = created.find((relative) => relative.startsWith('db/migrations/'));
  const parsed = await parseSql(fs.readFileSync(path.join(root, migration), 'utf8'));
  const statements = parsed.stmts.map((statement) => statement.stmt);
  const tables = statements.map((statement) => statement.CreateStmt?.relation?.relname).filter(Boolean);
  assert.equal(tables.filter((table) => table === 'inbox').length, 1);
  const extension = statements.map((statement) => statement.AlterTableStmt).find((statement) =>
    statement?.relation?.relname === 'inbox' && statement.cmds.some((command) => command.AlterTableCmd?.subtype === 'AT_AddColumn'));
  assert.deepEqual(extension.cmds.map((command) => command.AlterTableCmd.def.ColumnDef.colname), ['request_fingerprint', 'outcome']);
  const policies = statements.map((statement) => statement.CreatePolicyStmt).filter((statement) => statement?.table?.relname === 'inbox');
  assert.deepEqual(policies.map((policy) => policy.cmd_name).sort(), ['delete', 'insert', 'select', 'update']);
});

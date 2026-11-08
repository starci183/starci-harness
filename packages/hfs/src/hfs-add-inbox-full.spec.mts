// hfs-add-inbox-full.spec.mts - the delivery inbox of a FULL app (scaffold/add-inbox-full.mts). R263 `webhook-inbox-key` asks a webhook
// intake to claim its delivery key on the `Inbox` port of platform/inbox first, and a full skeleton carries no inbox, so
// `starci app add webhook <name>` lays platform/inbox and platform/idempotency down (the files tree of the idempotency pattern topic),
// registers their entities, migrations, error kinds and messages in each app's compose/platform.ts and composes InboxModule once in the
// webhooks group; `starci app add inbox` does the same alone for an app that has its webhooks already. All or nothing, idempotent, lite untouched.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';

const SCAFFOLDED = Date.parse('2026-11-09T00:00:00Z');
const PLATFORM = 'be/src/modules/platform';
const API_PLATFORM = 'be/apps/core/src/compose/platform.ts';
const CLI_PLATFORM = 'be/apps/cli/src/compose/platform.ts';
const WEBHOOKS = 'be/apps/core/src/compose/webhooks.ts';
const SERVICE = 'NoteService=@modules/domain/note';
const lockedOk = (root: string) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true as const };
};

function scaffold(t: TestContext, edition: 'full' | 'lite' = 'full') {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-add-inbox-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({ name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init, now: () => new Date(SCAFFOLDED) }).root;
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const exists = (root: string, file: string) => fs.existsSync(path.join(root, ...file.split('/')));
const write = (root: string, file: string, text: string) => fs.writeFileSync(path.join(root, ...file.split('/')), text);
const files = (root: string): string[] => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.parentPath.includes('node_modules') && !entry.parentPath.includes(`${path.sep}.git`))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
const snapshot = (root: string) => Object.fromEntries(files(root).map((file) => [file, read(root, file)]));
const addWebhook = (root: string, name: string, offset = 60_000) => addKind({ repoRoot: root, noun: 'webhook', name, options: { service: SERVICE }, now: () => SCAFFOLDED + offset });
const addInbox = (root: string) => addKind({ repoRoot: root, noun: 'inbox', name: '' });

const INBOX_FILES = ['index.ts', 'inbox.port.ts', 'inbox.decorators.ts', 'inbox.module.ts', 'inbox.service.ts', 'persistence/connection.ts',
  'persistence/entities/inbox-claim.entity.ts', 'persistence/migrations/1789800005000-create-inbox-claims.ts', 'persistence/migrations/1792800000000-client-operation-outcomes.ts'];

test('full add webhook lays down platform/inbox and platform/idempotency, registers their catalogs and composes InboxModule once', (t) => {
  const root = scaffold(t);
  assert.equal(exists(root, `${PLATFORM}/inbox/index.ts`), false, 'the full skeleton carries no inbox');

  const result = addWebhook(root, 'acme');

  for (const file of INBOX_FILES) assert.ok(result.created.includes(`${PLATFORM}/inbox/${file}`) && exists(root, `${PLATFORM}/inbox/${file}`), file);
  for (const file of ['index.ts', 'errors/idempotency.error.ts', 'messages/idempotency.messages.ts']) assert.ok(exists(root, `${PLATFORM}/idempotency/${file}`), file);
  assert.equal(exists(root, `${PLATFORM}/event-bus/index.ts`), false, 'the full webhook door publishes through the outbox: no event bus is added');
  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.patterns, ['webhooks'], 'the inbox is a platform capability, not a declared pattern');

  const barrel = read(root, `${PLATFORM}/inbox/index.ts`);
  assert.match(barrel, /export \{ inboxEntities, inboxMigrations \} from "\.\/persistence\/connection"/);
  assert.match(barrel, /export \{ INBOX, InjectInbox \} from "\.\/inbox\.decorators"/);
  assert.match(barrel, /export type \{ Inbox \} from "\.\/inbox\.port"/);

  // The api app: catalogs in its database connection, error kinds and messages, then the module in the webhooks group.
  const platform = read(root, API_PLATFORM);
  assert.match(platform, /import \{ IDEMPOTENCY_ERROR_KINDS, IDEMPOTENCY_MESSAGES \} from "@modules\/platform\/idempotency"/);
  assert.match(platform, /import \{ INBOX_ERROR_KINDS, INBOX_MESSAGES, inboxEntities, inboxMigrations \} from "@modules\/platform\/inbox"/);
  assert.match(platform, /entities: \[\.\.\.httpSecurityEntities, \.\.\.inboxEntities, \.\.\.noteEntities\]/);
  assert.match(platform, /migrations: \[\.\.\.httpSecurityMigrations, \.\.\.inboxMigrations, \.\.\.noteMigrations\]/);
  // The i18n bundles outgrow the print width, so the list is written one bundle per line.
  assert.match(platform, /bundles: \[\n {12}HTTP_MESSAGES,\n {12}ERRORS_MESSAGES,\n {12}HTTP_SECURITY_MESSAGES,\n {12}INBOX_MESSAGES,\n {12}IDEMPOTENCY_MESSAGES,\n {12}IDENTITY_MESSAGES,\n {8}\],/);
  assert.ok(platform.split('\n').every((line) => line.length <= 120), 'no line passes the print width');
  assert.match(platform, /^ {12}HTTP_SECURITY_ERROR_KINDS,\n {12}INBOX_ERROR_KINDS,\n {12}IDEMPOTENCY_ERROR_KINDS,\n/m);
  // The cli app runs the migrations: it carries the same entities and migrations.
  const cli = read(root, CLI_PLATFORM);
  assert.match(cli, /entities: \[\.\.\.httpSecurityEntities, \.\.\.inboxEntities, \.\.\.noteEntities\]/);
  assert.match(cli, /migrations: \[\.\.\.httpSecurityMigrations, \.\.\.inboxMigrations, \.\.\.noteMigrations\]/);
  assert.match(cli, /import \{ inboxEntities, inboxMigrations \} from "@modules\/platform\/inbox"/);
  assert.doesNotMatch(cli, /INBOX_ERROR_KINDS|IDEMPOTENCY/, 'the cli app has no errors or i18n module to register them in');

  const group = read(root, WEBHOOKS);
  assert.equal(group.match(/InboxModule\.register\(\{ isGlobal: true, connection: PRIMARY_ENTITY_MANAGER \}\)/g)?.length, 1);
  assert.match(group, /import \{ InboxModule \} from "@modules\/platform\/inbox"/);
  assert.match(group, /import \{ PRIMARY_ENTITY_MANAGER \} from "@modules\/platform\/database"/);
  assert.match(group, /AcmeHttpModule/);
  assert.ok(result.created.includes(API_PLATFORM) && result.created.includes(CLI_PLATFORM));
});

test('the scaffolded Inbox has the shape R263 webhook-inbox-key resolves: Inbox of platform/inbox, claim(source, eventId, tx)', (t) => {
  const root = scaffold(t);
  addWebhook(root, 'acme');
  // The rule owns the type by capability and tier (modules/platform/inbox/...) and name (Inbox); packages/eslint-canon-be/src/webhook-handoff-inbox.spec.ts
  // proves the verdict on exactly this origin (@modules/platform/inbox/inbox.port) in a full app.
  const port = read(root, `${PLATFORM}/inbox/inbox.port.ts`);
  assert.match(port, /export interface Inbox \{/);
  assert.match(port, /claim\(source: string, eventId: string, tx\?: EntityManager\): Promise<boolean>/);
  assert.match(read(root, `${PLATFORM}/inbox/inbox.decorators.ts`), /export const InjectInbox = \(\): TypedParameterDecorator<Inbox>/);
  assert.match(read(root, `${PLATFORM}/inbox/inbox.module.ts`), /inject: \[options\.connection\]/);
});

test('a second add webhook and add inbox change nothing: no overwrite, compose entries once', (t) => {
  const root = scaffold(t);
  addWebhook(root, 'acme');
  const afterFirst = snapshot(root);

  const again = addInbox(root);
  assert.deepEqual(again, { created: [], registered: { patterns: [], kinds: [] } });
  assert.deepEqual(snapshot(root), afterFirst);

  addWebhook(root, 'beta', 120_000);
  const second = snapshot(root);
  for (const file of INBOX_FILES) assert.equal(second[`${PLATFORM}/inbox/${file}`], afterFirst[`${PLATFORM}/inbox/${file}`]);
  assert.equal(second[API_PLATFORM], afterFirst[API_PLATFORM]);
  assert.equal(second[CLI_PLATFORM], afterFirst[CLI_PLATFORM]);
  assert.equal(second[WEBHOOKS]!.match(/InboxModule\.register\(/g)?.length, 1);
  assert.match(second[WEBHOOKS]!, /BetaHttpModule/);
});

test('add inbox alone adds the capability to an app that already has its webhook', (t) => {
  const root = scaffold(t);
  addWebhook(root, 'acme');
  // The app as it was before the verb carried the inbox: strip what the first add wrote for it.
  fs.rmSync(path.join(root, ...`${PLATFORM}/inbox`.split('/')), { recursive: true });
  fs.rmSync(path.join(root, ...`${PLATFORM}/idempotency`.split('/')), { recursive: true });
  const strip = (file: string) => write(root, file, read(root, file)
    .replace(/^import \{ (?:IDEMPOTENCY|INBOX|inbox)[^\n]*\n/gm, '').replace(/^import \{ InboxModule \}[^\n]*\n/m, '').replace(/^import \{ PRIMARY_ENTITY_MANAGER \}[^\n]*\n/m, '')
    .replace(/, \.\.\.inbox(?:Entities|Migrations)/g, '').replace(/ {12}INBOX_MESSAGES,\n {12}IDEMPOTENCY_MESSAGES,\n/, '')
    .replace(/ {12}INBOX_ERROR_KINDS,\n {12}IDEMPOTENCY_ERROR_KINDS,\n/, '').replace(/ {4}InboxModule\.register\([^\n]*\n/, ''));
  for (const file of [API_PLATFORM, CLI_PLATFORM, WEBHOOKS]) strip(file);
  assert.doesNotMatch(read(root, WEBHOOKS), /InboxModule/);
  assert.match(read(root, WEBHOOKS), /AcmeHttpModule/);

  const result = addInbox(root);

  for (const file of INBOX_FILES) assert.ok(result.created.includes(`${PLATFORM}/inbox/${file}`), file);
  assert.deepEqual(result.registered, { patterns: [], kinds: [] });
  assert.match(read(root, API_PLATFORM), /entities: \[\.\.\.httpSecurityEntities, \.\.\.inboxEntities, \.\.\.noteEntities\]/);
  assert.match(read(root, API_PLATFORM), /INBOX_MESSAGES,\n {12}IDEMPOTENCY_MESSAGES,/);
  assert.match(read(root, CLI_PLATFORM), /migrations: \[\.\.\.httpSecurityMigrations, \.\.\.inboxMigrations, \.\.\.noteMigrations\]/);
  assert.equal(read(root, WEBHOOKS).match(/InboxModule\.register\(/g)?.length, 1);
  assert.match(read(root, WEBHOOKS), /AcmeHttpModule/);
  assert.deepEqual(addInbox(root).created, [], 'a second run is a no-op');
});

test('a composition file add cannot extend refuses before anything is written', (t) => {
  const root = scaffold(t);
  const platform = read(root, API_PLATFORM).replaceAll('httpSecurityEntities', 'securityEntities');
  write(root, API_PLATFORM, platform);
  const before = snapshot(root);

  assert.throws(() => addWebhook(root, 'acme'), /compose\/platform\.ts, which has no \.\.\.httpSecurityEntities to follow/);
  assert.deepEqual(snapshot(root), before, 'nothing was written, the webhook included');
  assert.throws(() => addInbox(root), /which has no \.\.\.httpSecurityEntities to follow/);
  assert.deepEqual(snapshot(root), before);
});

test('a lite app keeps its own inbox: add inbox is refused there and add webhook is unchanged', (t) => {
  const root = scaffold(t, 'lite');
  assert.throws(() => addInbox(root), /add inbox: full edition only/);
  fs.mkdirSync(path.join(root, 'be/src/modules/domain/calendars'), { recursive: true });
  write(root, 'be/src/modules/domain/calendars/calendars.service.ts', 'export class CalendarsService {}\n');
  const result = addKind({ repoRoot: root, noun: 'webhook', name: 'acme', options: { service: 'CalendarsService=@modules/domain/calendars' }, now: () => SCAFFOLDED + 60_000 });
  assert.ok(result.created.some((file) => file.startsWith('be/src/modules/platform/inbox/')));
  assert.equal(exists(root, `${PLATFORM}/inbox/persistence/connection.ts`), false, 'lite has no TypeORM inbox adapter');
  assert.equal(exists(root, `${PLATFORM}/event-bus/index.ts`), true);
});

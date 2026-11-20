// proves: DB_ADOPT_SCHEMA_DIFFERS@lite
// `db adopt` leaves out of its schema compare the objects the harness owns and the legacy history tables the app declares (database.adopt.legacyHistory), with their sequence, default, constraints and indexes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { belongingTo } from '../db/adopt.mjs';
import { loadDatabase } from '../db/migrate.mjs';
import { dumpEntries } from '../runtime/scripts/hfs/db-squash.mjs';
import { SEED_RECEIPTS } from '../stack/seeds.mjs';

const entry = (name: string, type: string, body = '') => `--\n-- Name: ${name}; Type: ${type}; Schema: public; Owner: -\n--\n\n${body}\n\n`;
const DUMP = [
  entry('users', 'TABLE', 'CREATE TABLE public.users (id uuid NOT NULL);'),
  entry('starci_seed_receipts', 'TABLE', 'CREATE TABLE public.starci_seed_receipts (scope text);'),
  entry('starci_seed_receipts starci_seed_receipts_pkey', 'CONSTRAINT', 'ALTER TABLE ONLY public.starci_seed_receipts ADD CONSTRAINT starci_seed_receipts_pkey PRIMARY KEY (scope);'),
  entry('primary_migrations', 'TABLE', 'CREATE TABLE public.primary_migrations (id integer NOT NULL);'),
  entry('primary_migrations_id_seq', 'SEQUENCE', 'CREATE SEQUENCE public.primary_migrations_id_seq;'),
  entry('primary_migrations_id_seq', 'SEQUENCE OWNED BY', 'ALTER SEQUENCE public.primary_migrations_id_seq OWNED BY public.primary_migrations.id;'),
  entry('primary_migrations id', 'DEFAULT', "ALTER TABLE ONLY public.primary_migrations ALTER COLUMN id SET DEFAULT nextval('public.primary_migrations_id_seq'::regclass);"),
  entry('primary_migrations primary_migrations_pkey', 'CONSTRAINT', 'ALTER TABLE ONLY public.primary_migrations ADD CONSTRAINT primary_migrations_pkey PRIMARY KEY (id);'),
  entry('users_email_idx', 'INDEX', 'CREATE INDEX users_email_idx ON public.users USING btree (id);'),
].join('');
const names = (picked: Set<{ name: string; type: string }>) => [...picked].map((item) => `${item.type}:${item.name}`).sort();

test('the harness-owned receipts table and a declared legacy history table leave the compare with everything that depends on them; an undeclared table stays', () => {
  const entries = dumpEntries(DUMP).entries;
  assert.deepEqual(names(belongingTo(entries, [SEED_RECEIPTS])), ['CONSTRAINT:starci_seed_receipts starci_seed_receipts_pkey', 'TABLE:starci_seed_receipts']);
  assert.deepEqual(names(belongingTo(entries, ['primary_migrations'])), ['CONSTRAINT:primary_migrations primary_migrations_pkey', 'DEFAULT:primary_migrations id', 'SEQUENCE OWNED BY:primary_migrations_id_seq', 'SEQUENCE:primary_migrations_id_seq', 'TABLE:primary_migrations']);
  assert.deepEqual(names(belongingTo(entries, [])), []);
  assert.equal([...belongingTo(entries, ['users'])].some((item) => item.name === 'users_email_idx'), true, 'an index of a left-out table goes with it');
});

test('database.adopt.legacyHistory is a list of table names; anything else is refused', () => {
  const app = (database: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-adopt-'));
    fs.mkdirSync(path.join(root, '.starcistacks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), `database:\n${database}`);
    fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'proof', sides: {} }));
    return root;
  };
  assert.deepEqual(loadDatabase(app('  baseline: baseline\n  adopt:\n    legacyHistory: [primary_migrations, public.typeorm_metadata]\n')).adopt.legacyHistory, ['primary_migrations', 'public.typeorm_metadata']);
  assert.deepEqual(loadDatabase(app('  baseline: baseline\n')).adopt.legacyHistory, []);
  assert.throws(() => loadDatabase(app('  adopt:\n    legacyHistory: ["drop table x"]\n')), /adopt/u);
  assert.throws(() => loadDatabase(app('  adopt:\n    other: 1\n')), /adopt/u);
});

// migration-stamp.spec.mts - the stamp of a new migration is the clock's second, strictly later than the latest migration:
// two migrations written within one second (an app scaffold followed at once by `add table`) take consecutive seconds,
// and a clock that is really behind is refused (HFS_ADD_MIGRATION_ORDER).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextMigrationStamp } from '../scaffold/migration-stamp.mjs';
import { ScaffoldError } from '../scaffold/service.mjs';

const at = (iso: string) => () => Date.parse(iso);

test('with no migration, or an older one, the stamp is the clock second', () => {
  assert.equal(nextMigrationStamp(at('2026-10-30T18:50:57.900Z'), undefined), '20261030185057');
  assert.equal(nextMigrationStamp(at('2026-10-30T18:50:57.000Z'), '20260101000000'), '20261030185057');
});

test('the same second as the latest migration moves to the next second', () => {
  assert.equal(nextMigrationStamp(at('2026-10-30T18:50:57.400Z'), '20261030185057'), '20261030185058');
});

test('a latest a few seconds ahead of the clock still yields the second after it, across a minute edge', () => {
  assert.equal(nextMigrationStamp(at('2026-10-30T18:50:57.000Z'), '20261030185059'), '20261030185100');
});

test('a clock that is really behind the latest migration is refused', () => {
  assert.throws(
    () => nextMigrationStamp(at('2026-10-30T18:50:57.000Z'), '20261030185200'),
    (error: unknown) => error instanceof ScaffoldError && error.code === 'HFS_ADD_MIGRATION_ORDER',
  );
  assert.throws(() => nextMigrationStamp(at('2026-10-30T18:50:57.000Z'), 'not-a-stamp-1234'), /not later than/u);
});

test('two migrations written within one second get distinct, ordered stamps', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-stamp-'));
  try {
    const clock = at('2026-10-30T18:50:57.500Z');
    const first = nextMigrationStamp(clock, undefined);
    fs.writeFileSync(path.join(folder, `${first}_a.sql`), '');
    const second = nextMigrationStamp(clock, fs.readdirSync(folder).sort().at(-1)?.slice(0, 14));
    assert.ok(second > first);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

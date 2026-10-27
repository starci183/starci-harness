import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbRestampMain } from '../runtime/scripts/hfs/db-restamp-verb.mjs';
import { MIGRATIONS_DIR, MIGRATIONS_ARCHIVE_DIR } from '../runtime/scripts/hfs/rules/database-constants.mjs';

const made = [];
const first = '20260101000000';
const second = '20260102000000';
const next = '20260104000000';
const last = '20260105000000';
const start = `${MIGRATIONS_DIR}/${first}_start.sql`;
const follow = `${MIGRATIONS_DIR}/${second}_follow.sql`;
const unchanged = `${MIGRATIONS_DIR}/20260106000000_unchanged.sql`;
const archives = {
  [`${MIGRATIONS_ARCHIVE_DIR}/legacy-schema.sql`]: 'create table public.legacy(id integer);\r\n',
  [`${MIGRATIONS_ARCHIVE_DIR}/old setup.sql`]: 'select 1;\n',
  [`${MIGRATIONS_ARCHIVE_DIR}/20260230000000_invalid.sql`]: 'select 3;\n',
  [`${MIGRATIONS_ARCHIVE_DIR}/${next}_retired.sql`]: 'select 4;\n',
};

test.after(() => {
  for (const root of made) {
    assert.ok(path.basename(root).startsWith('hfs-db-restamp-active-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(edition, contents, map) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-restamp-active-'));
  made.push(root);
  const files = { 'hfs.json': JSON.stringify({ kind: 'app', edition }), 'restamp.yaml': map, ...archives, ...contents };
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

function io(root) {
  const out = [];
  const err = [];
  const calls = [];
  return { out, err, calls, ports: {
    cwd: root,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    runSupabase: (cwd, args) => {
      assert.equal(cwd, root);
      calls.push(args);
      return { status: 0, stdout: '' };
    },
  } };
}

function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter((file) => fs.statSync(path.join(root, file)).isFile()).sort()
    .map((file) => [file.replaceAll('\\', '/'), fs.readFileSync(path.join(root, file))]));
}

for (const edition of ['lite', 'full']) {
  test(`app db restamp ${edition}: legacy archives stay untouched while only mapped active migrations preview and apply`, () => {
    const active = { [start]: 'select 10;\n', [follow]: 'select 20;\n', [unchanged]: 'select 30;\n' };
    const root = fixture(edition, active, `"${first}": "${next}"\n"${second}": "${last}"\n`);
    const before = snapshot(root);
    const archived = snapshot(path.join(root, MIGRATIONS_ARCHIVE_DIR));
    const preview = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml'], preview.ports), 0, preview.err.join(''));
    assert.deepEqual(preview.err, []);
    assert.deepEqual(preview.calls, []);
    assert.deepEqual(preview.out.slice(0, 3), [
      'preview restamp 2 migrations\n',
      `${start} -> ${MIGRATIONS_DIR}/${next}_start.sql\n`,
      `${follow} -> ${MIGRATIONS_DIR}/${last}_follow.sql\n`,
    ]);
    assert.equal(preview.out.filter((line) => line.includes(' -> ')).length, 2);
    assert.deepEqual(snapshot(root), before);

    const apply = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--apply'], apply.ports), 0, apply.err.join(''));
    assert.deepEqual(apply.calls, [
      ['migration', 'repair', first, '--status', 'reverted', '--linked'],
      ['migration', 'repair', next, '--status', 'applied', '--linked'],
      ['migration', 'repair', second, '--status', 'reverted', '--linked'],
      ['migration', 'repair', last, '--status', 'applied', '--linked'],
    ]);
    const expected = { ...before };
    delete expected[start];
    delete expected[follow];
    expected[`${MIGRATIONS_DIR}/${next}_start.sql`] = Buffer.from(`-- starci:restamp ${first} ${next}\n${active[start]}`);
    expected[`${MIGRATIONS_DIR}/${last}_follow.sql`] = Buffer.from(`-- starci:restamp ${second} ${last}\n${active[follow]}`);
    assert.deepEqual(snapshot(root), expected);
    assert.deepEqual(snapshot(path.join(root, MIGRATIONS_ARCHIVE_DIR)), archived);
  });

  test(`app db restamp ${edition}: archived versions do not reserve the next free active version`, () => {
    const keep = `${MIGRATIONS_DIR}/${first}_alpha.sql`;
    const move = `${MIGRATIONS_DIR}/${first}_beta.sql`;
    const free = '20260101000001';
    const root = fixture(edition, {
      [keep]: 'select 10;\n', [move]: 'select 20;\n',
      [`${MIGRATIONS_ARCHIVE_DIR}/${free}_retired.sql`]: 'select 30;\n',
    }, `"${first}":\n  file: beta\n  applied: false\n`);
    const archived = snapshot(path.join(root, MIGRATIONS_ARCHIVE_DIR));
    const apply = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--apply'], apply.ports), 0, apply.err.join(''));
    assert.deepEqual(apply.calls, []);
    assert.deepEqual(apply.out, ['apply restamp 1 migrations\n', `${move} -> ${MIGRATIONS_DIR}/${free}_beta.sql\n`]);
    assert.equal(fs.existsSync(path.join(root, move)), false);
    assert.equal(fs.readFileSync(path.join(root, MIGRATIONS_DIR, `${free}_beta.sql`), 'utf8'), `-- starci:restamp ${first} ${free}\nselect 20;\n`);
    assert.equal(fs.readFileSync(path.join(root, keep), 'utf8'), 'select 10;\n');
    assert.deepEqual(snapshot(path.join(root, MIGRATIONS_ARCHIVE_DIR)), archived);
  });

  test(`app db restamp ${edition}: missing or invalid active stamps and malformed active names still refuse before effects`, () => {
    for (const name of ['legacy-name.sql', '20260230000000_invalid.sql', `${second}_bad_name.sql`]) {
      const root = fixture(edition, { [start]: 'select 10;\n', [`${MIGRATIONS_DIR}/${name}`]: 'select 20;\n' }, `"${first}": "${next}"\n`);
      const before = snapshot(root);
      for (const flags of [[], ['--apply']]) {
        const refused = io(root);
        assert.equal(dbRestampMain(['--map', 'restamp.yaml', ...flags], refused.ports), 2, name);
        assert.match(refused.err.join(''), /migration filenames must carry valid UTC stamps/);
        assert.deepEqual(refused.out, []);
        assert.deepEqual(refused.calls, []);
        assert.deepEqual(snapshot(root), before);
      }
    }
  });
}

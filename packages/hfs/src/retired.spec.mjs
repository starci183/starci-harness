// The retired-spelling rewrite of `starci app` (retired.mts), on rows of its own: a renamed verb path, an added flag, a renamed
// and a dropped flag, a value-scoped flag, a positional operand turned into a flag, a removed verb, the switch, and main's
// notice and refusal. The rows of each area are proven by that area's own spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUSE_RETIRED_SPELLINGS, RETIRED_FLAGS, RETIRED_VERBS, RetiredSpelling, rewriteRetired } from './retired.mjs';
import { main, USAGE } from './main.mjs';

const ROWS = {
  verbs: [
    { old: ['explain'], now: ['slot'], code: 'VERB_RETIRED', recovery: 'starci app slot <path>' },
    { old: ['hygiene'], now: ['check'], adds: ['--staged'], code: 'VERB_RETIRED', recovery: 'starci app check --staged' },
    { old: ['stack', 'up'], now: ['world', 'up'], code: 'VERB_RETIRED', recovery: 'starci app world up' },
    { old: ['secret', 'set'], now: ['secret', 'set'], operand: '--env', code: 'OPERAND_RETIRED', recovery: 'starci app secret set --env <env> <slug> <KEY>' },
    { old: ['sonar'], now: ['sync'], flags: [{ old: '--write', now: '--execute', value: false }, { old: '--check', now: null, value: false }], code: 'VERB_RETIRED', recovery: 'starci app sync [--execute]' },
    { old: ['gone'], now: null, code: 'VERB_REMOVED', recovery: 'nothing replaces it' },
  ],
  flags: [
    { verb: 'stack', old: '--source-sha', now: '--sha', value: true, code: 'FLAG_RETIRED', recovery: 'starci app stack <action> --sha <sha>' },
    { verb: 'lint', old: '--format', now: '--json', value: true, when: 'json', bare: true, code: 'FLAG_RETIRED', recovery: 'starci app lint --json' },
    { verb: 'upgrade', old: '--plan', now: null, value: false, code: 'FLAG_RETIRED', recovery: 'starci app upgrade (dry by default)' },
    { verb: 'task', old: '--timeout-ms', now: '--timeout', value: true, divide: 1000, code: 'FLAG_RETIRED', recovery: 'seconds' },
  ],
};

test('the switch starts off, like the harness CLI\'s, and every row names a code and a recovery line', () => {
  assert.equal(REFUSE_RETIRED_SPELLINGS, false);
  for (const row of [...RETIRED_VERBS, ...RETIRED_FLAGS]) {
    assert.ok(row.code && row.recovery, JSON.stringify(row));
    assert.ok(!row.recovery.includes('starci app app'), row.recovery);
  }
});

test('a retired spelling is rewritten to its canonical one with one notice', () => {
  const cases = [
    [['explain', 'be/x.ts', '--json'], ['slot', 'be/x.ts', '--json'], '"explain" is retired; it runs as "slot" for now'],
    [['hygiene'], ['check', '--staged'], '"hygiene" is retired; it runs as "check --staged" for now'],
    [['stack', 'up', '--k3d'], ['world', 'up', '--k3d'], '"stack up" is retired; it runs as "world up" for now'],
    [['secret', 'set', 'production', 'app', 'KEY'], ['secret', 'set', '--env', 'production', 'app', 'KEY'], '"secret set <env>" is retired; it runs as "secret set --env <env>" for now'],
    [['sonar', '--write'], ['sync', '--execute'], '"sonar" is retired; it runs as "sync" for now'],
    [['stack', 'deploy', '--env', 'dev', '--source-sha=abc'], ['stack', 'deploy', '--env', 'dev', '--sha', 'abc'], '"stack --source-sha" is retired; it runs as "stack --sha" for now'],
    [['lint', '--format', 'json'], ['lint', '--json'], '"lint --format json" is retired; it runs as "lint --json" for now'],
    [['upgrade', '--plan'], ['upgrade'], '"upgrade --plan" is retired; it runs as "upgrade" for now'],
    [['task', 'send', '--timeout-ms', '3000'], ['task', 'send', '--timeout', '3'], '"task --timeout-ms" is retired; it runs as "task --timeout" for now'],
  ];
  for (const [argv, now, notice] of cases) {
    const rewritten = rewriteRetired(argv, false, ROWS);
    assert.deepEqual(rewritten.argv, now, argv.join(' '));
    assert.deepEqual(rewritten.notices, [`starci app: ${notice}`], argv.join(' '));
  }
});

test('the canonical spelling passes untouched and a value-scoped row leaves another value alone', () => {
  for (const argv of [['slot', 'be/x.ts'], ['secret', 'set', '--env', 'production', 'app', 'KEY'], ['secret', 'set', '--env=dev'], ['lint', '--format', 'text'], ['stack', 'deploy', '--sha', 'abc'], ['check', '--', 'explain']]) {
    assert.deepEqual(rewriteRetired(argv, false, ROWS), { argv, notices: [] }, argv.join(' '));
  }
});

test('with the switch on every retired spelling is refused by its code and recovery; a removed verb is refused either way', () => {
  const refused = (argv, refuse) => assert.throws(() => rewriteRetired(argv, refuse, ROWS), (error) => error instanceof RetiredSpelling && error.code.length > 0 && error.message.includes('is retired: '));
  for (const argv of [['explain', 'x'], ['secret', 'set', 'dev', 'a', 'B'], ['lint', '--format=json'], ['upgrade', '--plan']]) refused(argv, true);
  refused(['gone'], false);
  assert.throws(() => rewriteRetired(['stack', 'up'], true, ROWS), { code: 'VERB_RETIRED', message: '"stack up" is retired: starci app world up' });
});

test('main prints the notice on stderr and runs the canonical spelling; refused, it prints the code and exits 2', async () => {
  const row = RETIRED_VERBS.find((verb) => verb.operand === undefined && verb.now !== null) ?? RETIRED_FLAGS.find((flag) => !flag.value || flag.when !== undefined);
  if (row === undefined) return;
  const old = 'verb' in row ? [...row.verb.split(' '), row.old, ...(row.when === undefined ? [] : [row.when])] : [...row.old];
  let err = '';
  const code = await main([...old, '--help'], { stdout: () => {}, stderr: (text) => { err += text; } });
  assert.equal(code, 0);
  assert.match(err, /^starci app: ".*" is retired; it runs as ".*" for now\n/);
  err = '';
  assert.equal(await main([...old, '--help'], { stdout: () => {}, stderr: (text) => { err += text; }, refuseRetired: true }), 2);
  assert.match(err, new RegExp(`^${row.code}: ".*" is retired: `));
});

test('the usage lists every retired spelling beside the canonical verbs, never as a verb line of its own', () => {
  const lines = USAGE.split('\n');
  const start = lines.findIndex((text) => text.startsWith('retired spellings'));
  assert.ok(start > 0);
  assert.equal(lines.slice(start + 1).filter(Boolean).length, RETIRED_VERBS.length + RETIRED_FLAGS.length);
  for (const text of lines.slice(start + 1).filter(Boolean)) assert.ok(text.startsWith('  ') && text.includes(' -> '), text);
});

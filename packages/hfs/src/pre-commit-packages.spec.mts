// The managed pre-commit hook lints the staged files of the root workspace packages exactly where it lints be and fe: in the blocking branch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const hook = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-commit', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const blocking = hook.slice(hook.indexOf('if [ "$lint" = blocking ]; then'), hook.indexOf('elif [ "$lint" = report ]'));

test('the blocking lint step lints staged packages files through the root config, with no warning allowed', () => {
  assert.match(blocking, /--relative=be/u, 'be is linted there');
  assert.match(blocking, /--relative=fe/u, 'fe is linted there');
  const step = /^\s*git diff --cached --name-only --diff-filter=ACMR -z -- 'packages\/\*\.ts'[^\n]*\n[^\n]*xargs[^\n]*$/mu.exec(blocking)?.[0] ?? '';
  assert.notEqual(step, '', 'a packages step is in the blocking branch');
  for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) assert.ok(step.includes(`'packages/*.${extension}'`), extension);
  assert.match(step, /\[ -f eslint\.config\.mjs \]/u, 'the root config is the managed one');
  assert.match(step, /npx eslint --max-warnings=0 --no-warn-ignored -- "\$@"/u);
  assert.match(step, /turbo run build --filter="\.\/packages\/\*"/u, 'the packages import each other\'s emitted types');
  assert.match(step, /\|\| exit \$\?$/u, 'a failing lint ends the hook');
  assert.ok(!/\bcd (?:be|fe)\b/u.test(step), 'the packages are linted from the app root, not a side folder');
});

test('the report profile keeps the ratchet and no packages step runs outside the blocking branch', () => {
  const rest = hook.replace(blocking, '');
  assert.match(rest, /app check --ratchet/u);
  assert.ok(!rest.includes("'packages/*.ts'"));
});

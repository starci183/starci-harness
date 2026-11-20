// proves: managed package scripts of the app profile name the world kinds both editions run
// A lite app has the e2e slot (BE-TEST-12), so its managed scripts carry `test:e2e` beside `test:integration`; app sync renders them from the template, and the
// edition has no `test:world` or `test:browser`. Every world script typechecks the tests first and selects one jest project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { managedScriptNames } from '../runtime/scripts/hfs/architecture/managed-scripts.mjs';

const template = (group: string): string => fs.readFileSync(new URL(`../templates/app/${group}/package.json`, import.meta.url), 'utf8');

test('lite renders test:integration and test:e2e, never test:world or test:browser', () => {
  const names = managedScriptNames('app');
  for (const name of ['test', 'test:integration', 'test:e2e', 'typecheck:tests']) assert.equal(names.has(name), true, `lite renders ${name}`);
  for (const name of ['test:world', 'test:browser']) assert.equal(names.has(name), false, `lite renders no ${name}`);
});

test('full keeps its four world scripts', () => {
  const names = managedScriptNames('app');
  for (const name of ['test:integration', 'test:e2e', 'test:contract', 'test:world']) assert.equal(names.has(name), true, `full renders ${name}`);
});

test('a world script of either edition typechecks the tests, then runs one jest project from the back end', () => {
  for (const group of ['package-scripts', 'package-scripts-lite']) {
    for (const kind of ['integration', 'e2e']) {
      assert.match(template(group), new RegExp(`"test:${kind}": "npm run typecheck:tests && cd be && jest --selectProjects ${kind}"`), `${group} test:${kind}`);
    }
  }
});

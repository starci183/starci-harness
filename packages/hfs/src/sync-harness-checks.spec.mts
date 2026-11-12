// `starci app sync` takes out a copy of a check the harness owns (R103): the lane-local provider-ring check is the boot proof's own (R401), so a
// lite app's sync retires `scripts/di-ring-check.mjs` and drops every root package.json script that runs it, keeping the rest of package.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retiredFiles, upgradeEdits } from '../sync/index.mjs';
import { HARNESS_CHECK_COPIES, harnessCheckScriptEdits } from '../sync/harness-checks.mjs';

const made: string[] = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const COPY = 'scripts/di-ring-check.mjs';
const manifest = `{
    "name": "lane",
    "scripts": {
        "build": "npm run build:be",
        "di-ring:check": "node scripts/di-ring-check.mjs",
        "di-ring:self": "node ./scripts/di-ring-check.mjs --self-test && echo ok",
        "tools:check": "node scripts/tool-names-check.mjs"
    }
}
`;

function app(edition: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-harness-checks-'));
  made.push(root);
  const contents = { 'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', project: 'lane', edition, sides: { be: { apps: [] } } }), ...files };
  for (const [file, text] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('BE_DI_RING sync: a lite app retires the lane-local provider-ring check and drops the scripts that run it', () => {
  assert.ok(Object.hasOwn(HARNESS_CHECK_COPIES, COPY));
  const root = app('lite', { [COPY]: '// a lane-local copy\n', 'package.json': manifest });
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), [COPY]);
  const edit = upgradeEdits(root).edits.find((candidate) => candidate.path === 'package.json');
  assert.ok(edit, 'package.json is edited');
  assert.match(edit.reason, /di-ring:check, di-ring:self/u);
  assert.equal(edit.content, `{
    "name": "lane",
    "scripts": {
        "build": "npm run build:be",
        "tools:check": "node scripts/tool-names-check.mjs"
    }
}
`);
});

test('BE_DI_RING sync: nothing changes for an app with no copy, a script that only names a similar file, or a full app', () => {
  const read = (text: string) => (file: string) => (file === 'package.json' ? text : null);
  assert.deepEqual(harnessCheckScriptEdits(read('{"scripts":{"x":"node scripts/di-ring-check.mjs.bak"}}')), []);
  assert.deepEqual(harnessCheckScriptEdits(read('not json')), []);
  const full = app('full', { [COPY]: '// a copy\n', 'package.json': manifest });
  assert.deepEqual(retiredFiles(full, { edition: 'full' }), []);
  assert.equal(upgradeEdits(full).edits.some((candidate) => candidate.path === 'package.json'), false);
});

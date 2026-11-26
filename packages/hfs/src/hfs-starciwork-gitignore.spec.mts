// proves: HFS_WORK_AGENT_DATA
// The managed .starciwork/.gitignore admits every folder path-findings admits under `app.starciwork`, so the commit hook's hygiene
// (sync/hygiene.mts, HFS_WORK_AGENT_DATA) never refuses a file `starci app check` accepts. Live failure: .starciwork/prompts/**/*.md was a
// declared slot (h-work-prompts) while this template still refused prompts/, so every prompt commit of StarCi Next was rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const template = fs.readFileSync(path.join(import.meta.dirname, '..', 'templates', 'app', 'starciwork.gitignore'), 'utf8');
const admitted = template.split('\n').filter((line) => line.startsWith('!/')).map((line) => line.slice(2));

test('HFS_WORK_AGENT_DATA: the managed .starciwork/.gitignore admits the declared app.starciwork entries, prompts/ included', () => {
  for (const entry of ['.gitignore', 'workspace.yaml', 'master-plan.yaml', 'brand/', 'concepts/', 'prompts/']) {
    assert.ok(admitted.includes(entry), `.starciwork/.gitignore admits ${entry}`);
  }
  assert.ok(template.includes('\n/*\n'), 'everything else under .starciwork stays refused');
});

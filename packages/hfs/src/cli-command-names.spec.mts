// The cli pattern names a group's run sub-command `<Group>RunCli`, so two groups never share a command class name (contexts/code/be/cli.md BE-CLI-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('the cli pattern names a group\'s run sub-command <Group>RunCli', () => {
  const dir = path.join(import.meta.dirname, '..', 'templates', 'be', 'patterns', 'cli');
  assert.match(fs.readFileSync(path.join(dir, 'sub.run.cli.ts.tpl'), 'utf8'), /export class @@Group@@RunCli extends CommandRunner/u);
  for (const file of ['group.cli.ts.tpl', 'group.module.ts.tpl', 'sub.run.cli.spec.ts.tpl']) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /(?<![@\w])RunCli\b/u, file);
});

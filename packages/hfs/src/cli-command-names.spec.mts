// proves: BE_CLI_COMMAND_SHAPE@full
// proves: BE_CLI_COMMAND_SHAPE@lite
// R149 across files (rules/cli.mts): nest-commander matches a sub-command by its class name, so two command classes of the cli feature root
// with one name are refused, and the starter and the cli pattern name a group's run sub-command `<Group>RunCli` (contexts/code/be/cli.md BE-CLI-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};
const subCommand = (group: string, name: string): string => `import { CommandRunner, SubCommand } from "nest-commander"

@SubCommand({ name: "run", description: "Run ${group}" })
/** \`cli ${group} run\`. */
export class ${name} extends CommandRunner {
    /** Runs ${group}. */
    async run(): Promise<void> {}
}
`;

test('R149: two command classes that share a name are refused at both files; distinct names pass', (t) => {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-cli-names-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit: init });
  assert.match(fs.readFileSync(path.join(root, 'be/src/features/cli/migrate/subs/run.cli.ts'), 'utf8'), /export class MigrateRunCli extends CommandRunner/u, 'the starter names its migrate run command MigrateRunCli');
  const put = (group: string, name: string): string => {
    const file = `be/src/features/cli/${group}/subs/run.cli.ts`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), subCommand(group, name));
    return file;
  };
  const codes = (tracked: string[]) => checkRepo({ repoRoot: root, harness: HARNESS, files: tracked }).findings.filter((finding) => finding.code === 'BE_CLI_COMMAND_SHAPE');
  const collided = [put('seed-enterprise', 'MigrateRunCli')];
  const refused = codes([...files, ...collided]);
  assert.deepEqual(refused.map((finding) => finding.path).sort(), ['be/src/features/cli/migrate/subs/run.cli.ts', 'be/src/features/cli/seed-enterprise/subs/run.cli.ts']);
  assert.match(String(refused[0]!.message), /the command class MigrateRunCli is declared by .* and .*: nest-commander matches a sub-command by its class name/u);
  put('seed-enterprise', 'SeedEnterpriseRunCli');
  assert.deepEqual(codes([...files, ...collided]), [], 'unique names pass');
});

test('the cli pattern names a group\'s run sub-command <Group>RunCli', () => {
  const dir = path.join(import.meta.dirname, '..', 'templates', 'be', 'patterns', 'cli');
  assert.match(fs.readFileSync(path.join(dir, 'sub.run.cli.ts.tpl'), 'utf8'), /export class @@Group@@RunCli extends CommandRunner/u);
  for (const file of ['group.cli.ts.tpl', 'group.module.ts.tpl', 'sub.run.cli.spec.ts.tpl']) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /(?<![@\w])RunCli\b/u, file);
});

import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootLoggerFindings, HFS_BOOT_LOGGER_SILENCED } from '../runtime/scripts/hfs/rules/boot-logger.mjs';
import { ALL_CHECK_CODES } from '../runtime/scripts/hfs/check.mjs';

// proves: HFS_BOOT_LOGGER_SILENCED@lite HFS_BOOT_LOGGER_SILENCED@full

type LoggerInput = Parameters<typeof bootLoggerFindings>[0];

const TEMPLATE_MAIN = path.join(import.meta.dirname, '..', 'templates', 'be', 'skeleton', 'apps', 'cli', 'src', 'main.ts');

// The CLI main a lite app wrote by hand: nest-commander with the logger off, so a provider its root does not compose ends every command with no line on stderr.
const SILENT_CLI = `import { CommandFactory } from "nest-commander"
import { AppModule } from "./app.module"

async function bootstrap(): Promise<void> {
    await CommandFactory.run(AppModule.register(options), {
        logger: false,
        ...createCliFailureHandlers(logger),
    })
}
`;

function fixture(t: TestContext, entries: Record<string, string>, edition: string, extra: Partial<LoggerInput> = {}): LoggerInput & { files: string[] } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-boot-logger-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content);
  }
  return { repoRoot, files: Object.keys(entries), repo: { kind: 'app', profile: 'app', edition }, isRoot: true, ...extra };
}

const codesOf = (input: LoggerInput) => bootLoggerFindings(input).map((finding) => `${finding.code} ${finding.path}`);

for (const edition of ['lite', 'full']) {
  test(`${HFS_BOOT_LOGGER_SILENCED}: ${edition} refuses an app root main that turns the Nest logger off`, (t) => {
    const context = fixture(t, {
      'be/apps/cli/src/main.ts': SILENT_CLI,
      'be/apps/api/src/main.ts': 'const app = await NestFactory.create(AppModule, { logger:false, bufferLogs: true })\n',
    }, edition);
    assert.deepEqual(codesOf(context).sort(), [`${HFS_BOOT_LOGGER_SILENCED} be/apps/api/src/main.ts`, `${HFS_BOOT_LOGGER_SILENCED} be/apps/cli/src/main.ts`]);
    assert.match(bootLoggerFindings(context)[0]?.message ?? '', /prints and exits non-zero \(R376\)/u);
  });

  test(`${HFS_BOOT_LOGGER_SILENCED}: ${edition} accepts the template main, a commented-out option and a quiet compile outside an app root main`, (t) => {
    const context = fixture(t, {
      'be/apps/cli/src/main.ts': fs.readFileSync(TEMPLATE_MAIN, 'utf8'),
      'be/apps/api/src/main.ts': '// logger: false hid every boot failure\n/* logger: false */\nconst app = await NestFactory.create(AppModule, { logger: createNestLogger(logger) })\n',
      'be/src/tests/world/test-apps.options.ts': 'NestFactory.createApplicationContext(CliApp.register(options), { logger: false })\n',
      'be/apps/cli/src/app.module.ts': 'export const options = { logger: false }\n',
    }, edition);
    assert.deepEqual(codesOf(context), []);
  });
}

test(`${HFS_BOOT_LOGGER_SILENCED}: only an app's root scope is judged, within scope, and an unreadable main is skipped`, (t) => {
  const entries = { 'be/apps/cli/src/main.ts': SILENT_CLI };
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { isRoot: false })), []);
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { repo: { kind: 'runtime', profile: 'app', edition: 'lite' } })), []);
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { inScope: () => false })), []);
  const missing = fixture(t, {}, 'lite', { files: ['be/apps/gone/src/main.ts'] });
  assert.deepEqual(codesOf(missing), []);
  const defaulted = fixture(t, entries, 'lite');
  assert.deepEqual(bootLoggerFindings({ repoRoot: defaulted.repoRoot, repo: defaulted.repo, isRoot: true, all: defaulted.files }).map((finding) => finding.code), [HFS_BOOT_LOGGER_SILENCED]);
  assert.deepEqual(bootLoggerFindings({ repoRoot: defaulted.repoRoot, repo: defaulted.repo, isRoot: true }), []);
});

test(`${HFS_BOOT_LOGGER_SILENCED} is one of the codes the app check reports`, () => {
  assert.ok(ALL_CHECK_CODES.includes(HFS_BOOT_LOGGER_SILENCED));
});

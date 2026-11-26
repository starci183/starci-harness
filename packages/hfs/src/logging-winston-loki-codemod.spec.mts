// `starci app codemod logging-winston-loki` (contexts/code/be/logging.md BE-LOGGING-1): platform/logging is app-owned after scaffold, so the codemod
// carries the Winston adapter into an app: the adapter's files come from the skeleton, the files an app grows are judged by a marker and left
// to a person when it is missing, and winston and winston-loki join the root package.json at their canon pins. Dry until --execute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CODEMODS } from '../codemod/main.mjs';
import { ADAPTER_FILES, loggingWinstonLokiMarkdown, migrateLoggingWinstonLoki } from '../codemod/logging-winston-loki.mjs';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';

const LOGGING = 'be/src/modules/platform/logging';

/** An app root whose platform/logging still has the stdout-only adapter and the stream tokens. */
function oldApp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-logging-winston-'));
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write(`${LOGGING}/json-logger.service.ts`, 'export class JsonLoggerService {}\n');
  write(`${LOGGING}/logging.decorators.ts`, 'export const LOG_OUT: unique symbol = Symbol("platform.logging.out")\n');
  write(`${LOGGING}/logging.log-events.ts`, 'export enum LoggingLogEvent { ServerStarted = "server.started" }\n');
  write(`${LOGGING}/index.ts`, 'export { createJsonLogger } from "./json-logger.service"\n');
  write('be/apps/api/src/main.ts', 'const logger = createJsonLogger(new SystemClockService(), new SystemIds())\n');
  write('be/apps/api/src/compose/platform.ts', 'LoggingModule.register({ isGlobal: true }),\n');
  write('be/apps/cli/src/compose/platform.ts', 'LoggingModule.register({ isGlobal: true, info: "stderr" }),\n');
  write('package.json', `${JSON.stringify({ name: 'app', dependencies: { zod: '4.0.0' } }, null, 2)}\n`);
  return root;
}

test('logging-winston-loki is one of the codemods', () => {
  assert.ok(CODEMODS.includes('logging-winston-loki'));
});

test('a dry run lists the adapter files and the edits left for a person, and writes nothing', () => {
  const root = oldApp();
  const report = migrateLoggingWinstonLoki({ root, write: false });
  assert.equal(report.filesChanged.length, ADAPTER_FILES.length);
  assert.equal(fs.readFileSync(path.join(root, LOGGING, 'json-logger.service.ts'), 'utf8'), 'export class JsonLoggerService {}\n');
  assert.deepEqual(report.findings.map((finding) => finding.code).sort(), ['LOGGING_BARREL', 'LOGGING_EVENT_MISSING', 'LOGGING_MAIN_CONTAINER_LOGGER', 'LOGGING_OPTIONS_UNWIRED', 'LOGGING_STREAM_TOKENS']);
  assert.ok(report.findings.every((finding) => !finding.file.includes('apps/cli')));
  assert.match(loggingWinstonLokiMarkdown(report), /would be written/);
});

test('--execute writes the skeleton adapter and pins winston and winston-loki; a second run changes nothing', () => {
  const root = oldApp();
  migrateLoggingWinstonLoki({ root, write: true });
  assert.match(fs.readFileSync(path.join(root, LOGGING, 'loki-transport.adapter.ts'), 'utf8'), /from "winston-loki"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); // reason: parsed manifest
  assert.equal(manifest.dependencies.winston, bundledPins().winston?.version);
  assert.equal(manifest.dependencies['winston-loki'], bundledPins()['winston-loki']?.version);
  const again = migrateLoggingWinstonLoki({ root, write: true });
  assert.deepEqual(again.filesChanged, []);
  assert.ok(again.dependencies.every((dependency) => dependency.declared));
});

test('an app without platform/logging is a case for a person', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-logging-winston-'));
  assert.deepEqual(migrateLoggingWinstonLoki({ root, write: false }).findings.map((finding) => finding.code), ['LOGGING_MISSING']);
});

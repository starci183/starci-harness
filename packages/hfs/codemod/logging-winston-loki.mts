// `starci app codemod logging-winston-loki`: brings an app's platform/logging to the Winston adapter of the skeleton (contexts/code/be/logging.md
// BE-LOGGING-1): JSON lines on stdout and stderr through winston, Loki through winston-loki when LOKI_URL is declared, credential-named fields
// masked, one cause logged once. platform/logging is written once at scaffold and owned by the app afterwards, so `app upgrade` and `app sync`
// never carry a change of it; this codemod does, behind the same Logger port, so no call site changes.
//
// The adapter's own files are written from the skeleton as they are (an app does not customise them; a difference is the old adapter). The files
// an app may have grown (its log events, the module, the decorators, the barrel, the cqrs base, the composition and main.ts) are judged by a
// marker of the new form: present, nothing to do; absent, a case left for a person with the exact edit. `winston` and `winston-loki` are added
// to the app's root package.json at their canon pins. Dry until --execute; exit 1 while a case is left.
import fs from 'node:fs';
import path from 'node:path';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { relativePosix } from './source-tree.mjs';

const LOGGING = 'src/modules/platform/logging';
const SKELETON = path.join(TEMPLATES_DIR, 'be', 'skeleton');
const DEPENDENCIES = Object.freeze(['winston', 'winston-loki']);

/** The files of the adapter itself: written from the skeleton whenever they differ. */
export const ADAPTER_FILES = Object.freeze([
  'json-logger.service.ts',
  'json-logger.service.spec.ts',
  'loki-transport.adapter.ts',
  'loki-transport.adapter.spec.ts',
  'log-redaction.policy.ts',
  'logging.config.ts',
  'logging.options.ts',
]);

/** A file an app may have grown, the marker of its new form, and the edit a person makes when it is missing. */
interface Judged { file: string; marker: RegExp; code: string; reason: string }

const JUDGED: readonly Judged[] = [
  { file: `${LOGGING}/logging.log-events.ts`, marker: /LokiUnreachable\s*=/, code: 'LOGGING_EVENT_MISSING', reason: 'add `LokiUnreachable = "platform.logging.loki.unreachable"` (documented) to LoggingLogEvent' },
  { file: `${LOGGING}/logging.module.ts`, marker: /onApplicationShutdown/, code: 'LOGGING_MODULE_SHUTDOWN', reason: 'implement OnApplicationShutdown on LoggingModule (inject the Logger, call its `close()` when it has one) so the Loki push is flushed, and keep `createJsonLogger(clock, ids, options)` as the LOGGER factory' },
  { file: `${LOGGING}/logging.decorators.ts`, marker: /^(?![\s\S]*\bLOG_(?:OUT|ERR)\b)/, code: 'LOGGING_STREAM_TOKENS', reason: 'delete LOG_OUT, LOG_ERR, InjectLogOut and InjectLogErr: the adapter takes its streams as constructor arguments' },
  { file: `${LOGGING}/index.ts`, marker: /parseLoggingConfig/, code: 'LOGGING_BARREL', reason: 'export `parseLoggingConfig` from "./logging.config" and `type LoggingOptions` from "./logging.options"' },
  { file: 'src/modules/platform/cqrs/cqrs.handler.ts', marker: /isDomainError\(/, code: 'LOGGING_CQRS_DOMAIN_ERROR', reason: 'log OperationFailed only when `!isDomainError(error)` (export isDomainError from platform/errors): a DomainError is an answer, never logged (BE-ERROR-4)' },
];

/** One file the codemod writes. */
export interface LoggingChange { file: string; became: string }
/** One case left for a person. */
export interface LoggingFinding { file: string; line: number; code: string; reason: string }
/** The report of `starci app codemod logging-winston-loki`. */
export interface LoggingReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: LoggingChange[]; findings: LoggingFinding[];
  /** The canon pins of winston and winston-loki in the root package.json: added by --execute, then `npm install` resolves them. */
  dependencies: Array<{ name: string; version: string; declared: boolean; added: boolean }>;
}

const read = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** The back-end side of the app: `be/` of an hfs 4 app, else the root of a back end laid out alone. */
const backEnd = (root: string): string | null => {
  for (const folder of [path.join(root, 'be'), root]) if (fs.existsSync(path.join(folder, LOGGING))) return folder;
  return null;
};

/** The api apps of the back end whose entry composes the logging module: each must hand it the parsed logging options. */
const composedApps = (be: string): string[] => {
  const apps = path.join(be, 'apps');
  if (!fs.existsSync(apps)) return [];
  return fs.readdirSync(apps, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(apps, entry.name, 'src'))
    .filter((src) => fs.existsSync(path.join(src, 'main.ts')));
};

/** Every file under `folder` whose text matches `pattern`, as app-relative paths. */
const matching = (folder: string, pattern: RegExp): string[] => {
  const found: string[] = [];
  const visit = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const target = path.join(at, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.ts') && pattern.test(read(target))) found.push(target);
    }
  };
  if (fs.existsSync(folder)) visit(folder);
  return found;
};

/** Brings `root`'s platform/logging to the Winston adapter; writes only with `write`. */
export function migrateLoggingWinstonLoki({ root, write }: { root: string; write: boolean }): LoggingReport {
  const report: LoggingReport = { schema: 'starci/codemod-logging-winston-loki@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [], dependencies: [] };
  const be = backEnd(root);
  if (be === null) {
    report.findings.push({ file: LOGGING, line: 1, code: 'LOGGING_MISSING', reason: 'no platform/logging under be/ or the root: scaffold it (it is a required slot) before migrating' });
    return report;
  }
  for (const name of ADAPTER_FILES) {
    const source = path.join(SKELETON, LOGGING, name);
    const target = path.join(be, LOGGING, name);
    const text = read(source);
    report.filesScanned += 1;
    if (fs.existsSync(target) && read(target) === text) continue;
    const file = relativePosix(root, target);
    report.filesChanged.push(file);
    report.changes.push({ file, became: fs.existsSync(target) ? 'the Winston adapter of the skeleton' : 'added from the skeleton' });
    if (write) fs.writeFileSync(target, text);
  }
  for (const judged of JUDGED) {
    const target = path.join(be, judged.file);
    if (!fs.existsSync(target)) continue;
    report.filesScanned += 1;
    if (!judged.marker.test(read(target))) report.findings.push({ file: relativePosix(root, target), line: 1, code: judged.code, reason: judged.reason });
  }
  // a file of the skeleton's platform/logging the app lacks (an app scaffolded before correlation) is added as it is: the adapter imports it
  for (const name of fs.readdirSync(path.join(SKELETON, LOGGING)).filter((entry) => !ADAPTER_FILES.includes(entry))) {
    const target = path.join(be, LOGGING, name);
    if (fs.existsSync(target)) continue;
    const file = relativePosix(root, target);
    report.filesChanged.push(file);
    report.changes.push({ file, became: 'added from the skeleton' });
    if (write) fs.writeFileSync(target, read(path.join(SKELETON, LOGGING, name)));
  }
  for (const src of composedApps(be)) {
    const main = read(path.join(src, 'main.ts'));
    if (/createJsonLogger\([^,()]*\(\)\)/.test(main)) report.findings.push({ file: relativePosix(root, path.join(src, 'main.ts')), line: 1, code: 'LOGGING_BOOTSTRAP_IDS', reason: 'createJsonLogger takes the Ids port as its second argument: `createJsonLogger(new SystemClockService(), new SystemIds())`' });
    if (/NestFactory\.create\(/.test(main) && !/useLogger\(/.test(main)) report.findings.push({ file: relativePosix(root, path.join(src, 'main.ts')), line: 1, code: 'LOGGING_MAIN_CONTAINER_LOGGER', reason: 'create the app with `bufferLogs: true`, then `app.useLogger(createNestLogger(app.get<Logger>(LOGGER)))` and log ServerStarted through that logger, so the framework\'s lines reach Loki and the push is flushed on shutdown' });
  }
  for (const file of matching(be, /LoggingModule\.register\(\{\s*isGlobal: true\s*(?:,\s*info: "stderr"\s*)?\}\)/)) {
    // a cli keeps its logs on stderr for the person running it and pushes nothing
    if (relativePosix(root, file).includes('/apps/cli/')) continue;
    report.findings.push({ file: relativePosix(root, file), line: 1, code: 'LOGGING_OPTIONS_UNWIRED', reason: 'read `logging: parseLoggingConfig(env, "<service>")` in the app\'s env reader, declare `logging: LoggingOptions` in its options, and register `LoggingModule.register({ isGlobal: true, ...options.logging })`' });
  }
  const packageFile = path.join(root, 'package.json');
  const manifest = fs.existsSync(packageFile) ? JSON.parse(read(packageFile)) : null;
  const pins = bundledPins();
  let added = false;
  for (const name of DEPENDENCIES) {
    const version = pins[name]?.version ?? '';
    const declared = manifest?.dependencies?.[name] === version;
    report.dependencies.push({ name, version, declared, added: !declared && write && manifest !== null });
    if (!declared && manifest !== null) {
      manifest.dependencies = { ...manifest.dependencies, [name]: version };
      added = true;
    }
  }
  if (added && write) {
    manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** The report as Markdown; JSON consumers read the same object. */
export function loggingWinstonLokiMarkdown(report: LoggingReport): string {
  const out = ['# logging-winston-loki', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'written' : 'would be written'}, ${report.findings.length} left for a person.`, ''];
  if (report.changes.length) out.push('| file | becomes |', '|---|---|', ...report.changes.map((change) => `| ${cell(change.file)} | ${cell(change.became)} |`), '');
  if (report.findings.length) out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|', ...report.findings.map((finding) => `| ${cell(`${finding.file}:${finding.line}`)} | ${finding.code} | ${cell(finding.reason)} |`), '');
  for (const dependency of report.dependencies) out.push(`Dependency ${dependency.name} ${dependency.version}: ${dependency.declared ? 'declared' : dependency.added ? 'added to package.json (run npm install)' : 'not declared (--execute adds it)'}.`);
  out.push('', 'Then: declare `monitoring.logPush: [<service>]` in each Swarm environment whose service should push (contexts/project/monitoring.md PROJECT-MONITORING-2).', '');
  return out.join('\n');
}

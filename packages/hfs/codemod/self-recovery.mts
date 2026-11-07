// `starci app codemod self-recovery`: moves an app's managed jobs, queue and event-bus platform files onto the self-recovering flows
// (BE-RESILIENCE-2) by a three-way comparison with the template snapshot of the release that rendered them (templates/snapshots/<version>): a file equal to the snapshot's rendering is rewritten to the current template, a file equal to
// the current one is left, and any other file of a changed template is left for a person; nothing is written while one is.
import fs from 'node:fs';
import path from 'node:path';
import type { Prettier } from '../sync/format.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { readTree } from '../scaffold/add-plan.mjs';
import { selectLiteQueueEntries, TICK_FILES } from '../scaffold/add-queue-lite.mjs';
import { nextMigrationStamp } from '../scaffold/migration-stamp.mjs';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';
import { formatted, prettierOf } from './app-prettier.mjs';

/** One file the migration writes or adds. */
export interface SelfRecoveryChange { file: string; action: 'add' | 'rewrite' }
/** One case left for a person. */
export interface SelfRecoveryFinding { file: string; code: string; reason: string }
/** The report of a migration (`starci app codemod self-recovery`). */
export interface SelfRecoveryReport { schema: string; root: string; write: boolean; snapshot: string; changes: SelfRecoveryChange[]; findings: SelfRecoveryFinding[] }
/** What `migrateSelfRecovery` takes: the app root, whether to write, the app's formatter (found in it when left out; null keeps the template layout) and the clock of a new migration's stamp. */
export interface SelfRecoveryOptions { root: string; write?: boolean; prettier?: Prettier | null; now?: () => number }

/** The snapshot the codemod diffs against: the templates of the release before self-recovering flows. */
export const SELF_RECOVERY_SNAPSHOT = '5.8.3';
const SNAPSHOT_DIR = path.join(TEMPLATES_DIR, 'snapshots', SELF_RECOVERY_SNAPSHOT);

/** The manifest of a template snapshot: the templates it holds as they were, and the templates added since. */
interface SnapshotManifest { schema: string; version: string; templates: string[]; added: string[] }

/** One managed file of the families: where it sits in the app and the template (templates-relative) that renders it. */
interface Placement { app: string; template: string; capability: string }

const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const readSnapshot = (): SnapshotManifest => JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, 'manifest.json'), 'utf8')) as SnapshotManifest;
const capabilityOf = (app: string): string => /^be\/src\/modules\/platform\/([^/]+)\//u.exec(app)?.[1] ?? '';

/** The platform files the jobs, queues and event-bus families place in an app of `edition`, each with its template; a per-instance path (`<job>`) is no platform file. */
export function selfRecoveryPlacements(edition: string): Placement[] {
  const placements: Placement[] = [];
  const add = (app: string, template: string): void => { placements.push({ app, template, capability: capabilityOf(app) }); };
  for (const topic of ['jobs', 'queues', ...(edition === 'lite' ? [] : ['event-bus'])]) {
    const tree = readTree(topic, edition);
    const entries = edition === 'lite' ? selectLiteQueueEntries(topic, tree) : tree;
    for (const entry of entries) if (entry.template !== undefined && !entry.path.includes('<') && entry.path.startsWith('src/modules/platform/')) add(`be/${entry.path}`, `be/patterns/${entry.template}`);
  }
  if (edition === 'lite') {
    for (const [app, template] of TICK_FILES) add(app, `be/patterns/${template}`);
    const folder = path.join(TEMPLATES_DIR, 'be', 'inbox', 'platform', 'event-bus');
    const names = fs.readdirSync(folder, { recursive: true, encoding: 'utf8' }).map((name) => name.split(path.sep).join('/')).filter((name) => name.endsWith('.tpl'));
    for (const name of names.sort(byCodeUnit)) add(`be/src/modules/platform/event-bus/${name.replace(/\.tpl$/u, '')}`, `be/inbox/platform/event-bus/${name}`);
  }
  return [...new Map(placements.map((placement) => [placement.app, placement])).values()].sort((a, b) => byCodeUnit(a.app, b.app));
}

/** The lite migration that adds the park columns to a jobs table rendered before them, and the folder its stamp is taken from. */
const LITE_PARK_MIGRATION = 'be/patterns/jobs/platform-lite/jobs-failed-awaiting-fix.sql.tpl';
const MIGRATION = /^(\d{14})_[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/u;

/**
 * Migrate an app's jobs, queue and event-bus platform onto the self-recovering flows. All or nothing: a file of a changed template that is
 * neither the snapshot's rendering nor the current one is named for a person, and nothing is written.
 */
export async function migrateSelfRecovery({ root, write = false, prettier, now = Date.now }: SelfRecoveryOptions): Promise<SelfRecoveryReport> {
  const manifest = readSnapshot();
  const report: SelfRecoveryReport = { schema: 'starci/self-recovery-report@1', root, write, snapshot: manifest.version, changes: [], findings: [] };
  const declaration = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) as { edition?: string };
  const edition = declaration.edition ?? 'full';
  const formatter = prettier === undefined ? prettierOf(root, [path.join(root, 'be')]) : prettier ?? undefined;
  const layout = async (file: string, text: string): Promise<string> => (formatter ? formatted(formatter, root, path.join(root, file), text) : text);
  const held = new Set(manifest.templates);
  const added = new Set(manifest.added);
  const present = (capability: string): boolean => fs.existsSync(path.join(root, 'be', 'src', 'modules', 'platform', capability, 'index.ts'));
  const writes = new Map<string, string>();
  for (const placement of selfRecoveryPlacements(edition)) {
    if (!present(placement.capability)) continue;
    const target = path.join(root, placement.app);
    const current = lf(fs.readFileSync(path.join(TEMPLATES_DIR, placement.template), 'utf8'));
    if (!fs.existsSync(target)) {
      if (added.has(placement.template)) {
        writes.set(placement.app, await layout(placement.app, current));
        report.changes.push({ file: placement.app, action: 'add' });
      }
      continue;
    }
    if (!held.has(placement.template)) continue;
    const text = lf(fs.readFileSync(target, 'utf8'));
    const wanted = await layout(placement.app, current);
    if (text === wanted || text === current) continue;
    const before = lf(fs.readFileSync(path.join(SNAPSHOT_DIR, placement.template), 'utf8'));
    if (text === before || text === await layout(placement.app, before)) {
      writes.set(placement.app, wanted);
      report.changes.push({ file: placement.app, action: 'rewrite' });
    } else {
      report.findings.push({ file: placement.app, code: 'SELF_RECOVERY_FILE_BY_HAND', reason: `${placement.app} is neither the ${manifest.version} rendering of ${placement.template} nor the current one; bring the current template's changes (BE-RESILIENCE-2) into it by hand` });
    }
  }
  if (edition === 'lite' && present('jobs')) {
    const folder = path.join(root, 'db', 'migrations');
    const migrations = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => MIGRATION.test(name)).sort(byCodeUnit) : [];
    if (!migrations.some((name) => name.endsWith('_jobs-failed-awaiting-fix.sql'))) {
      const file = `db/migrations/${nextMigrationStamp(now, migrations.at(-1)?.slice(0, 14))}_jobs-failed-awaiting-fix.sql`;
      writes.set(file, lf(fs.readFileSync(path.join(TEMPLATES_DIR, LITE_PARK_MIGRATION), 'utf8')));
      report.changes.push({ file, action: 'add' });
    }
  }
  report.changes.sort((a, b) => byCodeUnit(a.file, b.file));
  if (report.findings.length > 0 || !write) return report;
  for (const [file, text] of writes) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function selfRecoveryMarkdown(report: SelfRecoveryReport): string {
  const out = ['# self-recovery', '', `Against the ${report.snapshot} template snapshot: ${String(report.changes.length)} file(s) ${report.write && report.findings.length === 0 ? 'changed' : 'would change'}, ${String(report.findings.length)} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Changed', '', '| file | action |', '|---|---|');
    for (const item of report.changes) out.push(`| ${cell(item.file)} | ${item.action} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

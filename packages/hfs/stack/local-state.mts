// local-state.mjs - where a dev environment keeps what it started: process ids, logs and receipts, under the per-host state base
// (starciLocalRoot: STARCI_LOCAL_ROOT, else a checkout's .runtime or an installed copy's per-user base), never in the app's checkout nor
// inside an installed package, so `npm ci` and a package copy never delete a running environment's data.
import fs from 'node:fs';
import path from 'node:path';
import { starciLocalRoot } from '../runtime/engine/runtime-root.mjs';

/** What the environment recorded about itself. */
export interface LocalRecord {
  processes: Record<string, { pid: number; startedAt: string; port: number | null }>;
  ports: Record<string, number>;
  receipts: {
    migrate?: { at: string; digest: string };
    seed: Record<string, { at: string; digest: string }>;
    setup: Record<string, { at: string; digest: string }>;
    database?: { at: string; role: string };
  };
}

const empty = (): LocalRecord => ({ processes: {}, ports: {}, receipts: { seed: {}, setup: {} } });

/** The directory of one environment's state: `<state base>/stack/<project>/<env>`. */
export const stateDirectory = (env: NodeJS.ProcessEnv, project: string, environment: string): string =>
  path.join(starciLocalRoot(env), 'stack', project, environment);

/** The log file of one process or service. */
export const logFile = (dir: string, name: string): string => path.join(dir, 'logs', `${name}.log`);

/** Reads the record; an absent or damaged file is an empty record (the environment then reads as not started). */
export function readRecord(dir: string): LocalRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as Partial<LocalRecord>;
    const base = empty();
    return { processes: parsed.processes ?? base.processes, ports: parsed.ports ?? base.ports, receipts: { ...base.receipts, ...parsed.receipts } };
  } catch { return empty(); }
}

/** Writes the record atomically; it holds ids, ports and digests, never a value. */
export function writeRecord(dir: string, record: LocalRecord): void {
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  const target = path.join(dir, 'state.json');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

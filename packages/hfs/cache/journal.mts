// journal.mts - the append-only journal of the app check cache (contexts/project/check-cache.md, "The journal"). A family appends what it has judged
// while it runs, so a run killed at any moment keeps everything already judged, and the next run reads it back like records. A journal is host state in
// the untracked tool cache (never committed), one folder per cache folder, one file per run, kind and context, so parallel runs and parallel writers never
// share a file: nothing is ever written in the middle of another writer's line.
//
// A file starts with one header line `{"journal":1,"kind":"rec"|"raw","fp":<digest>,"ctx":<context>}`; every line after it is one entry: a canonical record line
// (`rec`, parsed as the cache's own records) or a JSON object of the family's own (`raw`, a linter's result). `fp` is the digest of the fingerprint parts the
// family reads and `ctx` the family's own content key; a file whose header does not match what the run computes now is never read. A line the kill cut short
// does not parse and is dropped; the lines before it stand. At the end of a run the family's records are written into the committed cache and the journal of
// that folder is removed (session.mts flush).
import fs from 'node:fs';
import path from 'node:path';
import { parseRecords } from './jsonl.mjs';
import type { CacheRecord, JournalSink } from './types.mjs';

/** The kinds of journal file: `rec` holds cache record lines, `raw` a family's own result lines. */
export type JournalKind = 'rec' | 'raw';

/** The header line of a journal file. */
export interface JournalHeader {
  readonly journal: 1;
  readonly kind: JournalKind;
  readonly fp: string;
  readonly ctx: string;
}

/** Writes `text` to `file` atomically: a temp file in the same folder, then a rename, so a reader (or a kill) sees the old file or the whole new one. */
export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${String(process.pid)}`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/** The header of a journal file's first line, or undefined when it is not one (a torn header, a foreign file). */
function headerOf(first: string): JournalHeader | undefined {
  try {
    const parsed = JSON.parse(first) as Partial<JournalHeader>;
    return parsed.journal === 1 && (parsed.kind === 'rec' || parsed.kind === 'raw') && typeof parsed.fp === 'string' && typeof parsed.ctx === 'string' ? { journal: 1, kind: parsed.kind, fp: parsed.fp, ctx: parsed.ctx } : undefined;
  } catch {
    return undefined;
  }
}

/** Where the journal of one cache folder lives under the journal root. */
export const journalFolder = (root: string, folder: string): string => path.join(root, ...folder.split('/'));

/** The files of a folder's journal, oldest run first (the names start with the run's clock). */
function filesOf(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

/** One readable journal file: its header and its lines after the header (the last one may be torn: the caller parses each). */
interface JournalFile {
  readonly name: string;
  readonly header: JournalHeader;
  readonly lines: string[];
}

function readFile(dir: string, name: string): JournalFile | undefined {
  let text: string;
  try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return undefined; }
  const [first = '', ...rest] = text.split('\n');
  const header = headerOf(first);
  if (header === undefined) return undefined;
  return { name, header, lines: rest.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter((line) => line.trim() !== '') };
}

/** The journal files of `dir` of `kind` whose header carries `fp` (and `ctx` when asked), oldest first. */
export function journalFiles(dir: string, kind: JournalKind, fp: string, ctx?: string): JournalFile[] {
  return filesOf(dir).flatMap((name) => {
    const file = readFile(dir, name);
    return file !== undefined && file.header.kind === kind && file.header.fp === fp && (ctx === undefined || file.header.ctx === ctx) ? [file] : [];
  });
}

/** The records of the `rec` files of `dir` under `fp`, later runs after earlier ones; a torn or foreign line is dropped, never thrown on. */
export function journaledRecords(dir: string, fp: string, lazy: boolean): CacheRecord[] {
  return journalFiles(dir, 'rec', fp).flatMap((file) => parseRecords(file.lines.join('\n'), { lazy }).records);
}

/** The parsed lines of the `raw` files of `dir` under `fp` and `ctx`, later after earlier; a torn line is dropped. */
export function journaledRaw(dir: string, fp: string, ctx: string): unknown[] {
  const out: unknown[] = [];
  for (const file of journalFiles(dir, 'raw', fp, ctx)) {
    for (const line of file.lines) {
      try { out.push(JSON.parse(line)); } catch { /* the line a kill cut short */ }
    }
  }
  return out;
}

/** Whether `dir` holds at least one readable file of `fp` (what a family looks for before it falls back to a full run). */
export function hasJournal(dir: string, fp: string): boolean {
  return filesOf(dir).some((name) => {
    const file = readFile(dir, name);
    return file !== undefined && file.header.fp === fp && file.lines.length > 0;
  });
}

/** Every folder of the journal (relative, posix) that holds a file. */
export function journalFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))) out.push(prefix);
    for (const entry of entries) if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix === '' ? entry.name : `${prefix}/${entry.name}`);
  };
  walk(root, '');
  return out.filter((folder) => folder !== '').sort();
}

/** Removes the journal of one folder (its records are in the committed cache now). */
export function removeJournal(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Removes the files of `dir` whose header is not `fp` (written under other fingerprint parts, or unreadable), and temp files a kill left. */
export function pruneJournal(dir: string, fp: string): void {
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const keep = name.endsWith('.jsonl') && readFile(dir, name)?.header.fp === fp;
    if (!keep) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

/** A sink of `file` for the header `header`. */
export function createSink(file: string, header: JournalHeader): JournalSink {
  let opened = false;
  const open = (): void => {
    if (opened) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(header)}\n`);
    opened = true;
  };
  return {
    file,
    open,
    append(lines) {
      if (lines.length === 0) return;
      open();
      fs.appendFileSync(file, `${lines.join('\n')}\n`);
    },
  };
}

/** Writes a journal file atomically from lines produced one at a time (a coverage snapshot is hundreds of MB, more than one string holds): the header, then the lines in chunks. */
export function writeLinesAtomic(file: string, header: JournalHeader, lines: Iterable<string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${String(process.pid)}`;
  let handle: number | undefined;
  try {
    handle = fs.openSync(temp, 'w');
    fs.writeSync(handle, `${JSON.stringify(header)}\n`);
    let chunk: string[] = [];
    let bytes = 0;
    const flush = (): void => {
      if (chunk.length === 0 || handle === undefined) return;
      fs.writeSync(handle, `${chunk.join('\n')}\n`);
      chunk = [];
      bytes = 0;
    };
    for (const line of lines) {
      chunk.push(line);
      bytes += line.length;
      if (bytes > 8 * 1024 * 1024) flush();
    }
    flush();
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temp, file);
  } catch (error) {
    if (handle !== undefined) fs.closeSync(handle);
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

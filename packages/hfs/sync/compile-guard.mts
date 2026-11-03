// compile-guard.mjs - HFS_SYNC_GROUP_HELD: `starci app sync --execute` never writes a render that leaves the app uncompilable. Before it writes
// a managed TypeScript source (or deletes a retired one), the side's own TypeScript compiles the app with the writes laid over the disk and
// compares the diagnostics of every file they touch, and of every file that imports one, with the same files on disk. A managed group whose
// writes add an error (a template that reads a name the app does not provide yet, or drops one the app still imports) is held whole: none
// of its files is written, the rest of the render is, and the sync names the group, its files and the errors, so the app provides what the
// render reads and runs sync again. A side whose TypeScript is not installed cannot be compiled; its writes go through and say so.
import fs from 'node:fs';
import path from 'node:path';
import type * as TsTypes from 'typescript';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';

/** The TypeScript compiler API of the app's own install, typed by the version this package develops against. */
type Ts = typeof import('typescript');

/** The refusal code of a held group. */
export const GROUP_HELD = 'HFS_SYNC_GROUP_HELD';
/** The pseudo-group of the retired files a sync deletes. */
export const RETIRED_GROUP = 'retired';
/** How many errors a held group prints. */
const SHOWN_ERRORS = 20;
const SOURCE = /\.tsx?$/;

/** One write the guard judges: an app-relative path, its managed group, and its new text (null: the file is deleted). */
export interface GuardedWrite { path: string; group: string; text: string | null }
/** A group sync does not write, with its files and the errors its writes would add. */
export interface HeldGroup { group: string; files: string[]; errors: string[] }
/** What the guard answers: the held groups, and the sides it could not compile. */
export interface GuardVerdict { held: HeldGroup[]; unchecked: string[] }

/** Whether `file` (app-relative) is TypeScript source a side compiles. */
export const isGuardedSource = (file: string): boolean => SOURCE.test(file) && !file.endsWith('.d.ts') && (file.startsWith('be/') || file.startsWith('fe/'));

/** The tsconfig that compiles an app-relative source: `be/tsconfig.json`, or the front-end app's or package's own; null when there is none. */
export function projectOf(root: string, file: string): string | null {
  const parts = file.split('/');
  const project = parts[0] === 'be' ? 'be/tsconfig.json' : parts.length > 3 ? `fe/${parts[1] as string}/${parts[2] as string}/tsconfig.json` : null;
  return project !== null && fs.existsSync(path.join(root, project)) ? project : null;
}

/** One side's compilation: its compiler, options and root files, the overlay of writes keyed the way the host compares file names. */
class Side {
  readonly #ts: Ts;
  readonly #root: string;
  readonly #options: TsTypes.CompilerOptions;
  readonly #rootNames: string[];
  readonly #baseline = new Map<string, string[]>();
  #program: TsTypes.Program | undefined;

  constructor(ts: Ts, root: string, project: string) {
    this.#ts = ts;
    this.#root = root;
    const file = path.join(root, project);
    const read = ts.readConfigFile(file, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), { noEmit: true }, file);
    this.#options = { ...parsed.options, noEmit: true };
    this.#rootNames = parsed.fileNames;
  }

  /** The name the host compares: absolute, forward slashes, lower case where the file system ignores case. */
  key(file: string): string {
    const absolute = path.resolve(this.#root, file).replaceAll('\\', '/');
    return this.#ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  }

  #host(overlay: ReadonlyMap<string, string | null>): TsTypes.CompilerHost {
    const host = this.#ts.createCompilerHost(this.#options, true);
    const { readFile, fileExists, getSourceFile } = host;
    host.readFile = (name) => (overlay.has(this.key(name)) ? overlay.get(this.key(name)) ?? undefined : readFile.call(host, name));
    host.fileExists = (name) => (overlay.has(this.key(name)) ? overlay.get(this.key(name)) !== null : fileExists.call(host, name));
    host.getSourceFile = (name, language, onError, create) => {
      if (!overlay.has(this.key(name))) return getSourceFile.call(host, name, language, onError, create);
      const text = overlay.get(this.key(name));
      return text === null || text === undefined ? undefined : this.#ts.createSourceFile(name, text, language, true);
    };
    return host;
  }

  #programOf(overlay: ReadonlyMap<string, string | null>, added: readonly string[]): TsTypes.Program {
    const rootNames = [...this.#rootNames.filter((name) => overlay.get(this.key(name)) !== null), ...added];
    return this.#ts.createProgram({ rootNames, options: this.#options, host: this.#host(overlay), ...(this.#program === undefined ? {} : { oldProgram: this.#program }) });
  }

  /** The files of the program that import one of `targets` (keys), each with the targets it imports. */
  importers(targets: ReadonlySet<string>, overlay: ReadonlyMap<string, string | null>): Map<string, Set<string>> {
    const host = this.#host(overlay);
    const cache = this.#ts.createModuleResolutionCache(this.#root, (name) => this.key(name), this.#options);
    const found = new Map<string, Set<string>>();
    for (const name of this.#rootNames) {
      const text = host.readFile(name);
      if (text === undefined) continue;
      for (const imported of this.#ts.preProcessFile(text, true, true).importedFiles) {
        const resolved = this.#ts.resolveModuleName(imported.fileName, name, this.#options, host, cache).resolvedModule?.resolvedFileName;
        if (resolved === undefined || !targets.has(this.key(resolved))) continue;
        const into = found.get(this.key(name)) ?? new Set<string>();
        into.add(this.key(resolved));
        found.set(this.key(name), into);
      }
    }
    return found;
  }

  /** The errors of `files` (keys) as `path TScode message`, each file once, in the program with `overlay` laid over the disk. */
  errors(files: readonly string[], overlay: ReadonlyMap<string, string | null>, added: readonly string[]): Map<string, string[]> {
    const program = this.#programOf(overlay, added);
    if (overlay.size === 0) this.#program = program;
    const byKey = new Map(program.getSourceFiles().map((source) => [this.key(source.fileName), source]));
    const answer = new Map<string, string[]>();
    for (const file of files) {
      const source = byKey.get(file);
      const relative = path.relative(this.#root, source?.fileName ?? file).replaceAll('\\', '/');
      const found = source === undefined ? [] : [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
      answer.set(file, found.map((diagnostic) => `${relative}${source === undefined || diagnostic.start === undefined ? '' : `:${String(source.getLineAndCharacterOfPosition(diagnostic.start).line + 1)}`} TS${String(diagnostic.code)} ${this.#ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`));
    }
    return answer;
  }

  /** The errors of `files` on disk, computed once per file. */
  baseline(files: readonly string[]): Map<string, string[]> {
    const missing = files.filter((file) => !this.#baseline.has(file));
    if (missing.length > 0) for (const [file, found] of this.errors(missing, new Map(), [])) this.#baseline.set(file, found);
    return new Map(files.map((file) => [file, this.#baseline.get(file) ?? []]));
  }
}

/** An error without its line, so a line moved by the write is the same error. */
const unplaced = (error: string): string => error.replace(/^([^ ]*?):\d+ /, '$1 ');

/** The errors of `after` that `before` does not hold, counted as a multiset of unplaced errors. */
function added(before: readonly string[], after: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const error of before) left.set(unplaced(error), (left.get(unplaced(error)) ?? 0) + 1);
  return after.filter((error) => {
    const count = left.get(unplaced(error)) ?? 0;
    left.set(unplaced(error), count - 1);
    return count <= 0;
  });
}

/** The held groups of one side: compile with every write of the groups still in play, hold the groups that add an error, again until none does. */
function judgeSide(side: Side, writes: readonly GuardedWrite[]): HeldGroup[] {
  const held: HeldGroup[] = [];
  let open = [...writes];
  while (open.length > 0) {
    const overlay = new Map(open.map((write) => [side.key(write.path), write.text]));
    const groupOf = new Map(open.map((write) => [side.key(write.path), write.group]));
    // An importer is found on the disk with the new files added, so the importer of a file the writes delete is found too.
    const importers = side.importers(new Set(overlay.keys()), new Map([...overlay].filter(([, text]) => text !== null)));
    const files = [...new Set([...[...overlay.keys()].filter((file) => overlay.get(file) !== null), ...importers.keys()])];
    const before = side.baseline(files);
    const after = side.errors(files, overlay, open.filter((write) => write.text !== null).map((write) => path.resolve(write.path)));
    const errors = new Map<string, string[]>();
    for (const file of files) {
      const fresh = added(before.get(file) ?? [], after.get(file) ?? []);
      if (fresh.length === 0) continue;
      const groups = groupOf.has(file) ? [groupOf.get(file) as string] : [...(importers.get(file) ?? [])].map((target) => groupOf.get(target) as string);
      for (const group of groups) errors.set(group, [...(errors.get(group) ?? []), ...fresh]);
    }
    if (errors.size === 0) break;
    for (const [group, found] of errors) held.push({ group, files: open.filter((write) => write.group === group).map((write) => write.path), errors: [...new Set(found)] });
    open = open.filter((write) => !errors.has(write.group));
  }
  return held;
}

/**
 * The groups `starci app sync --execute` holds back at `root`: every write of a TypeScript source is compiled, per side, with the side's own
 * TypeScript (`loadTs`, the app's install by default); a side with no tsconfig compiles nothing, a side whose TypeScript is not installed is
 * named in `unchecked`.
 */
export function guardWrites(root: string, writes: readonly GuardedWrite[], loadTs: (dir: string) => Ts | null = (dir) => loadTypescript(dir, root)): GuardVerdict {
  const verdict: GuardVerdict = { held: [], unchecked: [] };
  const bySide = new Map<string, GuardedWrite[]>();
  for (const write of writes.filter((candidate) => isGuardedSource(candidate.path))) {
    const project = projectOf(root, write.path);
    if (project !== null) bySide.set(project, [...(bySide.get(project) ?? []), { ...write, path: path.join(root, write.path) }]);
  }
  for (const [project, sideWrites] of bySide) {
    const ts = loadTs(path.join(root, path.dirname(project)));
    if (ts === null) {
      verdict.unchecked.push(project);
      continue;
    }
    for (const group of judgeSide(new Side(ts, root, project), sideWrites)) {
      const relative = group.files.map((file) => path.relative(root, file).replaceAll('\\', '/'));
      const known = verdict.held.find((entry) => entry.group === group.group);
      if (known === undefined) verdict.held.push({ ...group, files: relative });
      else verdict.held.splice(verdict.held.indexOf(known), 1, { group: group.group, files: [...known.files, ...relative], errors: [...known.errors, ...group.errors] });
    }
  }
  return verdict;
}

/** The lines sync prints for a held group: what is held and why, the first errors, and what to do. */
export function heldLines(group: HeldGroup): string[] {
  const more = group.errors.length > SHOWN_ERRORS ? [`  ... ${String(group.errors.length - SHOWN_ERRORS)} more`] : [];
  return [
    `${GROUP_HELD} ${group.group}: ${String(group.files.length)} files not written, the render adds ${String(group.errors.length)} type errors to the app (${group.files.join(', ')})`,
    ...group.errors.slice(0, SHOWN_ERRORS).map((error) => `  ${error}`),
    ...more,
    `  make the app provide what the render reads (each error names it), then run "npx --no-install starci app sync --execute" again`,
  ];
}

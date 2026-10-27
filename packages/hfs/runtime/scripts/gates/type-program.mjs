// type-program.mjs - bounded compiler programs, residual-root projections and base overlays for the code gate.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../engine/digest.mjs';
import { pathKey, posixPath } from '../lib/path-key.mjs';
import { readTypePrograms, requireTypeCoverage } from './type-impact.mjs';

const TSC_BOUND = 'bounded-residual-v2';
/** A diagnostic as {path, line, code, message, key}; the key drops the position and the absolute root. */
function tscFinding(ts, diagnostic, root) {
  const rootPaths = [path.resolve(root), posixPath(path.resolve(root))];
  const scrub = (text) => rootPaths.reduce((acc, p) => acc.split(p).join('<ROOT>'), text);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0];
  const file = diagnostic.file ? posixPath(path.relative(root, diagnostic.file.fileName)) : null;
  const line = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null;
  return { engine: 'tsc', rule: `TS${diagnostic.code}`, path: file, line, message, key: `${file ?? '-'}|TS${diagnostic.code}|${scrub(message).replace(/\s+/g, ' ').trim()}` };
}
const errorsOf = (ts, diagnostics, root) => diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => tscFinding(ts, d, root));
const programDiagnostics = (program) => [...program.getConfigFileParsingDiagnostics(), ...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
const NO_OUTPUT = { noEmit: true, composite: false, declaration: false, declarationMap: false, emitDeclarationOnly: false, sourceMap: false };

/** Keep config/reference errors on the original roots; TypeScript omits some reference checks on zero-root programs. */
function configurationDiagnostics(ts, parsed, sys) {
  const options = { ...parsed.options, ...NO_OUTPUT, incremental: false, preserveSymlinks: true };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, projectReferences: parsed.projectReferences, host: boundHost(ts, ts.createCompilerHost(options), sys) });
  return [...ts.getConfigFileParsingDiagnostics(parsed), ...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
}

// Deduplicate repeated program context, retaining distinct positions for the base comparison's diagnostic multiset.
const uniqueFindings = (ts, diagnostics, root) => errorsOf(ts, ts.sortAndDeduplicateDiagnostics(diagnostics), root);

/**
 * `base` (a ts.sys shape) answering only for paths inside `bound`, TypeScript's lib directory and the `allow`ed files; realpath
 * is the identity. Every program of the gate reads through one, so nothing above the app root satisfies an import.
 */
export function boundedSys(ts, bound, base = ts.sys, allow = []) {
  const roots = [pathKey(bound), pathKey(path.dirname(ts.getDefaultLibFilePath({})))];
  const extra = new Set(allow.map((p) => pathKey(p)));
  const inside = (p) => { const key = pathKey(p); return extra.has(key) || roots.some((r) => key === r || key.startsWith(`${r}/`)); };
  return { ...base,
    fileExists: (p) => inside(p) && base.fileExists(p),
    directoryExists: (p) => inside(p) && base.directoryExists(p),
    readFile: (p, encoding) => (inside(p) ? base.readFile(p, encoding) : undefined),
    getDirectories: (p) => (inside(p) ? base.getDirectories(p) : []),
    readDirectory: (dir, ext, exclude, include, depth) => (inside(dir) ? base.readDirectory(dir, ext, exclude, include, depth).filter(inside) : []),
    realpath: (p) => p,
    onUnRecoverableConfigFileDiagnostic: () => {} };
}
/** The compiler host of `host` rewired onto a bounded sys: every lookup, and every source file, goes through it. */
function boundHost(ts, host, sys) {
  return Object.assign(host, {
    fileExists: sys.fileExists, directoryExists: sys.directoryExists, readFile: sys.readFile, getDirectories: sys.getDirectories, realpath: sys.realpath,
    getSourceFile: (fileName, languageVersion) => { const text = sys.readFile(fileName); return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion); },
  });
}
/**
 * The head of one project, bounded to `bound`: original config diagnostics plus incremental residual groups. Each group's
 * buildinfo lives in the worktree's git dir (the one outside-bound file its host may read). The incremental host's versioned
 * getSourceFile reads through the same bound.
 */
export function headTsc(ts, root, project, { bound, cache, required = [] }) {
  const sys = boundedSys(ts, bound), measured = [];
  const { parsed, groups } = readTypePrograms(ts, root, project, sys);
  const diagnostics = configurationDiagnostics(ts, parsed, sys);
  for (const group of groups) {
    const buildInfo = path.join(cache.worktree, 'tsbuildinfo', `${sha256([TSC_BOUND, project, group.project, ts.version, JSON.stringify(group.rootNames), sys.readFile(path.resolve(root, group.project))].join('\0')).slice(0, 24)}.tsbuildinfo`);
    fs.mkdirSync(path.dirname(buildInfo), { recursive: true });
    const hostSys = boundedSys(ts, bound, ts.sys, [buildInfo]);
    const options = { ...group.parsed.options, ...NO_OUTPUT, incremental: true, tsBuildInfoFile: buildInfo, preserveSymlinks: true };
    const program = ts.createIncrementalProgram({ rootNames: group.rootNames, options, projectReferences: group.parsed.projectReferences, host: ts.createIncrementalCompilerHost(options, hostSys) });
    measured.push(...program.getProgram().getSourceFiles());
    diagnostics.push(...programDiagnostics(program));
    program.emit();
  }
  requireTypeCoverage(root, project, required, measured);
  return uniqueFindings(ts, diagnostics, root);
}
/**
 * The base program of one project, read-only: a host whose files are the working tree's except every path the delta changed,
 * which reads its base blob (an added or renamed-to file does not exist, a deleted or renamed-from one comes back). A base
 * finding on a rename source is keyed at its new path. Bounded to `bound` like the head. Recomputed only when head has errors;
 * the working install and generated inputs are not proved by a shared (base, project) diagnostic cache.
 */
export function baseTsc(ts, root, project, { bound, delta, readBase }) {
  const abs = (rel) => posixPath(path.resolve(root, rel));
  const overlay = new Map([...delta.changed, ...delta.deleted].map((rel) => [abs(rel), rel]));
  for (const rel of delta.added) overlay.set(abs(rel), rel);
  const absent = (rel) => delta.added.has(rel) || delta.renamed.has(rel);
  const read = (fileName) => {
    const rel = overlay.get(posixPath(path.resolve(fileName)));
    if (rel === undefined) return ts.sys.readFile(fileName);
    return absent(rel) ? undefined : readBase(rel) ?? undefined;
  };
  const exists = (fileName) => { const rel = overlay.get(posixPath(path.resolve(fileName))); return rel === undefined ? ts.sys.fileExists(fileName) : !absent(rel) && readBase(rel) !== null; };
  const deletedInputs = [...delta.deleted].map((rel) => path.resolve(root, rel));
  const sys = boundedSys(ts, bound, { ...ts.sys, readFile: read, fileExists: exists,
    readDirectory: (dir, ext, exclude, include, depth) => [...ts.sys.readDirectory(dir, ext, exclude, include, depth).filter((f) => exists(f)),
      ...deletedInputs.filter((f) => (!ext || ext.some((suffix) => f.endsWith(suffix))) && posixPath(f).startsWith(`${posixPath(path.resolve(dir))}/`))] });
  // A newly added project has no base program to compare, rather than an unreadable required base config.
  if (!sys.fileExists(path.resolve(root, project))) return [];
  const { parsed, groups } = readTypePrograms(ts, root, project, sys);
  const diagnostics = configurationDiagnostics(ts, parsed, sys);
  for (const group of groups) {
    const options = { ...group.parsed.options, ...NO_OUTPUT, incremental: false, preserveSymlinks: true };
    const host = boundHost(ts, ts.createCompilerHost(options), sys);
    const program = ts.createProgram({ rootNames: group.rootNames, options, projectReferences: group.parsed.projectReferences, host });
    diagnostics.push(...programDiagnostics(program));
  }
  const movedTo = new Map([...delta.renamed].map(([to, from]) => [from, to]));
  const moved = (finding) => (finding.path && movedTo.has(finding.path)
    ? { ...finding, path: movedTo.get(finding.path), key: `${movedTo.get(finding.path)}${finding.key.slice(finding.path.length)}` } : finding);
  return uniqueFindings(ts, diagnostics, root).map(moved);
}

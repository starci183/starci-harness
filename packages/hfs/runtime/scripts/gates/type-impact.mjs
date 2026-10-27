// type-impact.mjs - compiler project impact, prerequisite stamps and stale buildinfo cleanup of the code gate.
import fs from 'node:fs';
import path from 'node:path';
import { byCodeUnit } from '../lib/list.mjs';
import { sha256, sha256File } from '../../engine/digest.mjs';
import { pathKey, posixPath } from '../lib/path-key.mjs';
import { walkFiles, isInside } from '../lib/walk.mjs';
import { locateDeclaration, openHfs } from '../hfs/slots.mjs';
import { typeScriptProjectReferencePath } from '../hfs/typescript-programs.mjs';

/** The existing gate's TypeScript input suffixes; JavaScript is not silently given a new checkJs contract. */
export const TS_SOURCE = /\.(?:[cm]?tsx?)$/;
const regular = (file) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`type input is not a regular file: ${file}`);
  return stat;
};
/** Only the canonical output slot proves generation; a source directory may have any basename. */
const generatedOutput = (root) => {
  const hfs = fs.existsSync(locateDeclaration(root).file) ? openHfs({ repoRoot: root }) : null;
  return (file) => ['repo.build-output', 'app.build-output'].includes(hfs?.slotOf(posixPath(path.relative(root, file)))?.id);
};
const sourceFiles = (dir, root = dir) => {
  const generated = generatedOutput(root);
  return walkFiles(dir, { sorted: true, exclude: (name, full) => name === 'node_modules' || name === '.git' || generated(full) }).sort(byCodeUnit);
};
// Prerequisite stamps retain their cache/custody policy; it never decides compiler ownership.
const stampDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.turbo', '.starci', '.starciwork', '.starcistacks', '.artifacts']);
const stampFiles = (dir) => walkFiles(dir, { sorted: true, exclude: (name) => stampDirectories.has(name) || name.endsWith('.tsbuildinfo') }).sort(byCodeUnit);

/** Read bounded compiler membership/references; config errors throw, while no-input diagnostics remain owed by compilation. */
export function readTypeProject(ts, root, project, sys) {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, project), {}, sys);
  if (!parsed) throw new Error(`${project} could not be read`);
  const errors = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003);
  if (errors.length) throw new Error(`${project}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`);
  return { parsed, fileNames: parsed.fileNames, references: (parsed.projectReferences ?? []).map((reference) => typeScriptProjectReferencePath(ts, reference)) };
}

/** Remove stale worktree *.tsbuildinfo files outside node_modules and .git, returning their root-relative paths. */
export function removeStaleBuildInfo(root) {
  const files = walkFiles(root, { filter: (name) => name.endsWith('.tsbuildinfo'), exclude: (name, full, entry) => entry.isDirectory() && (name === 'node_modules' || name === '.git'), ignoreReadErrors: true });
  for (const file of files) fs.rmSync(file, { force: true });
  return files.map((file) => posixPath(path.relative(root, file)));
}

/** Exact current file bytes, path membership and missing scopes; an M-to-M edit never retains a stamp. */
export function inputStamp(root, paths) {
  const top = path.resolve(root), rows = ['type-input-bytes-v1\0'];
  for (const scope of [...new Set(paths.map(posixPath))].sort(byCodeUnit)) {
    const at = path.resolve(top, scope);
    if (!isInside(top, at)) throw new Error(`type input scope is outside the app: ${scope}`);
    rows.push(`scope\0${scope}\0`);
    if (!fs.existsSync(at)) { rows.push('missing\0'); continue; }
    const stat = fs.lstatSync(at);
    if (stat.isSymbolicLink()) throw new Error(`type input scope is linked: ${scope}`);
    for (const file of stat.isDirectory() ? stampFiles(at) : [at]) {
      const item = regular(file);
      rows.push(`file\0${posixPath(path.relative(top, file))}\0${item.size}\0${sha256File(file)}\0`);
    }
  }
  return sha256(rows.join(''));
}

/** Whether a workspace exposes built declarations or JavaScript beneath dist/. */
export const exposesDist = (manifest) => /(?:^|["/])dist\//.test(JSON.stringify([manifest?.exports ?? null, manifest?.main ?? null, manifest?.types ?? null, manifest?.module ?? null]));

/** Declared workspace directories; the gate builds only its existing dist-exposing workspace owners. */
export function workspaceDirs(root, manifest) {
  const globs = Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages ?? [];
  return globs.flatMap((glob) => {
    const clean = posixPath(glob).replace(/\/$/, '');
    if (!clean.endsWith('/*')) return fs.existsSync(path.join(root, clean, 'package.json')) ? [clean] : [];
    const parent = clean.slice(0, -2);
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, parent), { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return entries.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, parent, entry.name, 'package.json'))).map((entry) => `${parent}/${entry.name}`);
  });
}

const manifestAt = (dir) => {
  const file = path.join(dir, 'package.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const nearestProject = (root, file) => {
  for (let dir = path.dirname(path.resolve(root, file)); ; dir = path.dirname(dir)) {
    const config = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(config)) return posixPath(path.relative(root, config));
    if (pathKey(dir) === pathKey(root) || path.dirname(dir) === dir) return null;
  }
};
/**
 * The compiler programs of the sides that read `file` across sides (hfs.json `sides.<side>.reads`, such as the generated
 * `supabase/types/` of a lite app): such a file has no tsconfig of its own and is typechecked by the programs that import it,
 * so a change to it affects every tsconfig.json of each reading side. Empty when no side reads it or there is no hfs.json.
 */
const readerProjects = (root, file) => {
  let declaration;
  try { declaration = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')); } catch { return []; }
  const sides = Object.entries(declaration?.sides ?? {}).filter(([, side]) => (Array.isArray(side?.reads) ? side.reads : []).some((prefix) => typeof prefix === 'string' && file.startsWith(prefix)));
  return sides.flatMap(([side]) => {
    const dir = path.join(root, side);
    return fs.existsSync(dir) ? sourceFiles(dir, root).filter((config) => path.basename(config) === 'tsconfig.json').map((config) => posixPath(path.relative(root, config))) : [];
  });
};
const sharedImpact = (file) => /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|turbo\.json|hfs\.json)$/.test(file) || file.startsWith('scripts/');

const addTo = (projects, project, source = null) => {
  if (!projects.has(project)) projects.set(project, []);
  if (source !== null) projects.get(project).push(source);
};

/** Compiler-resolved configs, including references to custom-named configs, bounded to this app. */
const projectGraph = (root, configs, readProject) => {
  const generated = generatedOutput(root);
  const records = new Map(), active = new Set();
  const visit = (config) => {
    const absolute = path.resolve(root, config), project = posixPath(path.relative(root, absolute));
    if (!isInside(root, absolute)) throw new Error(`GATE_TSC_OWNER_UNPROVEN project reference is outside the app: ${project}`);
    if (active.has(project)) throw new Error(`GATE_TSC_OWNER_UNPROVEN circular project reference: ${project}`);
    if (records.has(project)) return;
    active.add(project);
    const parsed = readProject(project);
    const names = new Map(parsed.fileNames.map((file) => [pathKey(file), file])), files = new Set(names.keys());
    // Missing, invalid and out-of-bound declared inputs remain obligations, even in an output slot.
    const roots = [...files].filter((file) => !isInside(root, file) || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || !generated(file));
    const record = { project, dir: path.dirname(absolute), files, names, roots, references: [], parsed: parsed.parsed };
    records.set(project, record);
    for (const reference of parsed.references) {
      const target = posixPath(path.relative(root, path.resolve(root, reference)));
      record.references.push(target);
      visit(target);
    }
    active.delete(project);
  };
  for (const config of configs) visit(config);
  return records;
};

const ownsRoot = (record, file, records) => ![...records.values()].some((other) => other.files.has(file)
  && isInside(record.dir, other.dir, { includeSelf: false }));

/** An ancestor that contributes no roots of its own delegates to its nested or referenced programs. */
const aggregateProject = (record, records) => {
  if (!record.roots.length) return record.references.length > 0 || [...records.values()].some((other) => other !== record && isInside(record.dir, other.dir, { includeSelf: false }));
  return record.roots.every((file) => !ownsRoot(record, file, records));
};

/**
 * A config keeps its diagnostics and every root no deeper compiler includes. Residual roots use the
 * nearest nested config's options, so typed app configuration resolves the same aliases as app source.
 * Discovery uses the supplied sys, including the gate's read-only base overlay.
 */
export function readTypePrograms(ts, root, project, sys) {
  const directory = path.dirname(path.resolve(root, project)), generated = generatedOutput(root);
  const configs = sys.readDirectory(directory, ['.json'], ['**/node_modules/**', '**/.git/**'])
    .filter((file) => path.basename(file) === 'tsconfig.json' && !generated(file));
  const records = projectGraph(root, [project, ...configs], (config) => readTypeProject(ts, root, config, sys));
  const record = records.get(posixPath(project)), groups = new Map();
  const nested = [...records.values()].some((other) => isInside(record.dir, other.dir, { includeSelf: false }));
  // Leaf programs retain their declared generated inputs (for example Next ambient declarations and route types).
  const roots = nested ? record.roots : [...record.files];
  for (const file of roots.filter((file) => ownsRoot(record, file, records))) {
    const owners = [...records.values()].filter((other) => isInside(record.dir, other.dir) && isInside(other.dir, file));
    const owner = owners.sort((a, b) => b.dir.length - a.dir.length || byCodeUnit(a.project, b.project))[0] ?? record;
    if (!groups.has(owner.project)) groups.set(owner.project, { project: owner.project, parsed: owner.parsed, rootNames: [] });
    groups.get(owner.project).rootNames.push(record.names.get(file));
  }
  // Ambient declarations are part of the chosen app's compiler context, including generated Next declarations.
  for (const group of groups.values()) group.rootNames = [...new Map([...group.rootNames, ...group.parsed.fileNames.filter((file) => /\.d\.[cm]?ts$/.test(file))].map((file) => [pathKey(file), file])).values()];
  return { parsed: record.parsed, groups: [...groups.values()] };
}

/** The deepest compiler scopes, plus referenced external roots; an excluded selected file still owes coverage. */
const sourceOwners = (file, records) => {
  const candidates = [...records.values()].filter((record) => !aggregateProject(record, records));
  const included = candidates.filter((record) => record.files.has(pathKey(file)));
  const scopes = (included.length ? included : candidates).filter((record) => isInside(record.dir, file));
  const depth = Math.max(...scopes.map((record) => record.dir.length));
  const nearest = scopes.filter((record) => record.dir.length === depth);
  const external = included.filter((record) => !isInside(record.dir, file));
  return [...nearest, ...external];
};

/** Select real programs through an aggregate/reference graph; each selected source remains a required program input. */
const addProject = (project, source, { records, projects, errors }, seen = new Set()) => {
  if (seen.has(project)) return;
  seen.add(project);
  const record = records.get(project);
  if (!record) { errors.push(`GATE_TSC_OWNER_UNPROVEN compiler project was not resolved: ${project}`); return; }
  addTo(projects, project, source);
  for (const reference of record.references) addProject(reference, null, { records, projects, errors }, seen);
  if (aggregateProject(record, records)) {
    for (const other of records.values()) {
      if (isInside(record.dir, other.dir, { includeSelf: false })) addProject(other.project, null, { records, projects, errors }, seen);
    }
  }
};

/** Whether one selected file is a dist-workspace member after its owner checks, recording errors and the project. */
const scanSelected = (root, file, state) => {
  const { removed, workspaces, records, errors } = state;
  const at = path.resolve(root, file);
  if (!isInside(root, at)) { errors.push(`GATE_TSC_OWNER_UNPROVEN selected input is outside the app: ${file}`); return false; }
  if (!TS_SOURCE.test(file)) return false;
  const exists = fs.existsSync(at), owners = sourceOwners(at, records);
  if (!exists && !removed.has(file)) { errors.push(`GATE_TSC_SOURCE_MISSING selected TypeScript does not exist: ${file}`); return false; }
  if (!owners.length && exists) {
    const readers = readerProjects(root, file);
    if (!readers.length) { errors.push(`GATE_TSC_CONFIG_MISSING no tsconfig.json owns selected TypeScript ${file}`); return false; }
    for (const reader of readers) addProject(reader, null, state);
    return false;
  }
  for (const owner of owners) addProject(owner.project, exists ? file : null, state);
  return workspaces.some((dir) => file.startsWith(`${dir}/`));
};

/** Whether a removed tsconfig still has TypeScript without compiler-proven ownership. */
const strandedConfig = (root, file, records) => {
  const dir = path.dirname(path.join(root, file));
  return fs.existsSync(dir) && sourceFiles(dir, root).filter((source) => TS_SOURCE.test(source)).some((source) => {
    return !sourceOwners(source, records).some((owner) => owner.files.has(pathKey(source)));
  });
};

/** The whole-tree scan a broad impact triggers: every discovered program, stranded removals, and the no-program case. */
const broadScan = (root, selected, inventory, state) => {
  const { projects, errors, records } = state;
  for (const record of records.values()) addProject(record.project, null, state);
  for (const file of selected.filter((file) => /(?:^|\/)tsconfig\.json$/.test(file) && !fs.existsSync(path.join(root, file)))) {
    if (strandedConfig(root, file, records)) errors.push(`GATE_TSC_CONFIG_MISSING removed tsconfig.json still has TypeScript without a retained compiler owner: ${file}`);
  }
  if (!projects.size && inventory.some((file) => TS_SOURCE.test(file))) errors.push('GATE_TSC_CONFIG_MISSING configuration/install impact has TypeScript inputs but no tsconfig.json program');
};

/**
 * Selected TypeScript keeps its nearest compiler scopes and projects that include it from outside
 * their own directories. Configuration, install and codegen changes,
 * or a changed dist workspace, affect the actual discovered programs, including typed consumers.
 * Only selected existing TypeScript becomes a required program input; generated assets elsewhere
 * are not turned into source obligations. readProject supplies compiler-resolved fileNames and absolute
 * reference config paths through the gate's bounded host. An unproved selected owner is an error, never a skip.
 */
export function typeImpact(root, files, { deleted = [], readProject } = {}) {
  root = path.resolve(root);
  const projects = new Map(), errors = [], removed = new Set(deleted.map((file) => posixPath(file)));
  const selected = [...new Set(files.map((file) => posixPath(file)))];
  const workspaces = workspaceDirs(root, manifestAt(root)).filter((dir) => exposesDist(manifestAt(path.join(root, dir))));
  let broad = selected.some(sharedImpact) || selected.some((file) => TS_SOURCE.test(file) && workspaces.some((dir) => file.startsWith(`${dir}/`)));
  if (!broad && !selected.some((file) => TS_SOURCE.test(file))) return { projects: [], required: projects, errors };
  const inventory = sourceFiles(root), configs = inventory.filter((file) => path.basename(file) === 'tsconfig.json');
  // A source-only check must not load an unrelated side's compiler or broken config. Start at its
  // nearest scopes (or declared readers), then discover their descendants and reference closure.
  const seeds = broad ? configs : selected.filter((file) => TS_SOURCE.test(file)).flatMap((file) => {
    const nearest = nearestProject(root, file);
    return nearest ? [path.join(root, nearest)] : readerProjects(root, file).map((project) => path.join(root, project));
  });
  // Ancestors contribute their reference closure, not all their unrelated descendant projects.
  const ancestors = selected.filter((file) => TS_SOURCE.test(file)).flatMap((file) => configs.filter((config) => isInside(path.dirname(config), path.resolve(root, file))));
  const records = projectGraph(root, [...new Set([...ancestors, ...configs.filter((config) => seeds.some((seed) => isInside(path.dirname(seed), config)))])], readProject);
  const state = { removed, workspaces, projects, errors, records };
  for (const file of selected) {
    if (scanSelected(root, file, state)) broad = true;
  }
  if (broad) broadScan(root, selected, inventory, state);
  return { projects: [...projects.keys()].sort(byCodeUnit), required: projects, errors };
}

/** Selected source must occur in the compiler's actual program, including an imported excluded root. */
export function requireTypeCoverage(root, project, required, sourceFilesOfProgram) {
  const measured = new Set(sourceFilesOfProgram.map((file) => pathKey(file.fileName)));
  const missing = required.filter((file) => !measured.has(pathKey(path.resolve(root, file))));
  if (missing.length) throw new Error(`GATE_TSC_FILE_EXCLUDED ${project} did not typecheck selected source: ${missing.join(', ')}`);
}

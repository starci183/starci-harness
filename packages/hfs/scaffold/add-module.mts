// starci app add module <name> / starci app remove module <name> - a module package of the product's agent SDK and its registry.
//
// A module is a workspace package `packages/module-<name>` (`@<project>/module-<name>`) built on the product's agent SDK (`packages/agent-sdk`): its
// template and workbench declaration (React-free, for the back end), and its workbench (drawn with Grammar alone). `add` writes the package from
// templates/app/module, registers it (root `workspaces`, the app dependencies on the registry and the module) and re-renders the managed registry
// package `packages/modules` (module-registry.mts, the same render `starci app sync` checks); `remove` reverses every one of those steps.
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { readRepoDeclaration, loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { ScaffoldError, pascalOf, camelOf } from './service.mjs';
import { packageJsonText } from './app.mjs';
import { MODULE_PREFIX, REGISTRY_DIR, SDK_DIR, moduleNames, registryFiles, upperOf } from './module-registry.mjs';

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TEMPLATE_DIR = path.join(TEMPLATES_DIR, 'app', 'module');
const WORKSPACE_GLOB = 'packages/*';

/** What a module verb answers: every app-relative path it wrote, rewrote or deleted. */
export interface ModuleResult {
  readonly created: string[];
  readonly updated: string[];
  readonly removed: string[];
}

interface PackageJson {
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [field: string]: unknown;
}

const read = (file: string): PackageJson => JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
const sortedDependencies = (dependencies: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => byCodeUnit(left, right)));

const listFiles = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });

/** A template's text with `{{project}}`, `{{name}}`, `{{pascal}}`, `{{camel}}` and `{{upper}}` filled; any other placeholder is a defect of the template. */
function fill(text: string, values: Readonly<Record<string, string>>, file: string): string {
  return text.replace(/\{\{([A-Za-z]\w*)\}\}/g, (whole: string, key: string) => {
    const value = values[key];
    if (value === undefined) throw new ScaffoldError('HFS_ADD_PLACEHOLDER_UNKNOWN', `module template ${file} uses ${whole}, which add module does not provide`);
    return value;
  }).replace(/\r\n/g, '\n');
}

/** The package files written from code: the manifests are never template files. */
function manifests(project: string, name: string, versions: Readonly<Record<string, string>>): Array<{ relative: string; body: string }> {
  const sdk = `@${project}/agent-sdk`;
  const exports = {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './template': { types: './dist/template/index.d.ts', default: './dist/template/index.js' },
    './manifest': { types: './dist/manifest/index.d.ts', default: './dist/manifest/index.js' },
    './workbench': { types: './dist/esm/workbench/index.d.ts', default: './dist/esm/workbench/index.js' },
  };
  const packageJson = {
    name: `@${project}/${MODULE_PREFIX}${name}`,
    version: '0.0.0',
    private: true,
    description: `The ${pascalOf(name)} module on the ${project} agent SDK: its template (./template) and workbench declaration (./manifest), both React-free for the back end, and its Grammar-only workbench (./workbench) for the front end.`,
    exports,
    scripts: { build: 'tsc -p tsconfig.build.json && tsc -p tsconfig.build.workbench.json', typecheck: 'tsc --noEmit --pretty false', test: 'jest --coverage' },
    dependencies: { [sdk]: '*' },
    peerDependencies: { '@starci/grammar': versions['@starci/grammar'], react: versions['react'] },
    devDependencies: sortedDependencies({ '@types/jest': versions['@types/jest'] ?? '', '@types/react': versions['@types/react'] ?? '', jest: versions['jest'] ?? '', 'ts-jest': versions['ts-jest'] ?? '', typescript: versions['typescript'] ?? '' }),
  };
  const build = { rootDir: 'src', noEmit: false, declaration: true, types: [] as string[] };
  return [
    { relative: 'package.json', body: packageJsonText(packageJson) },
    { relative: 'tsconfig.json', body: packageJsonText({ extends: '@starci/tsconfig/next.json', compilerOptions: { incremental: false, types: ['jest', 'node'] }, include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.json'], exclude: ['node_modules', 'dist'] }) },
    { relative: 'tsconfig.build.json', body: packageJsonText({ extends: './tsconfig.json', compilerOptions: { ...build, outDir: 'dist', module: 'node16', moduleResolution: 'node16' }, exclude: ['node_modules', 'dist', 'src/**/*.spec.ts', 'src/workbench/**'] }) },
    { relative: 'tsconfig.build.workbench.json', body: packageJsonText({ extends: './tsconfig.json', compilerOptions: { ...build, outDir: 'dist/esm' }, include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.json'], exclude: ['node_modules', 'dist', 'src/**/*.spec.ts'] }) },
  ];
}

/** The versions a module package declares, read from the app's own manifests so it installs the one version of each. */
function versionsOf(root: string, feAppFiles: readonly string[]): Record<string, string> {
  const rootPackage = read(path.join(root, 'package.json'));
  const all: Record<string, string> = { ...rootPackage.devDependencies, ...rootPackage.dependencies };
  for (const file of feAppFiles) Object.assign(all, read(file).dependencies);
  const wanted = ['@starci/grammar', 'react', '@types/jest', '@types/react', 'jest', 'ts-jest', 'typescript'];
  const missing = wanted.filter((name) => all[name] === undefined);
  if (missing.length > 0) throw new ScaffoldError('HFS_ADD_MODULE_PINS', `add module reads the versions of ${missing.join(', ')} from the app's manifests, which declare none of them`);
  return Object.fromEntries(wanted.map((name) => [name, all[name] as string]));
}

/** The package.json of every front-end Next app of the app. */
const feManifests = (root: string): string[] => {
  const apps = path.join(root, 'fe', 'apps');
  if (!fs.existsSync(apps)) return [];
  return fs.readdirSync(apps, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(apps, entry.name, 'package.json'))).map((entry) => path.join(apps, entry.name, 'package.json')).sort(byCodeUnit);
};

/** Everything a verb changes, snapshotted first so a failure leaves the tree as it was. */
class Transaction {
  private readonly before = new Map<string, string | null>();
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  write(relative: string, body: string): void {
    const file = path.join(this.root, ...relative.split('/'));
    if (!this.before.has(file)) this.before.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  remove(relative: string): void {
    const file = path.join(this.root, ...relative.split('/'));
    if (!fs.existsSync(file)) return;
    for (const inner of fs.statSync(file).isDirectory() ? listFiles(file).map((name) => path.join(file, ...name.split('/'))) : [file]) this.before.set(inner, fs.readFileSync(inner, 'utf8'));
    fs.rmSync(file, { recursive: true, force: true });
  }
  rollback(): void {
    for (const [file, text] of this.before) {
      if (text === null) fs.rmSync(file, { force: true });
      else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
    }
  }
}

function context(root: string, name: string): { project: string; declarationFile: string; packageFile: string } {
  if (!NAME.test(String(name))) throw new ScaffoldError('HFS_ADD_NAME_INVALID', `module name ${name} must be kebab-case (letters, digits and single dashes)`);
  const declarationFile = path.join(root, 'hfs.json');
  const packageFile = path.join(root, 'package.json');
  if (!fs.existsSync(declarationFile) || !fs.existsSync(packageFile)) throw new ScaffoldError('HFS_ADD_NOT_AN_APP', 'a module verb runs at the app root containing hfs.json and package.json');
  const repo = readRepoDeclaration(loadSlotManifest(), root);
  return { project: repo.project, declarationFile, packageFile };
}

/** Sets or deletes one dependency of a manifest file, keeping the section sorted; answers whether the text changed. */
function setDependency(tx: Transaction, root: string, file: string, name: string, version: string | null): boolean {
  const manifest = read(file);
  const current = manifest.dependencies ?? {};
  if ((version === null && current[name] === undefined) || current[name] === version) return false;
  const next = { ...current };
  if (version === null) Reflect.deleteProperty(next, name); else next[name] = version;
  manifest.dependencies = sortedDependencies(next);
  tx.write(path.relative(root, file).split(path.sep).join('/'), packageJsonText(manifest));
  return true;
}

/** Registers the modules on the app: the workspace glob, and the registry and module dependencies of the back end (the root manifest) and every front-end app. */
function register(tx: Transaction, root: string, project: string, packageFile: string, names: readonly string[], changed: string[]): void {
  const rootPackage = read(packageFile);
  const workspaces = new Set(rootPackage.workspaces ?? []);
  const others = fs.existsSync(path.join(root, 'packages')) && fs.readdirSync(path.join(root, 'packages')).some((entry) => !entry.startsWith(MODULE_PREFIX) && entry !== 'modules');
  if (names.length > 0) workspaces.add(WORKSPACE_GLOB); else if (!others) workspaces.delete(WORKSPACE_GLOB);
  if ([...workspaces].join('|') !== (rootPackage.workspaces ?? []).join('|')) {
    rootPackage.workspaces = [...workspaces];
    tx.write('package.json', packageJsonText(rootPackage));
    changed.push('package.json');
  }
  const registry = `@${project}/modules`;
  if (setDependency(tx, root, packageFile, registry, names.length > 0 ? '*' : null)) changed.push('package.json');
  for (const file of feManifests(root)) {
    let touched = setDependency(tx, root, file, registry, names.length > 0 ? '*' : null);
    const present = Object.keys(read(file).dependencies ?? {}).filter((dependency) => dependency.startsWith(`@${project}/${MODULE_PREFIX}`));
    for (const dependency of present) if (!names.some((name) => `@${project}/${MODULE_PREFIX}${name}` === dependency)) touched = setDependency(tx, root, file, dependency, null) || touched;
    for (const name of names) touched = setDependency(tx, root, file, `@${project}/${MODULE_PREFIX}${name}`, '*') || touched;
    if (touched) changed.push(path.relative(root, file).split(path.sep).join('/'));
  }
}

/** Replaces the registry package by the render of `names`: files written, and a registry of no module deleted. */
function writeRegistry(tx: Transaction, root: string, project: string, names: readonly string[], result: { created: string[]; updated: string[]; removed: string[] }): void {
  const files = registryFiles(project, names);
  if (files.length === 0) {
    if (fs.existsSync(path.join(root, REGISTRY_DIR))) { tx.remove(REGISTRY_DIR); result.removed.push(REGISTRY_DIR); }
    return;
  }
  for (const file of files) {
    (fs.existsSync(path.join(root, file.path)) ? result.updated : result.created).push(file.path);
    tx.write(file.path, file.content);
  }
}

/** Adds the module package `name`, registers it and re-renders the registry. Refused when the app has no agent SDK package or the module exists. */
export function addModule({ root, name }: { root: string; name: string }): ModuleResult {
  const { project, packageFile } = context(root, name);
  if (!fs.existsSync(path.join(root, SDK_DIR, 'package.json'))) throw new ScaffoldError('HFS_ADD_MODULE_SDK_MISSING', `a module is built on the product's agent SDK, which must exist as ${SDK_DIR}/ (a workspace package named @${project}/agent-sdk)`);
  const folder = `packages/${MODULE_PREFIX}${name}`;
  if (fs.existsSync(path.join(root, folder))) throw new ScaffoldError('HFS_ADD_EXISTS', `module ${name} already exists: ${folder}`);
  const values = { project, name, pascal: pascalOf(name), camel: camelOf(name), upper: upperOf(name) };
  const planned = [
    ...manifests(project, name, versionsOf(root, feManifests(root))),
    ...listFiles(TEMPLATE_DIR).map((file) => ({
      relative: file.replace(/\.tpl$/, '').split('/').map((segment) => segment.replace('__name__', name).replace('__pascal__', values.pascal)).join('/'),
      body: fill(fs.readFileSync(path.join(TEMPLATE_DIR, ...file.split('/')), 'utf8'), values, file),
    })),
  ];
  const result: ModuleResult = { created: planned.map((file) => `${folder}/${file.relative}`), updated: [], removed: [] };
  const tx = new Transaction(root);
  try {
    for (const file of planned) tx.write(`${folder}/${file.relative}`, file.body);
    const names = moduleNames(root);
    register(tx, root, project, packageFile, names, result.updated);
    writeRegistry(tx, root, project, names, result);
  } catch (error) {
    tx.rollback();
    fs.rmSync(path.join(root, folder), { recursive: true, force: true });
    throw error;
  }
  return result;
}

/** Removes the module package `name`, its registrations and its entry in the registry; the last module takes the registry package with it. */
export function removeModule({ root, name }: { root: string; name: string }): ModuleResult {
  const { project, packageFile } = context(root, name);
  const folder = `packages/${MODULE_PREFIX}${name}`;
  if (!fs.existsSync(path.join(root, folder))) throw new ScaffoldError('HFS_REMOVE_NOT_FOUND', `module ${name} does not exist: ${folder}`);
  const result: ModuleResult = { created: [], updated: [], removed: [folder] };
  const tx = new Transaction(root);
  try {
    tx.remove(folder);
    const names = moduleNames(root);
    register(tx, root, project, packageFile, names, result.updated);
    writeRegistry(tx, root, project, names, result);
  } catch (error) {
    tx.rollback();
    throw error;
  }
  return result;
}

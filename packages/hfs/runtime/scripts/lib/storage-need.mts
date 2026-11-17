// storage-need.mts - the one answer to "does this project run its own object store (MinIO)?" (contexts/project/statics.md PROJECT-STATICS-2).
// A project ships its own MinIO, in dev and in production, on ONE condition: it has statics/ (a file other than the .gitkeep starter) or its
// back end needs storage (its root package.json depends on @starci/object-storage, or the stack declaration holds a `storage` custody member
// or a sealed storage-* production secret). No condition met: no MinIO. The sync of the managed storage image (slot app.storage.image) and the
// rule R440 read this one function, so what sync renders and what the check demands never differ.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';

/** The package a back end imports to talk to an object store. */
export const STORAGE_PACKAGE = '@starci/object-storage';
/** The folder of the repo-owned statics, at the app root. */
export const STATICS_DIR = 'statics';
/** The starter file that keeps an empty statics/ in git. It is not a static. */
const STARTER = 'statics/.gitkeep';

/** The facts the condition reads. Every field is optional: absent means "not there". */
export interface StorageNeedFacts {
  /** App-relative paths (posix) of the files under statics/, tracked or on disk. */
  staticsFiles?: readonly string[];
  /** The parsed root package.json. */
  packageJson?: unknown;
  /** The parsed .starcistacks/application-stacks.yaml. */
  stack?: unknown;
}

/** The answer: which condition holds, whether a storage service is declared, and the verdict. */
export interface StorageNeed {
  /** statics/ holds a file other than the starter. */
  statics: boolean;
  /** The back end uses storage: the package, a `storage` custody member or a sealed storage-* production secret. */
  backend: boolean;
  /** The condition: statics or backend. */
  needed: boolean;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** True when the root package.json depends on the object-storage package. */
function dependsOnStorage(packageJson: unknown): boolean {
  if (!plain(packageJson)) return false;
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some((key) => plain(packageJson[key]) && Object.hasOwn(packageJson[key] as object, STORAGE_PACKAGE));
}

/** True when the declaration holds a `storage` custody member of a dev environment or a sealed `storage-*` secret of any environment. */
function declaresStorageMember(stack: unknown): boolean {
  if (!plain(stack) || !plain(stack.environments)) return false;
  return Object.values(stack.environments).some((environment) => {
    if (!plain(environment)) return false;
    const custody = plain(environment.local) ? list(environment.local.custody) : [];
    if (custody.some((entry) => plain(entry) && entry.member === 'storage')) return true;
    return list(environment.secrets).some((secret) => plain(secret) && typeof secret.name === 'string' && secret.name.startsWith('storage-'));
  });
}

/** The storage need of a project over its facts. Pure. */
export function storageNeed(facts: StorageNeedFacts): StorageNeed {
  const statics = (facts.staticsFiles ?? []).some((file) => file.startsWith(`${STATICS_DIR}/`) && file !== STARTER);
  const backend = dependsOnStorage(facts.packageJson) || declaresStorageMember(facts.stack);
  return { statics, backend, needed: statics || backend };
}

/** The files under statics/ of an app on disk, app-relative and posix; empty when there is no folder. */
export function staticsFilesOnDisk(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel); else out.push(rel);
    }
  };
  walk(STATICS_DIR);
  return out.sort();
}

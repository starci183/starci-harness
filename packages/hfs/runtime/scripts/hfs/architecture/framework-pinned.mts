// framework-pinned.mjs - the Next.js files that only load from a source root (the directory holding
// app/). Authored once in knowledge/patterns/fe/folder.yaml FE-FOLDER-1 (frameworkPinnedRootFiles), never
// hard-coded here (a supervisor ruling). Read by the architecture
// check (FE_SOURCE_LAYOUT_INVALID).
//
// An unreadable or malformed list is a broken install, not "no pinned files": the reader throws
// ARCH_KNOWLEDGE_UNAVAILABLE so the caller reports an error instead of judging with a different contract.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../../engine/yaml.mjs';

export const FRAMEWORK_PINNED_KNOWLEDGE = fileURLToPath(new URL('../../../knowledge/patterns/fe/folder.yaml', import.meta.url));

const cache = new Map<string, { files: Set<string> }>(); // only the installed knowledge file is cached; an explicit file is re-read
const EXACT_NAME = /^[^\\/*?[\]{}\s]+$/;

function unavailable(file: string, detail: string): Error {
  return new Error(`ARCH_KNOWLEDGE_UNAVAILABLE: ${file} ${detail}`);
}

function load(file: string): { files: Set<string> } {
  const cached = cache.get(file);
  if (cached) return cached;
  // reason: parsed-YAML boundary; the rule row is validated field by field below.
  let rule;
  try {
    rule = parseYaml(fs.readFileSync(file, 'utf8'))?.rules?.find((item: { id?: unknown } | null) => item?.id === 'FE-FOLDER-1');
  } catch (error) {
    throw unavailable(file, `cannot be read (${(error as { message?: unknown }).message ?? error}).`);
  }
  const list = rule?.frameworkPinnedRootFiles;
  if (!Array.isArray(list) || !list.length || list.some((name: unknown) => typeof name !== 'string' || !EXACT_NAME.test(name as string))) {
    throw unavailable(file, 'FE-FOLDER-1 frameworkPinnedRootFiles must be a nonempty list of exact file names.');
  }
  const loaded = { files: new Set(list) };
  if (file === FRAMEWORK_PINNED_KNOWLEDGE) cache.set(file, loaded);
  return loaded;
}

/** Exact basenames Next.js loads only from the source root. */
export function frameworkPinnedRootFiles(file: string = FRAMEWORK_PINNED_KNOWLEDGE): Set<string> {
  return load(file).files;
}

// Manifests the root archive ships name files by path; a path that does not ship breaks the installed runtime.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../engine/yaml.mjs';
import { asList, byCodeUnit } from './list.mjs';
import { EXAMPLES_ROOT } from './example-refs.mjs';

const KNOWLEDGE_SOURCE = 'starci/knowledge-source@1';
const strings = (value) => asList(value).filter((item) => typeof item === 'string' && item.length > 0);
const entries = (value) => asList(value).filter((item) => item && typeof item === 'object');
const joined = (directory, file) => path.posix.normalize(path.posix.join(directory, file));

/** The example catalog: each example's files/entrypoint/projects/tests are relative to that example's own directory. */
const exampleReferences = (doc) => entries(doc?.examples).flatMap((example) => {
  const base = path.posix.join(EXAMPLES_ROOT, String(example.path ?? ''));
  return [...strings(example.files), ...strings(example.entrypoint), ...strings(example.projects), ...strings(example.tests)]
    .map((file) => ({ from: String(example.id ?? '?'), target: joined(base, file) }));
});

/** The schema catalog: schemas[].file and every moduleLocalDocumentKinds[].files entry are relative to the package root. */
const schemaReferences = (doc) => [
  ...entries(doc?.schemas).flatMap((schema) => strings(schema.file).map((file) => ({ from: String(schema.id ?? '?'), target: joined('.', file) }))),
  ...entries(doc?.moduleLocalDocumentKinds).flatMap((kind) => strings(kind.files).map((file) => ({ from: String(kind.id ?? '?'), target: joined('.', file) }))),
];

/** The path-bearing keys of a grammar family entry. */
const FAMILY_PATH_KEYS = ['authority', 'packageSnapshot', 'reusableStyle', 'productComposition', 'index'];

/** A knowledge-source index: branches[].path, topics[].path and the family files, relative to the index's own directory. */
const knowledgeReferences = (directory) => (doc) => [
  ...entries(doc?.branches).flatMap((branch) => strings(branch.path).map((file) => ({ from: String(branch.id ?? '?'), target: joined(directory, file) }))),
  ...entries(doc?.topics).flatMap((topic) => strings(topic.path).map((file) => ({ from: String(topic.title ?? '?'), target: joined(directory, file) }))),
  ...entries(doc?.families).flatMap((family) => FAMILY_PATH_KEYS.flatMap((key) => strings(family[key]).map((file) => ({ from: `${family.id ?? '?'}.${key}`, target: joined(directory, file) })))),
];

/** Manifests the package must ship; their absence from the selection is red, never a skip. */
export const REQUIRED_MANIFESTS = Object.freeze([`${EXAMPLES_ROOT}/index.yaml`, 'modules/schemas/index.yaml', 'knowledge/index.yaml']);

const KNOWLEDGE_INDEX = /^knowledge\/(?:.+\/)?index\.yaml$/;

/** The reader of one manifest file: the two catalogs have their own, every knowledge index reads its own directory. */
const readerOf = (file) => {
  if (file === REQUIRED_MANIFESTS[0]) return exampleReferences;
  if (file === REQUIRED_MANIFESTS[1]) return schemaReferences;
  return knowledgeReferences(path.posix.dirname(file));
};

/** The manifests to read: the required set plus every selected knowledge index. */
const manifestFiles = (selected) => [...new Set([...REQUIRED_MANIFESTS, ...selected.filter((name) => KNOWLEDGE_INDEX.test(name))])].sort(byCodeUnit);

/** {references} of one manifest, {skip} for an index of another schema, {unrun} or {red} when it cannot be trusted. */
function readManifest(file, readFile) {
  let doc;
  try { doc = parseYaml(readFile(file)); } catch { return { unrun: `${file} is unreadable or not valid YAML` }; }
  if (doc?.schema !== KNOWLEDGE_SOURCE && !REQUIRED_MANIFESTS.includes(file)) return { skip: true };
  const references = readerOf(file)(doc);
  if (!references.length) return { red: `${file} yields no file references; its reference keys changed or it lists nothing, so nothing in it would be checked` };
  return { references };
}

/**
 * Pre-pack admission: every path a shipped manifest names must be in the archive selection. Manifests are the required
 * set plus every selected knowledge index stamped starci/knowledge-source@1, so a new index is covered unlisted.
 * Returns {unrun} when a manifest cannot be read, {red} naming the first unresolved paths, else {manifests, references, counts}.
 */
export function manifestAdmission({ root, selected, readFile = (file) => fs.readFileSync(path.join(root, file), 'utf8') }) {
  const shipped = new Set(selected);
  const missing = REQUIRED_MANIFESTS.filter((file) => !shipped.has(file));
  if (missing.length) return { red: `the archive does not ship required manifest(s): ${missing.join(', ')}` };
  const gaps = [];
  const counts = {};
  for (const file of manifestFiles(selected)) {
    const read = readManifest(file, readFile);
    if (read.unrun || read.red) return read;
    if (read.skip) continue;
    counts[file] = read.references.length;
    for (const { from, target } of read.references) if (target.startsWith('../') || !shipped.has(target)) gaps.push(`${file} (${from}) -> ${target}`);
  }
  if (gaps.length) {
    const sorted = [...new Set(gaps)].sort(byCodeUnit);
    return { red: `${sorted.length} shipped manifest reference(s) do not resolve in the archive: ${sorted.slice(0, 5).join('; ')}` };
  }
  return { manifests: Object.keys(counts).length, references: Object.values(counts).reduce((sum, count) => sum + count, 0), counts };
}

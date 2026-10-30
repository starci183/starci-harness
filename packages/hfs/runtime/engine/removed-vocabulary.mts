import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseYaml} from './yaml.mjs';

const FILE=fileURLToPath(new URL('../modules/kernel/removed-vocabulary.yaml',import.meta.url));

/** One refused spelling of modules/kernel/removed-vocabulary.yaml. */
export interface RemovedEntry {kind: string; name: string; use: string}
interface RemovedDoc {removed: RemovedEntry[]}
let cache: {version: string; doc: RemovedDoc} | null=null;
function loaded(): RemovedDoc{
  let stat;try{stat=fs.statSync(FILE);}catch{throw new Error('Missing modules/kernel/removed-vocabulary.yaml');}
  const version=`${stat.mtimeMs}:${stat.size}`;
  if(cache?.version!==version)cache={version,doc:parseYaml(fs.readFileSync(FILE,'utf8'))};
  return cache.doc;
}


/** modules/kernel/removed-vocabulary.yaml: the one list of spellings the runtime refuses, each with its replacement and the release that removed it. */
export const removedVocabulary=(): RemovedEntry[]=>loaded().removed;

/** The removed spellings of one kind. */
export const removedOfKind=(kind: string): RemovedEntry[]=>removedVocabulary().filter(entry=>entry.kind===kind);

/** `<name> is removed (<replacement>)` for a removed spelling of the kind, or undefined when the name is not one. */
export function removedNotice(kind: string,name: string): string | undefined{
  const entry=removedOfKind(kind).find(candidate=>candidate.name===name);
  return entry?`${entry.name} is removed (${entry.use})`:undefined;
}

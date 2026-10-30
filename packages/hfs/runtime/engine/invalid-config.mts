import path from 'node:path';
import {isPlainObject as plain} from './plain-object.mjs';
/** The one `Invalid config.yaml:` raiser every section validator shares: bad('<rest>') throws it. */
export type Bad=(message:string)=>never;
export const invalid=(section:string):Bad=>message=>{throw new Error(`Invalid config.yaml: ${section}${message}`);};

/** The host roots the owner may relocate (config.yaml `roots`): the archive root, the lanes root and the temp root. */
export const ROOT_KEYS=Object.freeze(['archive','lanes','temp']);
/** The validated config.yaml `roots` block. */
export interface RootsBlock { archive?: string | null; lanes?: string | null; temp?: string | null }
/** config.yaml `roots` - {archive?, lanes?, temp?}: absolute directories, or null; an absent key means <starciLocalRoot>/archive and the per-user lanes directory. */
export function validateRoots(roots: unknown): void{
  if(roots===null)return;
  const bad=invalid('roots');
  if(!plain(roots))return bad(` must be {archive?: <absolute directory>, lanes?: <absolute directory>, temp?: <absolute directory>} or null.`);
  for(const key of Object.keys(roots))if(!ROOT_KEYS.includes(key))bad(` has unknown key ${key} (allowed: ${ROOT_KEYS.join(', ')}).`);
  for(const key of ROOT_KEYS){const value=roots[key];if(value!==undefined&&value!==null&&!(typeof value==='string'&&value.trim()&&path.isAbsolute(value)))bad(`.${key} must be an absolute directory path or null.`);}
}

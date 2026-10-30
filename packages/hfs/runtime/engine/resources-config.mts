import {isPlainObject as plain} from './plain-object.mjs';
import {invalid} from './invalid-config.mjs';

/**
 * config.yaml `resources` — the owner's host-capacity floors, which override the shipped numbers of
 * modules/models/runtimes.yaml `allocation.resources`. minFreeDiskGb: the free space a drive holding the temp root or the
 * repository must keep before `starci kernel dispatch --spawn` launches another worker. minFreeDiskPct: the same floor as a
 * percentage of the drive's size; when both are set the larger requirement applies. minFreeRamPct: the free-RAM floor below
 * which no new heavy op starts. A null or absent key leaves the shipped number.
 */
const FLOOR_LIMITS=Object.freeze({minFreeDiskGb:Infinity,minFreeDiskPct:100,minFreeRamPct:100});
/** One of the resources block's floor keys. */
type FloorKey=keyof typeof FLOOR_LIMITS;
/** The validated config.yaml `resources` block (and the shipped `allocation.resources` it overrides). */
export type ResourcesBlock={[key in FloorKey]?: number | null};
/** The floors in force. */
export interface HostFloors {minFreeDiskGb: number; minFreeDiskPct: number | null; minFreeRamPct: number}
const inRange=(value: unknown,limit: number): value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=limit;

/** The keys of the resources block. */
export const RESOURCE_KEYS: readonly string[]=Object.freeze(Object.keys(FLOOR_LIMITS));
const isFloorKey=(key: string): key is FloorKey=>Object.hasOwn(FLOOR_LIMITS,key);

export function validateResources(resources: unknown): void{
  if(resources===null)return;
  const bad=invalid('resources');
  const keys=RESOURCE_KEYS;
  const shape=keys.map(key=>`${key}?`).join(', ');
  if(!plain(resources))return bad(` must be {${shape}} or null.`);
  for(const key of Object.keys(resources))if(!keys.includes(key))bad(` has unknown key ${key} (allowed: ${keys.join(', ')}).`);
  for(const key of keys){
    if(!isFloorKey(key))continue;
    const value=resources[key];
    if(value!==undefined&&value!==null&&!inRange(value,FLOOR_LIMITS[key])){
      const cap=FLOOR_LIMITS[key]===Infinity?'':` and at most ${FLOOR_LIMITS[key]}`;
      bad(`.${key} must be a number above 0${cap}, or null.`);
    }
  }
}

const declared=(block: ResourcesBlock | null | undefined,key: FloorKey,source: string): number | null=>{
  const value=block?.[key];
  if(value===undefined||value===null)return null;
  if(!inRange(value,FLOOR_LIMITS[key]))throw new Error(`${source}.${key} must be a number above 0 (at most ${FLOOR_LIMITS[key]})`);
  return value;
};

/**
 * The floors in force: the owner's `resources` (config.yaml) over the shipped `allocation.resources`.
 * {minFreeDiskGb, minFreeDiskPct (null when unset), minFreeRamPct}. The shipped policy owns the default numbers: when it
 * omits or misspells minFreeDiskGb or minFreeRamPct this refuses, there is no fallback constant.
 */
export function hostFloors(shipped: ResourcesBlock | null | undefined,owner: ResourcesBlock | null | undefined=null): HostFloors{
  const source='modules/models/runtimes.yaml allocation.resources';
  const base={minFreeDiskGb:declared(shipped,'minFreeDiskGb',source),minFreeDiskPct:declared(shipped,'minFreeDiskPct',source),minFreeRamPct:declared(shipped,'minFreeRamPct',source)};
  for(const key of ['minFreeDiskGb','minFreeRamPct'] as const)if(base[key]===null)throw new Error(`${source}.${key} must declare a positive number`);
  if(owner!==null&&owner!==undefined)validateResources(owner);
  const pick=(key: FloorKey): number | null=>declared(owner,key,'config.yaml resources')??base[key];
  return {minFreeDiskGb:pick('minFreeDiskGb') as number,minFreeDiskPct:pick('minFreeDiskPct'),minFreeRamPct:pick('minFreeRamPct') as number};
}

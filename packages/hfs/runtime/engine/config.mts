import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {skillRoot} from './runtime-root.mjs';
import {parseYaml} from './yaml.mjs';
import {isPlainObject as plain} from './plain-object.mjs';
import {invalid,validateRoots,ROOT_KEYS} from './invalid-config.mjs';
import type {Bad,RootsBlock} from './invalid-config.mjs';
import {validateSonar} from './sonar-config.mjs';
import type {SonarBlock} from './sonar-config.mjs';
import {validateRelease,RELEASE_KEYS} from './release-config.mjs';
import type {ReleaseBlock} from './release-config.mjs';
import {validateOrca,ORCA_KEYS} from './orca-config.mjs';
import type {OrcaBlock} from './orca-config.mjs';
import {validateResources,RESOURCE_KEYS} from './resources-config.mjs';
import type {ResourcesBlock} from './resources-config.mjs';
import { ENV_NAME, connectorSecret } from './secrets.mjs';
import {byCodeUnit} from './by-code-unit.mjs';
import {EFFORT_LEVELS,MODELS_KEYS,validateModelsBlock,refuseRemovedKeys,shippedTiers} from './model-config.mjs';
import type {AllocationSettings,ModelsBlock,RuntimePool,RuntimeProfile} from './model-config.mjs';
const knownNames=(names: Iterable<string>): string=>[...names].sort(byCodeUnit).join(', ');
export {readDotenv,connectorSecret} from './secrets.mjs';

/** An owner approval mapping (config.yaml `launchTrust`, `retention.workflowPurge`): the paths key is `roots` or `repos`. */
export interface OwnerProfile {approvedBy: 'owner'; approvalRef: string; profile?: 'automatic' | 'declined'; roots?: string[]; repos?: string[]}
/** A pinned agent seat (config.yaml `kernel`, `supervisor.kernel`). */
export interface AgentSeat {agent?: string | null; model?: string | null; effort?: string | null}
/** config.yaml `supervisor`. */
export interface SupervisorBlock {
  mode?: 'chat' | 'kernel' | null; pollIntervalMs?: number | null; repos?: string[] | null; stallMinutes?: number | null; kernel?: AgentSeat | null;
  workers?: {base?: number; max?: number} | null; landGate?: {mode?: 'shared' | 'exclusive'; push?: boolean} | null; frozenMinutes?: number | null;
}
/** config.yaml `delegation`. */
export interface DelegationBlock {asks: string; until: string; excludes?: string[]; note?: string}
/** config.yaml `connectors.cloudflare`. */
export interface CloudflareConfig {mode?: string; tunnel?: string | null; credentialsFile?: string | null; tokenEnv?: string; hostname?: string | null; access?: boolean}
/** config.yaml `connectors.telegram`. */
export interface TelegramConfig {enabled?: boolean; botTokenEnv?: string; chatId?: number | string | null; exposeCredentialAsks?: boolean}
/** config.yaml `connectors`. */
export interface ConnectorsBlock {repos?: string[]; gateway?: {port?: number}; cloudflare?: CloudflareConfig; telegram?: TelegramConfig}
/** config.yaml `asks`. */
export interface AsksBlock {autoAcceptRecommended?: boolean; excludes?: string[] | null}
/** config.yaml `uat`. */
export interface UatBlock {maxConcurrent?: number | null}
/** config.yaml `specs`. */
export interface SpecsBlock {unit?: boolean; e2e?: boolean}
/** config.yaml `reconciler`. */
export interface ReconcilerBlock {enabled?: boolean; profile?: 'operational' | 'observe' | null; controllers?: Record<string, {mode: 'off' | 'shadow' | 'active'}> | null}
/** config.yaml `debugLoop`. */
export interface DebugLoopBlock {interval?: string; worktreeLimit?: number}
/** The validated owner config (config.yaml, or the shipped config.example.yaml): every block optional but the root keys. */
export interface OwnerConfig {
  language: string; model: string | null; effort: string;
  models?: ModelsBlock | null; allocation?: {grants?: string[] | null} | null; kernel?: AgentSeat | null; budgets?: {maxOps?: number | null} | null;
  supervisor?: SupervisorBlock | null; parallel?: {gear: number} | null; delegation?: DelegationBlock | null; connectors?: ConnectorsBlock | null;
  asks?: AsksBlock | null; uat?: UatBlock | null; specs?: SpecsBlock | null; reconciler?: ReconcilerBlock | null; debugLoop?: DebugLoopBlock | null;
  orca?: OrcaBlock | null; roots?: RootsBlock | null; resources?: ResourcesBlock | null; sonar?: SonarBlock | null; release?: ReleaseBlock | null;
  launchTrust?: OwnerProfile | null; retention?: {workflowPurge?: OwnerProfile | null} | null;
}

export const configRoot=skillRoot;
/** The owner-facing language when config.yaml `language` is absent — the one default every reader shares (scripts/lib/i18n.mjs ownerLanguage). A base-tier value: machine (home.mjs) re-exports it, not the reverse. */
export const DEFAULT_OWNER_LANGUAGE='en';
// Parsed once per file version (mtime + size) per process; each caller gets its own copy.
// The one runtimes.yaml loader: it throws on a missing or unparsable file, so no caller ever
// reasons on a silent empty document. The pool map (provider, roles, models, maxParallel)
// lives in the ONE model catalog — modules/models/registry.yaml `pools` — and is merged in
// under `runtimes` so consumers read the same shape as before.
let runtimeProfileCache: {version: string; profile: RuntimeProfile} | null=null;
export function runtimeProfile(): RuntimeProfile{
  const source=fileURLToPath(new URL('../modules/models/runtimes.yaml',import.meta.url));
  const registryFile=fileURLToPath(new URL('../modules/models/registry.yaml',import.meta.url));
  let stat;try{stat=fs.statSync(source);}catch{throw new Error('Missing modules/models/runtimes.yaml');}
  let rstat;try{rstat=fs.statSync(registryFile);}catch{throw new Error('Missing modules/models/registry.yaml');}
  const version=`${stat.mtimeMs}:${stat.size}:${rstat.mtimeMs}:${rstat.size}`;
  if(runtimeProfileCache?.version!==version){
    const doc=parseYaml(fs.readFileSync(source,'utf8'));
    const registry=parseYaml(fs.readFileSync(registryFile,'utf8'));
    runtimeProfileCache={version,profile:{...doc,runtimes:registry?.pools??{},models:registry?.models??{}}};
  }
  return structuredClone(runtimeProfileCache.profile);
}
/**
 * modules/models/runtimes.yaml `allocation` — where the workers' operating numbers live: the dispatch lease
 * TTL, the liveness and cadence windows, the slicing weights, the failure cooldowns. Code reads them from
 * here; a literal copy of any of them in a source file would be a second authority.
 */
export function allocationSettings(): AllocationSettings{
  const allocation=runtimeProfile()?.allocation??{};
  return allocation.admission?{...allocation,admission:{...allocation.admission,...shippedTiers().usage}}:allocation;
}
// These are current owner declarations, never a historical runtime owner's consent.
function validateOwnerProfile(value: unknown,name: string,pathsKey: string): asserts value is OwnerProfile | null{
  if(value===null)return;
  const bad: Bad=invalid(name);
  if(!plain(value))bad(' must be an owner approval mapping or null.');
  const keys=new Set(['approvedBy','approvalRef',pathsKey,...(name==='launchTrust'?['profile']:[])]);
  for(const key of Object.keys(value))if(!keys.has(key))bad(` has unknown key ${key}.`);
  if(value.approvedBy!=='owner')bad('.approvedBy must be owner; adoption must come from the current owner.');
  if(typeof value.approvalRef!=='string'||!value.approvalRef.trim())bad('.approvalRef must identify the current owner approval.');
  if(name==='launchTrust'&&!(typeof value.profile==='string'&&['automatic','declined'].includes(value.profile)))bad('.profile must be automatic or declined.');
  const paths=value[pathsKey];
  if(!Array.isArray(paths)||!paths.length||paths.some((p: unknown)=>typeof p!=='string'||!(path.isAbsolute(p)||path.win32.isAbsolute(p))||/[\r\n\0]/.test(p)))bad(`.${pathsKey} must list exact absolute repository roots.`);
}
export function launchTrustSettings(config: {launchTrust?: unknown} | null | undefined=loadConfig()): OwnerProfile | null{
  const value=config?.launchTrust??null;validateOwnerProfile(value,'launchTrust','roots');return value;
}
export function workflowPurgeSettings(config: {retention?: unknown} | null | undefined=loadConfig()): OwnerProfile | null{
  const retention=config?.retention??null;
  if(retention===null)return null;
  const bad: Bad=invalid('retention');
  if(!plain(retention)||Object.keys(retention).some(k=>k!=='workflowPurge'))bad(' must be {workflowPurge?} or null.');
  const value=retention.workflowPurge??null;validateOwnerProfile(value,'retention.workflowPurge','repos');return value;
}
/** One positive millisecond value out of `allocation`, by dotted key. Refuses when the contract omits it. */
export function allocationMs(dotted: string): number{
  const raw=dotted.split('.').reduce<unknown>((node,key)=>(node==null?node:(node as Record<string, unknown>)[key]),allocationSettings());
  const value=Number(raw);
  if(!Number.isFinite(value)||value<=0)throw new Error(`modules/models/runtimes.yaml allocation.${dotted} must declare a positive number of milliseconds`);
  return value;
}
/**
 * modules/models/runtimes.yaml allocation.slicing.gears — the declared gear vocabulary. A gear is an
 * index into allocation.slicing.size.<class>.agents, so the two lists are one authority; code never
 * carries a literal gear. Refuses when the contract omits the list or spells it with a non-integer.
 */
export function slicingGears(): number[]{
  const gears=allocationSettings()?.slicing?.gears;
  if(!Array.isArray(gears)||!gears.length||gears.some(value=>!Number.isInteger(value)||value<1))
    throw new Error('modules/models/runtimes.yaml allocation.slicing.gears must declare a non-empty list of positive integers');
  return [...gears];
}
/** The gear an absent `parallel` block means. The first declared gear, never a literal. */
export const defaultParallelGear=(): number=>slicingGears()[0] as number;
/** The owner's parallelism gear: config.yaml `parallel.gear`, or the first declared gear when absent. */
export function parallelGear(config: OwnerConfig | null | undefined=loadConfig()): number{
  validateConfig(config);
  return config?.parallel?.gear??defaultParallelGear();
}
/**
 * config.yaml `connectors` — the owner's public ask channel (docs/connectors.md). Everything defaults off.
 * Secrets never live here: `tokenEnv`/`botTokenEnv` NAME the environment variable holding the secret
 * (or `<NAME>_FILE` pointing at a custody file); a value that is not an env var name is refused, so a
 * pasted token fails closed instead of landing in a plain-text file.
 */
const CLOUDFLARE_MODES=['off','quick','named'];
/** The serve-ask port band, both ends included (scripts/kernel/ask-server.mjs scans [first..last]); the gateway stays outside it. */
export const ASK_PORT_BAND: readonly [number, number]=[6969,7069];
/** The settings of config.yaml `connectors.cloudflare` once defaults are filled in. */
export interface CloudflareSettings {mode: string; tunnel: string | null; credentialsFile: string | null; tokenEnv: string; hostname: string | null; access: boolean}
/** The settings of config.yaml `connectors.telegram` once defaults are filled in. */
export interface TelegramSettings {enabled: boolean; botTokenEnv: string; chatId: string | number | null; exposeCredentialAsks: boolean}
/** The normalized cloudflare connector: the secrets' presence and the derived auth and public base. */
export interface CloudflareState extends CloudflareSettings {tokenPresent: boolean; credentialsPresent: boolean; auth: 'credentials-file' | 'token' | null; publicBase: string | null}
/** The normalized telegram connector. */
export interface TelegramState extends TelegramSettings {chatId: string | null; botTokenPresent: boolean; configured: boolean}
/** The normalized `connectors` block. */
export interface ConnectorsConfig {repos: string[]; gateway: {port: number}; cloudflare: CloudflareState; telegram: TelegramState; warnings: string[]}
export const CONNECTOR_DEFAULTS: Readonly<{repos: string[]; gateway: {port: number}; cloudflare: CloudflareSettings; telegram: TelegramSettings}>=Object.freeze({
  repos:[],
  gateway:{port:7070},
  cloudflare:{mode:'off',tunnel:null,credentialsFile:null,tokenEnv:'CLOUDFLARE_TUNNEL_TOKEN',hostname:null,access:false},
  telegram:{enabled:false,botTokenEnv:'TELEGRAM_BOT_TOKEN',chatId:null,exposeCredentialAsks:false},
});
const HOSTNAME=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const TUNNEL_REF=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CHAT_ID=/^(?:-?\d{1,20}|@[A-Za-z]\w{4,31})$/;
const SECRET_KEYS=new Set(['token','tunnelToken','botToken','secret','apiToken','password']);
function closedConnectorShape(bad: Bad,node: unknown,where: string,keys: readonly string[]): asserts node is Record<string, unknown>{
  if(!plain(node))bad(`.${where} must be a mapping.`);
  for(const key of Object.keys(node)){
    if(SECRET_KEYS.has(key))bad(`.${where}.${key}: secrets never live in config.yaml — set the environment variable the *Env key names instead.`);
    if(!keys.includes(key))bad(`.${where} has unknown key ${key} (allowed: ${keys.join(', ')}).`);
  }
}
const connectorEnvName=(bad: Bad,where: string,value: unknown): void=>{if(value!==undefined&&(typeof value!=='string'||!ENV_NAME.test(value)))bad(`.${where} must name an environment variable (UPPER_SNAKE), never hold the secret itself.`);};
const validateCloudflareMode=(cf: Record<string, unknown>,bad: Bad): void=>{if(cf.mode!==undefined&&(typeof cf.mode!=='string'||!CLOUDFLARE_MODES.includes(cf.mode)))bad(`.cloudflare.mode must be one of ${CLOUDFLARE_MODES.join(' | ')}.`);};
const validateCloudflareDetails=(cf: Record<string, unknown>,bad: Bad): void=>{
  if(cf.hostname!==undefined&&cf.hostname!==null&&(typeof cf.hostname!=='string'||!HOSTNAME.test(cf.hostname)))bad('.cloudflare.hostname must be a bare hostname (no scheme, no path) or null.');
  if(cf.access!==undefined&&typeof cf.access!=='boolean')bad('.cloudflare.access must be true or false.');
  if(cf.tunnel!==undefined&&cf.tunnel!==null&&(typeof cf.tunnel!=='string'||!TUNNEL_REF.test(cf.tunnel)))bad('.cloudflare.tunnel must be the named tunnel UUID (or name) or null.');
  if(cf.credentialsFile!==undefined&&cf.credentialsFile!==null&&(typeof cf.credentialsFile!=='string'||!cf.credentialsFile.trim()))bad('.cloudflare.credentialsFile must be the tunnel credentials JSON path or null.');
};
const validateCloudflareModeConstraints=(cf: Record<string, unknown>,bad: Bad): void=>{if(cf.credentialsFile&&!cf.tunnel){bad('.cloudflare.credentialsFile needs cloudflare.tunnel (the tunnel UUID the credentials belong to).');}if(cf.mode==='named'&&!cf.hostname){bad('.cloudflare.mode named needs cloudflare.hostname (the public hostname routed to the gateway).');}if(cf.mode==='quick'&&(cf.tunnel||cf.credentialsFile)){bad('.cloudflare.mode quick runs no named tunnel; tunnel/credentialsFile are for mode named.');}if(cf.mode==='quick'&&cf.hostname){bad('.cloudflare.mode quick gets a random trycloudflare.com hostname; set hostname only for mode named.');}};
const validateCloudflareConnector=(cf: unknown): void=>{
  const bad: Bad=invalid('connectors');
  closedConnectorShape(bad,cf,'cloudflare',['mode','tunnel','credentialsFile','tokenEnv','hostname','access']);
  validateCloudflareMode(cf,bad);
  connectorEnvName(bad,'cloudflare.tokenEnv',cf.tokenEnv);
  validateCloudflareDetails(cf,bad);
  validateCloudflareModeConstraints(cf,bad);
};
const validateTelegramConnector=(tg: unknown): void=>{
  const bad: Bad=invalid('connectors');
  closedConnectorShape(bad,tg,'telegram',['enabled','botTokenEnv','chatId','exposeCredentialAsks']);
  if(tg.enabled!==undefined&&typeof tg.enabled!=='boolean')bad('.telegram.enabled must be true or false.');
  connectorEnvName(bad,'telegram.botTokenEnv',tg.botTokenEnv);
  if(tg.chatId!==undefined&&tg.chatId!==null&&!((Number.isSafeInteger(tg.chatId))||(typeof tg.chatId==='string'&&CHAT_ID.test(tg.chatId))))
    bad('.telegram.chatId must be a numeric chat id, an @channel name, or null.');
  if(tg.exposeCredentialAsks!==undefined&&typeof tg.exposeCredentialAsks!=='boolean')bad('.telegram.exposeCredentialAsks must be true or false.');
  if(tg.enabled===true&&(tg.chatId===undefined||tg.chatId===null))bad('.telegram.enabled needs telegram.chatId.');
};
function validateConnectors(connectors: unknown): void{
  if(connectors===null)return;
  const bad: Bad=invalid('connectors');
  if(!plain(connectors))bad(' must be {repos?, gateway?, cloudflare?, telegram?} or null.');
  closedConnectorShape(bad,connectors,'',['repos','gateway','cloudflare','telegram']);
  if(connectors.repos!==undefined&&(!Array.isArray(connectors.repos)||connectors.repos.some(repo=>typeof repo!=='string'||!repo.trim())))bad('.repos must be a list of repository paths.');
  if(connectors.gateway!==undefined){
    closedConnectorShape(bad,connectors.gateway,'gateway',['port']);
    const port=connectors.gateway.port;
    if(port!==undefined&&(typeof port!=='number'||!Number.isInteger(port)||port<1024||port>65535||(port>=ASK_PORT_BAND[0]&&port<=ASK_PORT_BAND[1])))
      bad(`.gateway.port must be an integer port in 1024..65535 outside the serve-ask band ${ASK_PORT_BAND.join('..')}.`);
  }
  if(connectors.cloudflare!==undefined)validateCloudflareConnector(connectors.cloudflare);
  if(connectors.telegram!==undefined)validateTelegramConnector(connectors.telegram);
}
/**
 * The normalized `connectors` block: defaults filled in, the secrets' PRESENCE (booleans, never values),
 * whether each connector is ready to run, and the owner-facing warnings the security posture earns.
 */
const connectorWarnings=(cloudflare: CloudflareState,telegram: TelegramState): string[]=>{
  const warnings: string[]=[];
  if(cloudflare.mode==='quick')warnings.push('cloudflare.mode quick: the ask link is public and unauthenticated — anyone holding the URL can open and answer the form; the hostname changes on every restart.');
  if(cloudflare.mode==='named'&&!cloudflare.access)warnings.push(`cloudflare.access is false: ${cloudflare.hostname} is not fronted by Cloudflare Access, so the nonce URL is the only credential.`);
  if(cloudflare.auth==='credentials-file'&&!cloudflare.credentialsPresent)warnings.push(`cloudflare.credentialsFile ${cloudflare.credentialsFile} does not exist.`);
  if(cloudflare.auth==='token'&&!cloudflare.tokenPresent)warnings.push(`cloudflare.mode named: the tunnel token is not set — export ${cloudflare.tokenEnv} (or ${cloudflare.tokenEnv}_FILE).`);
  if(telegram.enabled&&!telegram.botTokenPresent)warnings.push(`telegram.enabled: the bot token is not set — export ${telegram.botTokenEnv} (or ${telegram.botTokenEnv}_FILE).`);
  if(telegram.exposeCredentialAsks)warnings.push('telegram.exposeCredentialAsks is true: credential asks are posted as public links; Telegram cloud chats are not end-to-end encrypted.');
  return warnings;
};
export function connectorsConfig(config: OwnerConfig | null | undefined=loadConfig(),env: NodeJS.ProcessEnv=process.env,root: string=configRoot): ConnectorsConfig{
  validateConfig(config);
  const raw: ConnectorsBlock=plain(config?.connectors)?config.connectors:{},d=CONNECTOR_DEFAULTS;
  const cloudflare: CloudflareState={...d.cloudflare,...raw.cloudflare,tokenPresent:false,credentialsPresent:false,auth:null,publicBase:null};
  const telegram: TelegramState={...d.telegram,...raw.telegram,chatId:null,botTokenPresent:false,configured:false};
  const chatId=raw.telegram?.chatId??d.telegram.chatId;
  if(cloudflare.credentialsFile)cloudflare.credentialsFile=path.resolve(root,cloudflare.credentialsFile.replace(/^~(?=[\\/])/,env.USERPROFILE??env.HOME??'~'));
  cloudflare.tokenPresent=connectorSecret(cloudflare.tokenEnv,env)!==null;
  cloudflare.credentialsPresent=Boolean(cloudflare.credentialsFile&&fs.existsSync(cloudflare.credentialsFile));
  const namedAuth=cloudflare.credentialsFile?'credentials-file':'token';
  cloudflare.auth=cloudflare.mode==='named'?namedAuth:null;
  cloudflare.publicBase=cloudflare.mode==='named'?`https://${cloudflare.hostname}`:null;
  telegram.chatId=chatId===null?null:String(chatId);
  telegram.botTokenPresent=connectorSecret(telegram.botTokenEnv,env)!==null;
  telegram.configured=telegram.enabled===true&&telegram.chatId!==null&&telegram.botTokenPresent;
  return {repos:[...(raw.repos??d.repos)],gateway:{...d.gateway,...raw.gateway},cloudflare,telegram,warnings:connectorWarnings(cloudflare,telegram)};
}
/**
 * config.yaml `asks` — whether an owner ask that carries a recommended option is answered with it
 * instead of being served (scripts/kernel/ask-server.mjs autoAcceptAsk). `excludes` names the ask classes
 * that always reach the owner: `credential` (secret fields, or kind credential/account/access/consent),
 * `handover` (every handover.review ask — excluded even when the owner drops it from the list),
 * `draw-review` (the opt-out: an interface.draw drawing review the owner did not ask for is otherwise
 * accepted without the owner) and any ask kind of modules/ops/ops/provision.ask.yaml.
 */
export const ASK_KINDS=Object.freeze(['information','credential','account','access','consent','authority','business-decision','irreversible-confirmation']);
const ASK_EXCLUDE_CLASSES=Object.freeze([...ASK_KINDS,'handover','draw-review']);
export const ASKS_DEFAULTS=Object.freeze({autoAcceptRecommended:false,excludes:Object.freeze(['credential','irreversible-confirmation','handover'])});
const validateAskExcludes=(bad: Bad,excludes: unknown): void=>{
  if(!Array.isArray(excludes))bad(`.excludes must be a list of ask classes (${ASK_EXCLUDE_CLASSES.join(', ')}).`);
  for(const entry of excludes)if(typeof entry!=='string'||!ASK_EXCLUDE_CLASSES.includes(entry))bad(`.excludes entry ${JSON.stringify(entry)} is not an ask class (${ASK_EXCLUDE_CLASSES.join(', ')}).`);
  if(new Set(excludes).size!==excludes.length)bad('.excludes names each class once.');
};
function validateAsks(asks: unknown): void{
  if(asks===null)return;
  const bad: Bad=invalid('asks');
  if(!plain(asks))bad(' must be {autoAcceptRecommended?, excludes?} or null.');
  for(const key of Object.keys(asks))if(!CONFIG_KEY_TREE.asks.includes(key))bad(` has unknown key ${key} (allowed: ${CONFIG_KEY_TREE.asks.join(', ')}).`);
  if(asks.autoAcceptRecommended!==undefined&&typeof asks.autoAcceptRecommended!=='boolean')bad('.autoAcceptRecommended must be true or false.');
  const excludes=asks.excludes;
  if(excludes!==undefined&&excludes!==null)validateAskExcludes(bad,excludes);
}
/**
 * config.yaml `uat` — the machine-wide UAT ceiling: at most `maxConcurrent` UAT runs (browsers, players,
 * the apps they drive) execute at once on this host; the rest queue for a slot (scripts/uat/uat-slots.mjs).
 */
export const UAT_DEFAULTS=Object.freeze({maxConcurrent:10});
function validateUat(uat: unknown): void{
  if(uat===null)return;
  const bad: Bad=invalid('uat');
  if(!plain(uat))bad(' must be {maxConcurrent?} or null.');
  for(const key of Object.keys(uat))if(!CONFIG_KEY_TREE.uat.includes(key))bad(` has unknown key ${key} (allowed: ${CONFIG_KEY_TREE.uat.join(', ')}).`);
  if(uat.maxConcurrent!==undefined&&uat.maxConcurrent!==null&&!(typeof uat.maxConcurrent==='number'&&Number.isInteger(uat.maxConcurrent)&&uat.maxConcurrent>=1))bad('.maxConcurrent must be a positive integer (default 10) or null.');
}
/** The owner's UAT concurrency settings: {maxConcurrent, source}. An absent or null block is the default. */
export function uatSettings(config: {uat?: UatBlock | null} | null | undefined=loadConfig()): {maxConcurrent: number; source: 'uat' | 'default'}{
  if(config?.uat!==undefined)validateUat(config.uat);
  const value=plain(config?.uat)?config.uat.maxConcurrent:null;
  return typeof value==='number'&&Number.isInteger(value)?{maxConcurrent:value,source:'uat'}:{maxConcurrent:UAT_DEFAULTS.maxConcurrent,source:'default'};
}
/**
 * config.yaml `allocation` — {grants?}: ['<pool>=<slots>@<role>+<role>'], the owner's default grant, applied to every
 * workflow, that opens a capacityAuthority explicit-workflow-quota pool (Devin) for those roles up to <slots> running jobs.
 */
const GRANT=/^([a-z0-9][a-z0-9.-]*)=(\d+)@([a-z]+(?:\+[a-z]+)*)$/;
/** One grant string `<pool>=<slots>@<role>+<role>` as {pool, slots, roles}, or null when it is not that shape. */
/** The closed set of top-level config.yaml blocks: the validator accepts these and refuses every other key. */
const CONFIG_BLOCKS=Object.freeze(['language','model','effort','models','allocation','kernel','budgets','supervisor','parallel','delegation','connectors','asks','uat','specs','reconciler','debugLoop','orca','roots','resources','sonar','release','launchTrust','retention']);
/** One allocation grant `<pool>=<slots>@<role>+<role>`, parsed. */
export interface AllocationGrant {pool: string; slots: number; roles: string[]}
function parseAllocationGrant(text: unknown): AllocationGrant | null{
  const m=typeof text==='string'?GRANT.exec(text.trim()):null;
  return m?{pool:m[1] as string,slots:Number(m[2]),roles:(m[3] as string).split('+')}:null;
}
const validateGrant=(bad: Bad,text: unknown,runtimes: Record<string, RuntimePool>,seen: Set<string>): void=>{
  const grant=parseAllocationGrant(text);
  if(!grant)bad(`grants entry ${JSON.stringify(text)} is not "<pool>=<slots>@<role>+<role>" (e.g. devin-agent=10@implement+verify+write).`);
  const runtime=runtimes[grant.pool];
  if(!plain(runtime))bad(`grants entry ${text}: ${grant.pool} is not a modules/models/registry.yaml pool.`);
  if(seen.has(grant.pool)){bad(`grants names ${grant.pool} more than once.`);} seen.add(grant.pool);
  const max=Number(runtime.maxParallel); if(!(grant.slots>=1&&(!Number.isFinite(max)||grant.slots<=max)))bad(`grants entry ${text}: slots must be 1..${Number.isFinite(max)?max:'maxParallel'} (registry.yaml maxParallel).`);
  const unserved=grant.roles.filter(role=>!(runtime.roles??[]).includes(role)); if(unserved.length)bad(`grants entry ${text}: ${grant.pool} does not serve role ${unserved.join(', ')} (registry.yaml roles: ${(runtime.roles??[]).join(', ')}).`);
};
const validateGrants=(bad: Bad,grants: unknown,runtimes: Record<string, RuntimePool>): void=>{
  if(!Array.isArray(grants))bad('grants must be a list of "<pool>=<slots>@<role>+<role>" strings.');
  const seen=new Set<string>();
  for(const text of grants)validateGrant(bad,text,runtimes,seen);
};
function validateAgentSeat(seat: unknown,name: string,profile: RuntimeProfile | null | undefined): void{
  const runtimes=profile?.runtimes??{},knownProviders=new Set(Object.values(runtimes).map(runtime=>runtime?.provider).filter((provider): provider is string=>Boolean(provider)));
  if(!plain(seat)||Object.keys(seat).some(key=>!SEAT_KEYS.includes(key))||Object.values(seat).some(value=>value!==null&&(typeof value!=='string'||!value.trim())))
    throw new Error(`Invalid config.yaml: ${name} must be {agent?, model?, effort?} with string-or-null values (agent and model pin the seat: an \`only\` bias).`);
  if(typeof seat.agent==='string'&&!knownProviders.has(seat.agent))throw new Error(`Invalid config.yaml: ${name}.agent ${seat.agent} is not declared by a runtime (known: ${knownNames(knownProviders)}).`);
  if(seat.effort!==undefined&&seat.effort!==null&&!(typeof seat.effort==='string'&&EFFORT_LEVELS.has(seat.effort)))throw new Error(`Invalid config.yaml: ${name}.effort must use the effort vocabulary.`);
}
const validateReconcilerBlock=(r: unknown): void=>{
  const ctl=plain(r)?r.controllers:undefined;
  if(!plain(r)||Object.keys(r).some(key=>!CONFIG_KEY_TREE.reconciler.includes(key))||(r.enabled!==undefined&&typeof r.enabled!=='boolean')||!(r.profile===undefined||r.profile===null||(typeof r.profile==='string'&&['operational','observe'].includes(r.profile)))||!(ctl===undefined||ctl===null||(plain(ctl)&&Object.entries(ctl).every(([name,c])=>/^[a-z][a-z0-9-]*$/.test(name)&&plain(c)&&Object.keys(c).every(key=>key==='mode')&&typeof c.mode==='string'&&['off','shadow','active'].includes(c.mode)))))
    throw new Error('Invalid config.yaml: reconciler must be {enabled?: boolean, profile?: operational|observe, controllers?: {<name>: {mode: off|shadow|active}}}, or null.');
};
const validateAllocationBlock=(allocation: unknown,runtimes: Record<string, RuntimePool>): void=>{
  if(!plain(allocation)||Object.keys(allocation).some(key=>!CONFIG_KEY_TREE.allocation.includes(key)))
    throw new Error('Invalid config.yaml: allocation must be {grants?: [<pool>=<slots>@<role>+<role>]}.');
  if(allocation.grants!==undefined&&allocation.grants!==null)validateGrants(invalid('allocation.'),allocation.grants,runtimes);
};
const validateParallelBlock=(parallel: unknown): void=>{
  const gears=slicingGears();
  if(!plain(parallel)||Object.keys(parallel).some(key=>!CONFIG_KEY_TREE.parallel.includes(key))||typeof parallel.gear!=='number'||!Number.isInteger(parallel.gear))
    throw new Error('Invalid config.yaml: parallel must be {gear: <integer>}.');
  if(!gears.includes(parallel.gear))
    throw new Error(`Invalid config.yaml: parallel.gear ${parallel.gear} is not declared by modules/models/runtimes.yaml allocation.slicing.gears (known: ${gears.join(', ')}).`);
};
const validateSupervisorBlock=(supervisor: unknown,profile: RuntimeProfile | null | undefined): void=>{
  const fields: Record<string, unknown>=plain(supervisor)?supervisor:{};
  const interval=fields.pollIntervalMs,repos=fields.repos,stall=fields.stallMinutes;
  if(!plain(supervisor)||Object.keys(supervisor).some(key=>!CONFIG_KEY_TREE.supervisor.includes(key))||!(interval===null||interval===undefined||(typeof interval==='number'&&Number.isInteger(interval)&&interval>=60000)))
    throw new Error('Invalid config.yaml: supervisor must be {mode?, pollIntervalMs?, repos?, stallMinutes?, kernel?, workers?, landGate?, frozenMinutes?} with an integer of at least 60000 ms, or null.');
  // mode: where the Supervisor role runs - chat (default: the owner's desktop
  // chat session owns channel 'main' and ticks itself) or kernel (the optional [Supervisor] Orca kernel, start-supervisor.mjs).
  if(!(supervisor.mode===undefined||supervisor.mode===null||typeof supervisor.mode==='string'&&['chat','kernel'].includes(supervisor.mode)))
    throw new Error('Invalid config.yaml: supervisor.mode must be chat or kernel, or null.');
  // The [Supervisor] kernel seat: kernel {agent?, model?, effort?}
  // pins its agent (default: the kernel pin), workers {base?, max?} its adaptive [Worker] cap (0 to 10; the shipped default is 0 fix workers),
  // landGate {mode?: shared|exclusive, push?: boolean} the land gate (scripts/supervisor/land.mjs); push (default true, owner ruling push-main-after-scoped-check) lets `starci release push` send main to the remote after a green scoped check, false is the owner's lock on the remote.
  const seat=supervisor.kernel,workers=supervisor.workers,gate=supervisor.landGate;
  if(seat!==undefined&&seat!==null)validateAgentSeat(seat,'supervisor.kernel',profile);
  if(!(workers===undefined||workers===null||(plain(workers)&&Object.keys(workers).every(key=>{const n=workers[key];return ['base','max'].includes(key)&&typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=10;}))))
    throw new Error('Invalid config.yaml: supervisor.workers must be {base?, max?} integers from 0 to 10, or null.');
  if(!(gate===undefined||gate===null||(plain(gate)&&Object.keys(gate).every(key=>(key==='mode'&&typeof gate.mode==='string'&&['shared','exclusive'].includes(gate.mode))||(key==='push'&&typeof gate.push==='boolean')))))
    throw new Error('Invalid config.yaml: supervisor.landGate must be {mode?: shared|exclusive, push?: boolean}, or null.');
  // stallMinutes: scripts/supervisor/stall.mjs calls a running workflow STALLED after this many minutes with no progress.
  // frozenMinutes: scripts/supervisor/supervisor-watchdog.mjs reads a busy seat frame with no turn progress for this long as frozen.
  const frozen=supervisor.frozenMinutes;
  if(!(frozen===undefined||frozen===null||(typeof frozen==='number'&&Number.isInteger(frozen)&&frozen>=1)))
    throw new Error('Invalid config.yaml: supervisor.frozenMinutes must be an integer of at least 1, or null.');
  if(!(stall===undefined||stall===null||(typeof stall==='number'&&Number.isInteger(stall)&&stall>=5)))
    throw new Error('Invalid config.yaml: supervisor.stallMinutes must be an integer of at least 5, or null.');
  if(!(repos===undefined||repos===null||(Array.isArray(repos)&&repos.every(repo=>typeof repo==='string'&&repo.trim()))))
    throw new Error('Invalid config.yaml: supervisor.repos must be a list of ledger-owner repository paths, or null.');
};
const validateDelegationBlock=(d: unknown): void=>{if(!plain(d)||Object.keys(d).some(key=>!CONFIG_KEY_TREE.delegation.includes(key))||typeof d.asks!=='string'||!d.asks.trim()||typeof d.until!=='string'||Number.isNaN(Date.parse(d.until))||(d.excludes!==undefined&&(!Array.isArray(d.excludes)||d.excludes.some(x=>typeof x!=='string'))))throw new Error('Invalid config.yaml: delegation must be {asks: <delegate>, until: <ISO time>, excludes?: [<class>], note?} or null.');};
const validateBudgetsBlock=(budgets: unknown): void=>{if(!plain(budgets)||Object.keys(budgets).some(key=>!CONFIG_KEY_TREE.budgets.includes(key))||Object.values(budgets).some(value=>value!==null&&!(typeof value==='number'&&Number.isInteger(value)&&value>0)))throw new Error('Invalid config.yaml: budgets must be {maxOps?} with positive-integer-or-null values.');};
function validateRootKeys(config: unknown): asserts config is OwnerConfig{
  const allowed=new Set(CONFIG_BLOCKS);
  if(!plain(config)||Object.keys(config).some(key=>!allowed.has(key))||typeof config.language!=='string'||!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(config.language)||!(config.model===null||typeof config.model==='string'&&config.model.trim())||!(typeof config.effort==='string'&&EFFORT_LEVELS.has(config.effort)))
    throw new Error('Invalid config.yaml: expected language, model, effort and the closed set of config blocks.');
}
const validateEarlyConfigBlocks=(config: unknown): void=>{
  const blocks: Record<string, unknown>=plain(config)?config:{};
  if(blocks.launchTrust!==undefined){launchTrustSettings(blocks);} if(blocks.retention!==undefined){workflowPurgeSettings(blocks);}
  if(blocks.connectors!==undefined){validateConnectors(blocks.connectors);} if(blocks.asks!==undefined){validateAsks(blocks.asks);}
  if(blocks.uat!==undefined){validateUat(blocks.uat);} if(blocks.debugLoop!==undefined){validateDebugLoop(blocks.debugLoop);}
  if(blocks.orca!==undefined){validateOrca(blocks.orca);} if(blocks.roots!==undefined){validateRoots(blocks.roots);} if(blocks.resources!==undefined){validateResources(blocks.resources);} if(blocks.sonar!==undefined){validateSonar(blocks.sonar);} if(blocks.release!==undefined){validateRelease(blocks.release);}
};
const validateConfigBlocks=(config: unknown,_knownProviders: ReadonlySet<string>,runtimes: Record<string, RuntimePool>,profile: RuntimeProfile): void=>{
  const blocks: Record<string, unknown>=plain(config)?config:{};
  // specs (owner 2026-09-28): {unit?, e2e?} booleans - each family a boolean; absent = its default (SPEC_DEFAULTS: unit on, e2e off; specsSettings).
  const specs=blocks.specs;
  if(specs!==undefined&&specs!==null&&(!plain(specs)||Object.keys(specs).some(key=>!CONFIG_KEY_TREE.specs.includes(key)||typeof specs[key]!=='boolean')))throw new Error(`Invalid config.yaml: specs must be {${SPEC_FAMILIES.map(k=>k+'?: boolean').join(', ')}}, or null.`);
  // reconciler (scripts/reconciler/state.mjs reconcilerConfig): {enabled?: boolean, profile?: operational|observe, controllers?: {<name>: {mode: off|shadow|active}}}, or null.
  if(blocks.reconciler!==undefined&&blocks.reconciler!==null){validateReconcilerBlock(blocks.reconciler);} if(blocks.allocation!==undefined){validateAllocationBlock(blocks.allocation,runtimes);}
  if(blocks.kernel!==undefined){validateAgentSeat(blocks.kernel,'kernel',profile);} if(blocks.parallel!==undefined){validateParallelBlock(blocks.parallel);}
  if(blocks.supervisor!==undefined){validateSupervisorBlock(blocks.supervisor,profile);} if(blocks.delegation!==undefined&&blocks.delegation!==null){validateDelegationBlock(blocks.delegation);} if(blocks.budgets!==undefined){validateBudgetsBlock(blocks.budgets);}
};
/** Validates a parsed config.yaml against the closed schema and returns it as the owner config; throws `Invalid config.yaml: ...` otherwise. */
export function validateConfig(config: unknown): OwnerConfig{
  const profile=runtimeProfile(),runtimes=profile?.runtimes??{};
  refuseRemovedKeys(config);
  validateEarlyConfigBlocks(config);
  const knownProviders=new Set(Object.values(runtimes).map(runtime=>runtime?.provider).filter((provider): provider is string=>Boolean(provider)));
  validateConfigBlocks(config,knownProviders,runtimes,profile);
  validateRootKeys(config);
  validateModelsBlock(config,profile);
  return config;
}
/**
 * The owner allocation control: `allocation.grants` only. null = the owner declared no grants list: grant-gated pools
 * keep their ungated routing; a declared list, even [], is the whole set of grants.
 */
export function configuredAllocationPolicy(config: OwnerConfig=loadConfig()): {grants: Record<string, {slots: number; roles: string[]}> | null; source: 'allocation' | 'default'}{
  validateConfig(config);
  const allocation=plain(config.allocation)?config.allocation:null;
  const grants=Array.isArray(allocation?.grants)
    ?Object.fromEntries(allocation.grants.map(parseAllocationGrant).map(grant=>{const {pool,slots,roles}=grant as AllocationGrant;return [pool,{slots,roles}] as const;}))
    :null;
  return {grants,source:allocation?'allocation':'default'};
}
/** The variable that confines the owner's `config.yaml` to a directory tree: set, an owner file is read only from under that directory (e2e/setup/isolated-temp.mjs points it at a spec's own temp root). */
const OWNER_CONFIG_WITHIN_ENV='STARCI_OWNER_CONFIG_WITHIN';
const foldPath=(p: string): string=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
/**
 * Whether the owner's `config.yaml` under `root` is visible to this process. Unconfined (the variable unset) every owner file is visible; confined, only the files under the named
 * directory, where a fixture wrote them, so the checkout's live file (roots.temp, supervisor.landGate, launch trust) never decides a result and a lane clone, the release host and a
 * clean checkout run the same suite. The engine knows nothing of why a caller confines it: the spec preload sets the variable.
 */
const ownerFileVisible=(root: string,env: NodeJS.ProcessEnv=process.env): boolean=>{
  const within=env[OWNER_CONFIG_WITHIN_ENV];
  if(!within)return true;
  const rel=path.relative(foldPath(within),foldPath(root));
  return !rel.startsWith('..')&&!path.isAbsolute(rel);
};
/** The validated config one yaml file holds, or null when the file is absent. */
const readYamlConfig=(root: string,name: string): OwnerConfig | null=>{const yaml=path.join(root,name);return fs.existsSync(yaml)?validateConfig(parseYaml(fs.readFileSync(yaml,'utf8'))):null;};
function readExample(root: string=configRoot): OwnerConfig{const example=readYamlConfig(root,'config.example.yaml');if(example!==null){return example;}throw new Error('Missing config.example.yaml');}
/**
 * The owner config reader: `config.yaml` is the per-project file (gitignored,
 * seeded verbatim from `config.example.yaml` by the installer — comments and
 * all). Returns the validated owner config, or null when that file does not
 * exist; falling back to the example's defaults is `loadConfig`.
 */
function readOwnerConfig(root: string=configRoot): OwnerConfig | null{return ownerFileVisible(root)?readYamlConfig(root,'config.yaml'):null;}
/**
 * The tolerant read the kernel boot and the router share: an owner file that is absent, unparsable or
 * short of the closed schema must never stop a workflow from routing. Returns
 * {file, config, error, invalid} — `config` is the validated config, or the raw parse when it fails the
 * schema (with `invalid` naming the reason), or null when the file is absent or `error` says why it
 * could not be read at all.
 */
/** What inspectOwnerConfig reports: the validated config, an absent file, an unreadable one, or the raw parse of a file that fails the closed schema. */
export type InspectedConfig=
  | {file: string; config: OwnerConfig; error: null; invalid: null}
  | {file: string; config: null; error: string | null; invalid: null}
  | {file: string; config: unknown; error: null; invalid: string};
export function inspectOwnerConfig(root: string=configRoot): InspectedConfig{
  const file=path.join(root,'config.yaml');
  if(!ownerFileVisible(root)||!fs.existsSync(file))return {file,config:null,error:null,invalid:null};
  let parsed: unknown;
  try{parsed=parseYaml(fs.readFileSync(file,'utf8'))??null;}
  catch(error){return {file,config:null,error:`config.yaml unparsable: ${(error as Error).message}`,invalid:null};}
  try{return {file,config:validateConfig(parsed),error:null,invalid:null};}
  catch(error){return {file,config:parsed,error:null,invalid:(error as Error).message};}
}
/**
 * The owner's spec switches (config.yaml root `specs`, owner 2026-09-28; defaults set 2026-09-29, none needs a config block):
 *   unit    - product unit specs in workflows. Default on: a code-writing op writes/updates the unit specs of the source it
 *             adds or changes and runs only those; the full unit suite is unit.verify's or the approved /starci release flow's. false = the ops'
 *             policy.specsToggle deferral path (scripts/route/spec-deferral.mjs);
 *   e2e     - product e2e in workflows. Default OFF: e2e runs only when the goal or the owner explicitly asks (set true,
 *             or `starci kernel run-deferred-tests`); e2e.verify then runs the FULL e2e suite.
 * An absent, null or unreadable owner file reads as the defaults: unit on, e2e off. The runtime itself has no specs (owner ruling no-runtime-specs), so there is no switch for them.
 */
const SPEC_FAMILIES=Object.freeze(['unit','e2e'] as const);
const SEAT_KEYS=Object.freeze(['agent','model','effort']);
/** The keys each config block accepts directly under it (the validators read these lists; docs/config-format.md and the example are checked against them). Blocks whose keys are open or deeper than this are not listed. */
const CONFIG_KEY_TREE=Object.freeze({
  models:MODELS_KEYS,allocation:Object.freeze(['grants']),kernel:SEAT_KEYS,budgets:Object.freeze(['maxOps']),parallel:Object.freeze(['gear']),
  supervisor:Object.freeze(['mode','pollIntervalMs','repos','stallMinutes','kernel','workers','landGate','frozenMinutes']),
  delegation:Object.freeze(['asks','until','excludes','note']),asks:Object.freeze(['autoAcceptRecommended','excludes']),uat:Object.freeze(['maxConcurrent']),
  specs:SPEC_FAMILIES as readonly string[],reconciler:Object.freeze(['enabled','profile','controllers']),debugLoop:Object.freeze(['interval','worktreeLimit']),
  orca:ORCA_KEYS,roots:ROOT_KEYS,resources:RESOURCE_KEYS,release:RELEASE_KEYS,
});
export const SPEC_DEFAULTS=Object.freeze({unit:true,e2e:false});
export function specsSettings(config?: {specs?: SpecsBlock | null} | null): {unit: boolean; e2e: boolean}{const specs: SpecsBlock=plain(config?.specs)?config.specs:{};return Object.fromEntries(SPEC_FAMILIES.map(key=>[key,typeof specs[key]==='boolean'?specs[key]:SPEC_DEFAULTS[key]])) as {unit: boolean; e2e: boolean};}
/**
 * config.yaml `debugLoop` (skills/starci, scripts/debug/digest): {interval?, worktreeLimit?}, each optional.
 *   interval       <n>s | <n>m | <n>h — the cadence of the chat /loop that runs `starci debug digest`.
 *   worktreeLimit  integer >= 1 — more registered worktrees than this in one repository is a core-watch alert.
 */
export const DURATION_PATTERN=/^(\d+)([smh])$/;
export const DEBUG_LOOP_DEFAULTS=Object.freeze({interval:'10m',worktreeLimit:40});
/** '10m' | '90s' | '1h' in milliseconds, or null for anything else (zero included). */
export function durationMs(text: unknown): number | null{const m=DURATION_PATTERN.exec(String(text??'').trim());const ms=m?Number(m[1])*{s:1000,m:60000,h:3600000}[m[2] as 's' | 'm' | 'h']:0;return ms>0?ms:null;}
function validateDebugLoop(block: unknown): void{
  if(block===null)return;
  const bad: Bad=invalid('debugLoop');
  if(!plain(block))bad(' must be {interval?: <n>s|<n>m|<n>h, worktreeLimit?: <integer >= 1>} or null.');
  for(const key of Object.keys(block))if(!CONFIG_KEY_TREE.debugLoop.includes(key))bad(` has unknown key ${key} (allowed: ${CONFIG_KEY_TREE.debugLoop.join(', ')}).`);
  if(block.interval!==undefined&&durationMs(block.interval)===null)bad('.interval must be <n>s, <n>m or <n>h with n >= 1 (e.g. 10m).');
  if(block.worktreeLimit!==undefined&&!(typeof block.worktreeLimit==='number'&&Number.isInteger(block.worktreeLimit)&&block.worktreeLimit>=1))bad('.worktreeLimit must be an integer >= 1.');
}
/** The owner's debug-loop settings: {interval, intervalMs, worktreeLimit}; an absent block or key is the default. */
export function debugLoopSettings(config: {debugLoop?: DebugLoopBlock | null} | null | undefined=loadConfig()): {interval: string; intervalMs: number | null; worktreeLimit: number}{
  validateDebugLoop(config?.debugLoop??null);
  const block: DebugLoopBlock=plain(config?.debugLoop)?config.debugLoop:{};
  const interval=block.interval??DEBUG_LOOP_DEFAULTS.interval;
  return {interval,intervalMs:durationMs(interval),worktreeLimit:block.worktreeLimit??DEBUG_LOOP_DEFAULTS.worktreeLimit};
}
/** The owner config of `root` (config.yaml), else the shipped example. The installer seeds config.yaml (scripts/install/install.mjs seedConfig); this reader never writes. */
export function loadConfig(root: string=configRoot): OwnerConfig{
  return readOwnerConfig(root)??readExample(root);
}

/** The owner's standing delegation of ask answers (config.yaml `delegation`), or null when absent or expired. */
export function activeDelegation(config: {delegation?: DelegationBlock | null} | null | undefined=loadConfig(),now: number=Date.now()): {asks: string; until: string; excludes: string[]; note: string | null} | null{const d=config?.delegation;if(!d||Date.parse(d.until)<=now){return null;}return {asks:d.asks,until:d.until,excludes:d.excludes??[],note:d.note??null};}

/**
 * The owner's auto-accept policy for recommended asks (config.yaml `asks`): {autoAcceptRecommended,
 * excludes, source}. An absent or null block is the default (off). `handover` is always in excludes.
 * Validates first, so a malformed block throws rather than reading as on.
 */
export function askAutoAcceptPolicy(config: {asks?: AsksBlock | null} | null | undefined=loadConfig()): {autoAcceptRecommended: boolean; excludes: string[]; source: 'asks' | 'default'}{
  if(config?.asks!==undefined)validateAsks(config.asks);
  const asks=plain(config?.asks)?config.asks:null;
  const listed=asks&&Array.isArray(asks.excludes)?asks.excludes:ASKS_DEFAULTS.excludes;
  const excludes=listed.includes('handover')?[...listed]:[...listed,'handover'];
  return {autoAcceptRecommended:asks?.autoAcceptRecommended===true,excludes,source:asks?'asks':'default'};
}

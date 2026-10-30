#!/usr/bin/env node
// check-starcistacks.mjs - the .starcistacks services contract (owner ruling 2026-09-24: "the stacks make sonar
// clear ... update .claude and enforce the .starcistacks format").
//
// Every product states the delivery and quality services its code and CI use - Sonar, a
// container registry, analytics, error tracking - in the `services` block of its stack declaration
// (modules/schemas/application-stacks.schema.yaml $defs.service): provider, mode local|hosted|disabled,
// host (local and public URL), the stack that runs a local one, project keys per repository, credentials
// as custody references, how GitHub CI gets them and ownerAction. A Kernel or an op reads this block
// before it asks for any credential, and never asks the owner for what it declares `ownerAction: none`
// with custody present.
//
//   starci gate starcistacks <repo-root> [--new] [--json]
//
//   --new          the repository is being created by this leg (interface.scaffold, backend.scaffold,
//                  package.scaffold): a missing declaration or services block is refused, not a suspect
//
// Refusals: an unknown or ambiguous service declaration, custody that is missing where it is declared,
// an owner action declared for something custody already holds, CI calling a service the declaration
// disables or omits, and a tracked plaintext secret. Everything an existing repository merely lacks -
// the declaration, the services block, the .starcistacks rename, ignore rules - is a suspect with a
// planned follow-up (workspace.manage mode stacks), never a block on running work.
//
// Values are never read: custody presence is a file-existence test, and nothing here prints a secret.
// Exit 0 clean (suspects allowed), 1 refused, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { lsFiles } from '../api/git/ls-files.mjs'; import { checkIgnore } from '../api/git/check-ignore.mjs';
import { repositoryName, repositoryHome } from '../hfs/repo-identity.mjs';
import { isMain } from '../lib/is-main.mjs';
import { skillRoot } from '../../engine/runtime-root.mjs';
import {isPlainObject as plain} from '../../engine/plain-object.mjs';
import { parseYaml } from '../../engine/yaml.mjs';
import { list } from '../lib/list.mjs';
import { isFile, isDir } from '../lib/fs-kind.mjs';
import { loadSonarGate } from './sonar-gate.mjs';
import { resolveCustodyFile, resolveDeclaredRepository, runtimeHostRoot } from './runtime-host.mjs';
import { slash, trimTrailingSlashes } from '../lib/path-key.mjs';
import { DECLARATION, STACK_ROOT, declaredStack, findStackDeclaration, readDeclaration, readText, text } from '../lib/stack-declaration.mjs';
import { readProperties } from '../lib/properties.mjs';
import { escapeRegExp } from '../lib/regex.mjs';
import { isInfrastructureValueFile } from './starcistacks-value-file.mjs';
import { STACK_DECLARATION_TEMPLATE } from '../lib/example-refs.mjs';
import { checkSecretForm, kindOf, type AddFinding, type ServiceCredential, type ServiceStack, type StackServiceEntry } from './starcistacks-form.mjs';
import { SERVICE_CATALOG, catalogOf, checkServiceForm, checkCiDeclaration, checkQualityService, type Ambiguous, type ParsedDocument, type QualityServiceContext } from './starcistacks-ci.mjs';
import { applicationStackFindings } from './starcistacks-runtime.mjs';
export { DECLARATION, STACK_ROOT, findStackDeclaration };
const RESULT_SCHEMA = 'starci/starcistacks-check@1';
const DECLARATION_SCHEMA = 'starci/application-stacks@1';
const FOLLOW_UP = { op: 'workspace.manage', params: { mode: 'stacks' },
  detail: `author the services block of the repository stack declaration (sonar and every other delivery/quality service) from ${STACK_DECLARATION_TEMPLATE}` };
/** Every finding code this check can emit. */
export const CODES = [
  'STACKS_BADGE_TOKEN_SERVICE', 'STACKS_DECLARATION_MISSING', 'STACKS_DECLARATION_INVALID', 'STACKS_SERVICES_MISSING',
  'STACKS_SCHEMA_INVALID', 'STACKS_SERVICE_UNKNOWN', 'STACKS_PROVIDER_UNKNOWN',
  'STACKS_SERVICE_AMBIGUOUS', 'STACKS_STACK_UNRESOLVED', 'STACKS_CUSTODY_MISSING', 'STACKS_CUSTODY_UNVERIFIED',
  'STACKS_OWNER_ACTION_REDUNDANT', 'STACKS_PROJECT_MISSING', 'STACKS_PROJECT_DRIFT', 'STACKS_HOST_DRIFT',
  'STACKS_SERVICE_UNDECLARED', 'STACKS_CI_CONTRADICTION', 'STACKS_CI_UNUSED', 'STACKS_CI_NAME_UNREFERENCED',
  'STACKS_PLAINTEXT_TRACKED', 'STACKS_ENC_TWIN_MISSING', 'STACKS_GITIGNORE_OPEN', 'STACKS_DECLARATION_IGNORED',
  'STACKS_GITIGNORE_VALUE_OPEN', 'STACKS_RUNBOOK_IGNORED', 'STACKS_QUALITY_GATE_DRIFT',
  'CI_DECLARATION_INVALID', 'STACKS_CI_LEGACY_FORM',
  'STACKS_EXAMPLE_FORM', 'STACKS_PRODUCT_FORM', 'HFS_STACKS_SHAPE',
];
/** Paths (under <root>/<environment>/) the ignore rules must deny; they need not exist. */
const INFRA_VALUE_PROBES = ['infra/compose/.env', 'infra/compose/.env.generated', 'infra/compose/service/.env.local',
  'infra/compose/tls.key', 'infra/terraform/terraform.tfvars'];
/** A schema or declaration problem: where and what. */
export interface SchemaIssue { path: string; message: string }
type SchemaRun = (node: unknown, s: ParsedDocument, where: string) => SchemaIssue[];
/** A stack declaration as the stack-declaration library reads it. */
export interface Declaration { doc?: ParsedDocument | null; file?: string; error?: string; missing?: boolean; rooted?: boolean; repo?: string; root?: string; governs?: string; sourceHost?: boolean }
interface Finding { level: string; code: string; file: string; message: string }
type Git = (args: string[], options: { dir: string; timeout: number }) => { error?: unknown; status: number | null; stdout?: unknown };
type Normalized = Record<string, StackServiceEntry>;
type CiUses = Record<string, string[]>;
const usedBy = (ciUses: CiUses, id: string): string[] => ciUses[id] ?? [];
interface ServiceCheckInput { schema: ParsedDocument; declFile: string; declaration: Declaration | null; governing: Declaration | null; name: string; ciUses: CiUses; ciText: string; normalized: Normalized; add: AddFinding; kind: string }
/** The check's report. */
export interface StarciStacksResult { schema: string; ok: boolean; repository: string; repoRoot: string; newRepo: boolean; declaration: string | null; root: string | null; governedBy: string | null; services: Record<string, ReturnType<typeof summary>>; refused: string[]; suspect: string[]; findings: Finding[]; followUp?: { op: string; params: { mode: string }; detail: string; fixture?: string } }
interface RootCheck { repo: string; root: string; add: AddFinding }
type ServiceCi = StackServiceEntry['ci'];
/** A service whose ci block may be the source host's reduced one (no token, hostVar or organizationVar). */
type ServiceLike = Omit<StackServiceEntry, 'ci'> & { ci: ResolvedCi };
type ResolvedCi = Omit<ServiceCi, 'token' | 'hostVar' | 'organizationVar'> & Partial<Pick<ServiceCi, 'token' | 'hostVar' | 'organizationVar'>>;
/** resolveStackService's answer: the normalized service plus where its declaration lives. */
export type ResolvedStackService = Omit<StackServiceEntry, 'ci'> & { ci: ResolvedCi; declaration: string | undefined; declaringRepo: string | undefined; sourceHost: boolean; repository: string; projectKey: string | null };
/** What ownerAskConflict answers when an ask requests what a declaration already answers. */
export interface OwnerAskConflict { service: string; provider: string | null; declaration: string; matched: string | null | undefined; message: string }

let schemaCache: ParsedDocument | null = null;
function declarationSchema(): ParsedDocument {
  if (!schemaCache) schemaCache = parseYaml(fs.readFileSync(path.join(skillRoot, 'modules', 'schemas', 'application-stacks.schema.yaml'), 'utf8'));
  return schemaCache;
}
const appendSchemaArrayErrors = (out: SchemaIssue[], node: unknown[], s: ParsedDocument, where: string, run: SchemaRun): void => { node.forEach((item, index) => { if (s.items) out.push(...run(item, s.items, `${where}[${index}]`)); }); };
const appendSchemaObjectErrors = (out: SchemaIssue[], node: ParsedDocument, s: ParsedDocument, where: string, run: SchemaRun): void => {
  if (s.minProperties && Object.keys(node).length < s.minProperties) out.push({ path: where, message: 'object has too few properties' });
  for (const key of s.required ?? []) if (!Object.hasOwn(node, key)) out.push({ path: where, message: `missing ${key}` });
  for (const [key, child] of Object.entries(node)) {
    if (Object.hasOwn(s.properties ?? {}, key)) out.push(...run(child, s.properties[key], `${where}.${key}`));
    else if (s.additionalProperties === false) out.push({ path: `${where}.${key}`, message: 'unknown field' });
    else if (plain(s.additionalProperties)) out.push(...run(child, s.additionalProperties, `${where}.${key}`));
  }
};
/** The subset of JSON Schema the declaration schema uses: type, const, enum, pattern, minLength, required, properties, additionalProperties, items, minProperties, minimum, maximum, $ref, anyOf. */
function schemaErrors(value: unknown, shape: ParsedDocument, at = '$', root: ParsedDocument = declarationSchema()): SchemaIssue[] {
  const resolve = (ref: string): ParsedDocument => ref.slice(2).split('/').reduce((node: ParsedDocument, key) => node?.[key], root);
  const typeOk = (node: unknown, s: ParsedDocument): boolean => {
    const byType: Record<string, (n: unknown) => boolean> = { object: plain, array: Array.isArray, integer: Number.isInteger };
    return (byType[s.type] ?? ((n: unknown) => (s.type ? typeof n === s.type : true)))(node);
  };
  const run: SchemaRun = (node, s, where) => {
    if (!plain(s)) return [];
    if (s.$ref) return run(node, resolve(s.$ref), where);
    if (Array.isArray(s.anyOf) && !s.anyOf.some((option: ParsedDocument) => run(node, option, where).length === 0))
      return [{ path: where, message: 'matches none of the allowed shapes' }];
    if (!typeOk(node, s)) return [{ path: where, message: `expected ${s.type}` }];
    const out: SchemaIssue[] = [];
    if (Object.hasOwn(s, 'const') && node !== s.const) out.push({ path: where, message: `must be ${JSON.stringify(s.const)}` });
    if (Array.isArray(s.enum) && !s.enum.includes(node)) out.push({ path: where, message: `must be one of ${s.enum.join(', ')}` });
    if (typeof node === 'number' && ((s.minimum !== undefined && node < s.minimum) || (s.maximum !== undefined && node > s.maximum))) out.push({ path: where, message: 'number outside allowed range' });
    if (typeof node === 'string') out.push(...stringErrors(node, s, where));
    if (Array.isArray(node)) { appendSchemaArrayErrors(out, node, s, where, run); return out; }
    if (!plain(node)) return out;
    appendSchemaObjectErrors(out, node, s, where, run);
    return out;
  };
  const stringErrors = (node: string, s: ParsedDocument, where: string): SchemaIssue[] => {
    const out: SchemaIssue[] = [];
    if (s.minLength && node.length < s.minLength) out.push({ path: where, message: 'string too short' });
    if (s.pattern && !new RegExp(s.pattern, 'u').test(node)) out.push({ path: where, message: `does not match ${s.pattern}` });
    return out;
  };
  return run(value, shape, at);
}
// ---- locating declarations and repositories -------------------------------------------------------------
/** A frontend declared by its backend's stack: a sibling declaration whose `sources` lists this repository. */
function governingDeclaration(repo: string): (Declaration & { repo: string; root: string; file: string; governs: string }) | null {
  const name = repositoryName(repo);
  const parent = path.dirname(repositoryHome(repo));
  let entries: fs.Dirent[] = []; try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === name) continue;
    const file = path.join(parent, entry.name, STACK_ROOT, DECLARATION);
    if (!isFile(file)) continue;
    const read = readDeclaration(file);
    if (read.doc && list(read.doc.sources).some((source: ParsedDocument) => source?.repository === name))
      return { repo: path.join(parent, entry.name), root: STACK_ROOT, file, governs: name, ...read };
  }
  return null;
}
// ---- normalizing a service ------------------------------------------------------------------------------
const normalizeCredential = (credential: ParsedDocument, declaringRepo: string | null | undefined): ServiceCredential => {
  const custody = plain(credential.custody) ? credential.custody : {};
  const repo = resolveDeclaredRepository(custody.repository, { fromRepo: declaringRepo });
  const rel = text(custody.path);
  const abs = resolveCustodyFile(repo, rel);
  return { id: text(credential.id), env: text(credential.env), key: text(credential.key), purpose: text(credential.purpose),
    custody: { repository: text(custody.repository), path: rel, resolved: Boolean(repo), file: abs,
      encPresent: abs ? isFile(`${abs}.enc`) : null, plainPresent: abs ? isFile(abs) : null } };
};
const ownerActionOf = (s: ParsedDocument): StackServiceEntry['ownerAction'] => {
  const noAction = s.ownerAction === 'none' ? 'none' : null;
  return plain(s.ownerAction) ? { needed: text(s.ownerAction.needed), reason: text(s.ownerAction.reason) } : noAction;
};
/** Resolve a declared stack to its host or repository directory without reading custody values. */
function normalizeStack(stack: ParsedDocument, entry: ParsedDocument, declaringRepo: string | null | undefined): ServiceStack | null {
  // owner: host - the stack lives inside the installed runtime tree (.claude/ext/<service>);
  // `environment` is the slot the extension serves, not a path segment (<root>/<compose> resolves it).
  const hostOwned = declaredStack(entry)?.hostOwned ?? false;
  const hostRoot = hostOwned ? slash(stack.root) : null;
  const extDir = hostRoot && hostRoot.startsWith('.claude/') && !hostRoot.split('/').includes('..')
    ? path.join(skillRoot, hostRoot.replace(/^\.claude\//, '')) : null;
  const stackRepo = stack && !hostOwned ? resolveDeclaredRepository(stack.repository, { fromRepo: declaringRepo }) : null;
  let stackDir = null;
  if (hostOwned) stackDir = extDir;
  else if (stackRepo && text(stack.root) && text(stack.environment)) stackDir = path.join(stackRepo, stack.root, stack.environment);
  return stack ? { owner: text(stack.owner), repository: text(stack.repository), root: text(stack.root), environment: text(stack.environment), compose: text(stack.compose),
    container: text(stack.container), publishedBy: text(stack.publishedBy), hostOwned, repo: stackRepo, dir: stackDir,
    composeFile: stackDir && text(stack.compose) ? path.join(stackDir, stack.compose) : null } : null;
}
/** One declared service with its custody resolved to presence (never a value). */
export function normalizeService(id: string, entry: ParsedDocument, { declaringRepo }: { declaringRepo?: string | null | undefined } = {}): StackServiceEntry {
  const s = plain(entry) ? entry : {};
  const stack = plain(s.stack) ? s.stack : null;
  const normalizedStack = normalizeStack(stack, entry, declaringRepo);
  const credentials = list(s.credentials).filter(plain).map((credential: ParsedDocument) => normalizeCredential(credential, declaringRepo));
  const ci = plain(s.ci) ? s.ci : {};
  return {
    id, organization: text(s.organization), provider: text(s.provider), mode: text(s.mode), purpose: text(s.purpose), reason: text(s.reason), auth: text(s.auth), qualityGate: text(s.qualityGate),
    host: { local: text(s.host?.local), public: text(s.host?.public), fromCredential: text(s.host?.fromCredential) },
    stack: normalizedStack,
    projects: list(s.projects).filter(plain).map((project: ParsedDocument) => ({ repository: text(project.repository), key: text(project.key), name: text(project.name) })),
    credentials,
    runtimeSecrets: list(s.runtimeSecrets).map(String),
    ci: { token: text(ci.token), hostVar: text(ci.hostVar),
      organizationVar: text(ci.organizationVar) || (s.provider === 'sonarcloud' && list(s.runtimeSecrets).length && !credentials.length ? 'SONAR_ORGANIZATION' : null), wiring: text(ci.wiring), workflow: text(ci.workflow), permissions: list(ci.permissions).map(String),
      secrets: list(ci.secrets).filter(plain).map((item: ParsedDocument) => ({ name: text(item.name), credential: text(item.credential) })),
      vars: list(ci.vars).filter(plain).map((item: ParsedDocument) => ({ name: text(item.name), value: text(item.value) })),
      provisioning: text(ci.provisioning) },
    ownerAction: ownerActionOf(s),
  };
}
const custodyHeld = (service: ServiceLike): boolean => (service.credentials.length ? service.credentials.every((credential) => credential.custody.encPresent || credential.custody.plainPresent) : ['oidc', 'github-token', 'none'].includes(service.auth ?? ''));
/**
 * What a tool (scripts/gates/sonar-local.mjs, a CI wiring leg) reads for one service of one repository:
 * the repository's own (or governing) declaration first, then the source host's declaration when its entry
 * lists this repository among its projects. Null when nothing declares it.
 */
export function resolveStackService(repoRoot: unknown, serviceId: string): ResolvedStackService | null {
  const repo = path.resolve(String(repoRoot ?? ''));
  const name = repositoryName(repo);
  const own = findStackDeclaration(repo);
  const candidates = [own.doc ? own : governingDeclaration(repo)].filter(Boolean);
  const host = runtimeHostRoot();
  if (path.resolve(host) !== repo) { const source = findStackDeclaration(host); if (source.doc) candidates.push({ ...source, sourceHost: true }); }
  for (const declaration of candidates) {
    const entry = declaration.doc?.services?.[serviceId];
    if (!plain(entry)) continue;
    let service: ServiceLike = normalizeService(serviceId, entry, { declaringRepo: declaration?.repo });
    const listed = service.projects.some((project) => project.repository === name);
    if (declaration.sourceHost && !listed) continue;
    // Through the source host a product gets the shared server, its shared credentials and its own project
    // token (a credential whose id is a project key); other projects' tokens and the host's CI wiring are not its.
    const ownKey = service.projects.find((project) => project.repository === name)?.key;
    const projectKeys = new Set(service.projects.map((project) => project.key));
    if (declaration.sourceHost) service = { ...service, credentials: service.credentials.filter((credential) => !projectKeys.has(credential.id) || credential.id === ownKey),
      ci: { wiring: null, workflow: null, permissions: [], secrets: [], vars: [], provisioning: null } };
    return { declaration: declaration.file, declaringRepo: declaration.repo, sourceHost: Boolean(declaration.sourceHost),
      repository: name, projectKey: service.projects.find((project) => project.repository === name)?.key ?? null, ...service };
  }
  return null;
}
// ---- repository evidence --------------------------------------------------------------------------------
function workflowTexts(repo: string): Array<{ file: string; text: string }> {
  const dir = path.join(repo, '.github', 'workflows');
  let entries: string[] = []; try { entries = fs.readdirSync(dir).filter((name) => /\.ya?ml$/i.test(name)); } catch { return []; }
  return entries.map((name) => ({ file: `.github/workflows/${name}`, text: readText(path.join(dir, name)) ?? '' }));
}
function git(call: Git, repo: string, args: string[]): { status: number | null; stdout: string } | null {
  try {
    const result = call(args, { dir: repo, timeout: 8000 });
    if (result.error) return null;
    return { status: result.status, stdout: String(result.stdout ?? '') };
  } catch { return null; }
}
// ---- the check ------------------------------------------------------------------------------------------
const checkLocalStack = (service: StackServiceEntry, at: string, add: AddFinding, ambiguous: Ambiguous): void => {
  if (!service.host.local) ambiguous('a local service names host.local, the URL the stack serves it on');
  if (!service.stack) ambiguous('a local service names the stack that runs it (repository, root, environment, compose) or owns it as a host extension (owner: host, root: .claude/ext/<service>)');
  else if (service.stack.hostOwned) {
    if (!service.stack.composeFile || !isFile(service.stack.composeFile))
      add('refuse', 'STACKS_STACK_UNRESOLVED', `${at}.stack`, `the host extension file ${service.stack.root}/${service.stack.compose} does not exist under the runtime tree (${slash(skillRoot)})`);
    const publisher = service.stack.publishedBy;
    if (publisher && service.stack.dir && !isFile(path.join(service.stack.dir, publisher)))
      add('refuse', 'STACKS_STACK_UNRESOLVED', `${at}.stack.publishedBy`, `the host extension file ${service.stack.root}/${publisher} does not exist under the runtime tree (${slash(skillRoot)})`);
  }
  else if (!service.stack.repo) add('suspect', 'STACKS_STACK_UNRESOLVED', `${at}.stack`, `repository ${service.stack.repository} is not checked out on this machine; its compose file and custody are unverified`);
  else if (!service.stack.composeFile || !isFile(service.stack.composeFile))
    add('refuse', 'STACKS_STACK_UNRESOLVED', `${at}.stack`, `${service.stack.repository}/${service.stack.root}/${service.stack.environment}/${service.stack.compose} does not exist`);
};
const checkServiceCredentials = (service: StackServiceEntry, at: string, add: AddFinding, ambiguous: Ambiguous): Set<string | null> => {
  const ids = new Set<string | null>();
  for (const credential of service.credentials) {
    const where = `${at}.credentials.${credential.id ?? '?'}`;
    if (credential.id && ids.has(credential.id)) ambiguous(`credential id ${credential.id} is declared twice`);
    ids.add(credential.id);
    if (!credential.env && !credential.key) ambiguous(`credential ${credential.id ?? '?'} names the env variable or the file key its consumer reads`);
    if (!credential.custody.resolved) add('suspect', 'STACKS_CUSTODY_UNVERIFIED', where, `custody repository ${credential.custody.repository} is not checked out on this machine`);
    else if (!credential.custody.encPresent)
      add('refuse', 'STACKS_CUSTODY_MISSING', where, `${credential.custody.repository}/${credential.custody.path}.enc is not in custody; repair the stack custody (secret:gen / stack-secret) - never ask the owner for a value the declaration says the runtime holds`);
  }
  return ids;
};
const checkCiNames = (service: StackServiceEntry, id: string, at: string, ciUses: CiUses, ciText: string, add: AddFinding): void => { if (['required', 'optional-follow-up'].includes(service.ci.wiring ?? '') && usedBy(ciUses, id).length) for (const item of [...service.ci.secrets, ...service.ci.vars]) if (item.name && !new RegExp(String.raw`\b${escapeRegExp(item.name)}\b`).test(ciText)) add('suspect', 'STACKS_CI_NAME_UNREFERENCED', `${at}.ci`, `${item.name} is declared for CI but no workflow reads it`); };
const checkServiceCi = (service: StackServiceEntry, id: string, at: string, { governing, name, ciUses, ciText, add, ambiguous }: QualityServiceContext): void => {
  const ids = checkServiceCredentials(service, at, add, ambiguous);
  for (const secret of service.ci.secrets)
    if (secret.credential && !ids.has(secret.credential)) ambiguous(`ci secret ${secret.name} names credential ${secret.credential}, which the service does not declare`);
  if (plain(service.ownerAction) && service.credentials.length && custodyHeld(service))
    add('refuse', 'STACKS_OWNER_ACTION_REDUNDANT', `${at}.ownerAction`, 'every credential is already in custody; ownerAction must be none - the owner is never asked for what the runtime holds');
  if (service.ci.wiring === 'not-used' && usedBy(ciUses, id).length)
    add('refuse', 'STACKS_CI_CONTRADICTION', `${at}.ci`, `ci.wiring not-used, but ${usedBy(ciUses, id).join(', ')} call it`);
  // A frontend governed by its backend declaration answers only for the services that name it as a project:
  // the backend CI wiring (its image registry, say) is not the frontend's to call.
  const servesThisRepository = !governing || service.projects.some((project) => project.repository === name);
  if (service.ci.wiring === 'required' && !usedBy(ciUses, id).length && catalogOf(id).ci.length && servesThisRepository)
    add('suspect', 'STACKS_CI_UNUSED', `${at}.ci`, 'ci.wiring required, but no workflow calls the service');
  checkCiNames(service, id, at, ciUses, ciText, add);
  if (usedBy(ciUses, id).length && service.projects.length && !service.projects.some((project) => project.repository === name) && !governing)
    add('refuse', 'STACKS_PROJECT_MISSING', `${at}.projects`, `the workflows call ${id} but no project entry names repository ${name}`);
};
const checkDisabledService = (service: StackServiceEntry, id: string, at: string, ciUses: CiUses, ambiguous: Ambiguous, add: AddFinding): boolean => { if (service.mode !== 'disabled') { return false; } if (!service.reason) { ambiguous('a disabled service states its reason'); } if (usedBy(ciUses, id).length) { add('refuse', 'STACKS_CI_CONTRADICTION', at, `declared disabled, but ${usedBy(ciUses, id).join(', ')} call it`); } return true; };
const checkEnabledService = (service: StackServiceEntry, id: string, at: string, { governing, name, ciUses, ciText, add, kind }: Omit<QualityServiceContext, 'ambiguous'> & { kind: string }, ambiguous: Ambiguous): void => {
  checkSecretForm(service, id, at, kind, add);
  if (service.mode === 'local') checkLocalStack(service, at, add, ambiguous);
  if (service.mode === 'hosted' && !service.host.public && !service.host.fromCredential) ambiguous('a hosted service names host.public, or host.fromCredential when the endpoint travels inside a credential');
  if (usedBy(ciUses, id).length && service.ci.wiring !== 'not-used' && !service.host.public) ambiguous('GitHub CI reaches a service only through host.public; name it');
  if (!service.auth) ambiguous('auth is token, oidc, github-token or none');
  if (service.auth === 'token' && !service.credentials.length && !service.runtimeSecrets.length && !service.ci.token) ambiguous('auth token names at least one credential in custody, or the runtime secret.env variables an example reads (runtimeSecrets)');
  if (service.host.fromCredential && !service.credentials.some((credential) => credential.id === service.host.fromCredential)) ambiguous(`host.fromCredential names ${service.host.fromCredential}, which is not one of its credentials`);
  if (!service.projects.length) ambiguous('an enabled service lists the project key of every repository it serves');
  checkServiceCi(service, id, at, { governing, name, ciUses, ciText, add, ambiguous });
};
const checkService = (id: string, entry: ParsedDocument, { schema, declFile, declaration, governing, name, ciUses, ciText, normalized, add, kind }: ServiceCheckInput): void => {
  if (entry?.badgeToken !== undefined && !['codecov', 'sonar'].includes(id)) add('refuse', 'STACKS_BADGE_TOKEN_SERVICE', `${declFile}#services.${id}.badgeToken`, 'badgeToken is allowed only on codecov or sonar');
  if (!Object.hasOwn(SERVICE_CATALOG, id)) {
    add('refuse', 'STACKS_SERVICE_UNKNOWN', `${declFile}#services.${id}`, `${id} is not a catalogued service (${Object.keys(SERVICE_CATALOG).join(', ')}); a service the catalog does not know is one nobody can read unambiguously`);
    return;
  }
  for (const issue of schemaErrors(entry, ['dependabot', 'audit'].includes(id) ? schema.$defs.serviceOptionalCi : schema.$defs.service, `services.${id}`))
    add('refuse', 'STACKS_SCHEMA_INVALID', `${declFile}#${issue.path}`, issue.message);
  const service = normalizeService(id, entry, { declaringRepo: declaration?.repo });
  normalized[id] = service;
  const at = `${declFile}#services.${id}`;
  const ambiguous: Ambiguous = (message) => add('refuse', 'STACKS_SERVICE_AMBIGUOUS', at, message);
  checkServiceForm(service, id, entry, at, kind, add, ambiguous);
  if (checkDisabledService(service, id, at, ciUses, ambiguous, add)) return;
  if (checkQualityService(service, id, at, { governing, name, ciUses, ciText, add, ambiguous }, checkServiceCi)) return;
  checkEnabledService(service, id, at, { governing, name, ciUses, ciText, add, kind }, ambiguous);
};
const checkUndeclared = ({ repo, ciUses, normalized, services, declFile, add }: { repo: string; ciUses: CiUses; normalized: Normalized; services: ParsedDocument | null; declFile: string; add: AddFinding }): void => {
  for (const [id, files] of Object.entries(ciUses)) {
    if (['codecov', 'dependabot', 'audit'].includes(id)) continue;
    if (!files.length || normalized[id] || (services && Object.hasOwn(services, id))) continue;
    const viaSource = resolveStackService(repo, id);
    if (viaSource && !services) continue;
    const followUp = services ? '' : ` - follow-up: ${FOLLOW_UP.op} mode stacks`;
    add(services ? 'refuse' : 'suspect', 'STACKS_SERVICE_UNDECLARED', declFile,
      `${files.join(', ')} call ${id}, which the declaration does not state${followUp}`);
  }
};
const checkQualityGate = (sonar: ServiceLike | null, normalized: Normalized, declFile: string, add: AddFinding, repo: string): void => { if (!sonar || sonar.mode === 'disabled') { return; } const gateName = loadSonarGate({ cwd: repo }).gate.name; if (sonar.qualityGate !== gateName) { add(normalized.sonar ? 'refuse' : 'suspect', 'STACKS_QUALITY_GATE_DRIFT', `${declFile}#services.sonar.qualityGate`, `services.sonar.qualityGate is ${sonar.qualityGate ?? 'absent'}; every product names the one gate ${gateName} (knowledge/sonar-gate.yaml owns its thresholds)`); } };
// Sonar settings the repository carries must agree with the declaration, and every repository names the one quality gate.
const checkSonarDrift = ({ repo, name, normalized, services, declFile, add }: { repo: string; name: string; normalized: Normalized; services: ParsedDocument | null; declFile: string; add: AddFinding }): void => {
  const sonar = normalized.sonar ?? (services ? null : resolveStackService(repo, 'sonar'));
  const props = readProperties(path.join(repo, 'sonar-project.properties'));
  if (sonar && sonar.mode !== 'disabled' && Object.keys(props).length) {
    const declared = sonar.projects.find((project) => project.repository === name)?.key;
    if (declared && props['sonar.projectKey'] && props['sonar.projectKey'] !== declared)
      add(normalized.sonar ? 'refuse' : 'suspect', 'STACKS_PROJECT_DRIFT', 'sonar-project.properties', `sonar.projectKey ${props['sonar.projectKey']} but the declaration names ${declared}`);
    if (sonar.host.public && props['sonar.host.url'] && trimTrailingSlashes(props['sonar.host.url']) !== trimTrailingSlashes(sonar.host.public))
      add('suspect', 'STACKS_HOST_DRIFT', 'sonar-project.properties', `sonar.host.url ${props['sonar.host.url']} but the declaration's public host is ${sonar.host.public}`);
  }
  // The one quality gate (knowledge/sonar-gate.yaml): a repository names it, never its own thresholds.
  checkQualityGate(sonar, normalized, declFile, add, repo);
};
const checkTrackedCustody = ({ repo, root, add }: RootCheck): void => {
  const tracked = git(lsFiles, repo, ['--', root]);
  if (tracked?.status !== 0) return;
  for (const file of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
    const parts = slash(file).split('/');
    const custodyArea = parts.length > 3 && (parts[2] === 'runtime' || parts[2] === 'secrets');
    const base = parts.at(-1);
    // infra/** is tracked source, but a value file inside it (.env*, *.env, *.key, *.pem, *.tfvars)
    // is plaintext custody (inc-5360513a96b3: infra/compose/.env.generated was trackable).
    const infraValue = parts.length > 3 && parts[2] === 'infra' && isInfrastructureValueFile(base) && !base.endsWith('.enc') && !base.endsWith('.example');
    // An app's sealed member is `<env>/secrets/<member>.enc.yaml` (ruling app-secrets-one-standard, scripts/lib/sealed-member.mjs);
    // runtime custody keeps `<name>.<fmt>.enc`.
    const appMember = parts.length === 4 && parts[2] === 'secrets' && base.endsWith('.enc.yaml');
    if ((custodyArea && !base.endsWith('.enc') && !appMember && !['KEYS.md', '.gitkeep'].includes(base)) || infraValue)
      add('refuse', 'STACKS_PLAINTEXT_TRACKED', file, /\.enc\.(?:ya?ml|json|env)$/u.test(base)
        ? `${base} is named the wrong way round: a custody file is <name>.<fmt>.enc (rename it to ${base.replace(/\.enc\.(ya?ml|json|env)$/u, '.$1.enc')}) and every read states the format (scripts/api/sops/exec-env.mjs)`
        : 'a custody member is tracked in plaintext; untrack it (git rm --cached), rotate the value and commit only its .enc twin');
  }
};
const checkEncTwins = ({ repo, root, add }: RootCheck): void => {
  for (const env of envDirs(repo, root)) {
    const filesDir = path.join(repo, root, env.name, 'runtime', 'files');
    let members = [];
    try { members = fs.readdirSync(filesDir); } catch { continue; }
    const bare = members.filter((member) => !member.endsWith('.enc') && !/\.md$/i.test(member) && member !== '.gitkeep'
      && !/\.(rotation-pending|bak)$/.test(member) && !members.includes(`${member}.enc`));
    if (bare.length) add('suspect', 'STACKS_ENC_TWIN_MISSING', `${root}/${env.name}/runtime/files`,
      `${bare.length} plaintext custody member(s) have no .enc twin (${bare.slice(0, 5).join(', ')}${bare.length > 5 ? ', ...' : ''}); encrypt them (stack-secret) so another machine can decrypt them`);
  }
};
const checkIgnoreRules = ({ repo, root, add }: RootCheck): void => {
  // The rules must still deny a value file under infra AFTER the infra re-includes
  // (stacks-layout.yaml custody.gitignoreRules). git check-ignore --no-index answers for paths
  // that do not exist yet, so the probe proves the rule, not today's files.
  for (const env of envDirs(repo, root)) {
    const open = INFRA_VALUE_PROBES.map((probe) => `${root}/${env.name}/${probe}`)
      .filter((rel) => git(checkIgnore, repo, ['-q', '--no-index', '--', rel])?.status === 1);
    if (open.length) add('refuse', 'STACKS_GITIGNORE_VALUE_OPEN', '.gitignore',
      `the ignore rules leave plaintext value files under ${root}/${env.name}/infra trackable (${open.join(', ')}); deny them after the infra re-includes and re-include *.enc last (modules/schemas/stacks-layout.yaml custody.gitignoreRules)`);
    // The environment runbook is part of the layout contract (stacks-layout.yaml shape.runbook);
    // rules that hide it strand it on one machine.
    const runbook = `${root}/${env.name}/README.md`;
    if (git(checkIgnore, repo, ['-q', '--no-index', '--', runbook])?.status === 0)
      add('suspect', 'STACKS_RUNBOOK_IGNORED', runbook, `the ignore rules hide the ${env.name} runbook; re-include it (!${runbook}) so every machine reads it`);
  }
};
// Custody layout (modules/schemas/stacks-layout.yaml custody, the product repositories' secrets-guard).
// The images folder holds the managed db image of a lite app (slot app.db.image), never custody or an environment.
const envDirs = (repo: string, root: string): fs.Dirent[] => fs.readdirSync(path.join(repo, root), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'images');
const checkCustodyLayout = ({ repo, own, add }: { repo: string; own: Declaration; add: AddFinding }): void => {
  if (!own.rooted) return;
  const root = STACK_ROOT;
  checkTrackedCustody({ repo, root, add });
  checkEncTwins({ repo, root, add });
  const ignore = readText(path.join(repo, '.gitignore')) ?? '';
  if (!new RegExp(String.raw`^/?${escapeRegExp(root)}/\*\*\s*$`, 'm').test(ignore))
    add('suspect', 'STACKS_GITIGNORE_OPEN', '.gitignore', `no deny-all rule \`${root}/**\`; custody plaintext is only safe when the tree is denied and *.enc, KEYS.md and the declaration are re-included`);
  checkIgnoreRules({ repo, root, add });
};
const buildResult = ({ repo, name, newRepo, declaration, governing, normalized, findings }: { repo: string; name: string; newRepo: boolean; declaration: Declaration | null; governing: Declaration | null; normalized: Normalized; findings: Finding[] }): StarciStacksResult => {
  const pick = (level: string): string[] => findings.filter((finding) => finding.level === level).map((finding) => `${finding.file}: ${finding.message} [${finding.code}]`);
  const refused = pick('refuse');
  const needsFollowUp = findings.some((finding) => ['STACKS_DECLARATION_MISSING', 'STACKS_SERVICES_MISSING', 'STACKS_SERVICE_UNDECLARED'].includes(finding.code) && finding.level !== 'refuse');
  return {
    schema: RESULT_SCHEMA, ok: refused.length === 0, repository: name, repoRoot: slash(repo), newRepo,
    declaration: declaration?.file ? slash(declaration.file) : null, root: declaration?.root ?? null,
    governedBy: governing ? slash(governing.repo) : null,
    services: Object.fromEntries(Object.entries(normalized).map(([id, service]) => [id, summary(service)])),
    refused, suspect: pick('suspect'), findings,
    ...(needsFollowUp ? { followUp: { ...FOLLOW_UP, ...(isFile(path.join(skillRoot, STACK_DECLARATION_TEMPLATE)) ? { fixture: STACK_DECLARATION_TEMPLATE } : {}) } } : {}),
  };
};
const declarationView = (own: Declaration, governing: Declaration | null, missingLevel: string, shown: (file: string) => string, add: AddFinding): { declaration: Declaration | null; services: ParsedDocument | null; declFile: string } => {
  const declaration = own.missing ? governing : own;
  if (own.missing && !governing) add(missingLevel, 'STACKS_DECLARATION_MISSING', `.starcistacks/${DECLARATION}`, `no stack declaration (.starcistacks/${DECLARATION}); the services this repository's CI uses are undeclared - follow-up: ${FOLLOW_UP.op} mode stacks`);
  if (declaration?.error) add('refuse', 'STACKS_DECLARATION_INVALID', shown(declaration.file ?? ''), declaration.error);
  if (declaration?.doc && declaration.doc.schema !== DECLARATION_SCHEMA) add('refuse', 'STACKS_DECLARATION_INVALID', shown(declaration.file ?? ''), `schema must be ${DECLARATION_SCHEMA}`);
  const doc = declaration?.doc ?? null, services = plain(doc?.services) ? doc.services : null;
  const declFile = declaration?.file ? shown(declaration.file ?? '') : `.starcistacks/${DECLARATION}`;
  if (doc && !Object.hasOwn(doc, 'services')) add(missingLevel, 'STACKS_SERVICES_MISSING', declFile, `the declaration has no services block; declare sonar and every other delivery/quality service the repository uses - follow-up: ${FOLLOW_UP.op} mode stacks`);
  return { declaration, services, declFile };
};
const checkDeclaredServices = ({ services, declaration, governing, name, ciUses, ciText, declFile, normalized, add, kind }: Omit<ServiceCheckInput, 'schema'> & { services: ParsedDocument | null }): void => {
  if (!services) return;
  const schema = declarationSchema(), ctx = { schema, declFile, declaration, governing, name, ciUses, ciText, normalized, add, kind };
  for (const [id, entry] of Object.entries(services)) checkService(id, entry, ctx);
};
const checkDeclarationIgnore = (own: Declaration, repo: string, shown: (file: string) => string, add: AddFinding): void => {
  if (!own.missing && own.file) {
    const ignored = git(checkIgnore, repo, ['-q', '--', slash(path.relative(repo, own.file))]);
    if (ignored?.status === 0) add('suspect', 'STACKS_DECLARATION_IGNORED', shown(own.file), `the ignore rules hide the declaration; re-include it (!${slash(path.relative(repo, own.file))}) so every machine reads the same services`);
  }
};
/**
 * The whole check for one repository. `newRepo`: the leg creates this repository, so what it lacks is
 * refused under the current declaration and custody rules.
 */
export function checkStarciStacks(repoRoot: unknown, { newRepo = false, examplesRoot = path.join(skillRoot, 'examples') }: { newRepo?: boolean; examplesRoot?: string } = {}) {
  const repo = path.resolve(String(repoRoot ?? ''));
  const name = repositoryName(repo);
  const findings: Finding[] = [];
  const add: AddFinding = (level, code, file, message) => findings.push({ level, code, file: slash(file), message });
  const missingLevel = newRepo ? 'refuse' : 'suspect', own = findStackDeclaration(repo);
  const governing = own.missing ? governingDeclaration(repo) : null;
  const shown = (file: string): string => slash(path.relative(repo, file)) || '.';
  const { declaration, services, declFile } = declarationView(own, governing, missingLevel, shown, add);
  checkCiDeclaration(declaration, declFile, kindOf(repo, examplesRoot), declarationSchema, schemaErrors, add);
  // CI evidence: which services the workflows call, and which secret/variable names they read.
  const workflows = workflowTexts(repo);
  const ciText = workflows.map((workflow) => workflow.text).join('\n');
  const ciUses = Object.fromEntries(Object.entries(SERVICE_CATALOG).map(([id, entry]) => [id, workflows.filter((workflow) => entry.ci.some((re) => re.test(workflow.text))).map((workflow) => workflow.file)]));
  const normalized: Normalized = {};
  checkDeclaredServices({ services, declaration, governing, name, ciUses, ciText, declFile, normalized, add, kind: kindOf(repo, examplesRoot) });
  checkUndeclared({ repo, ciUses, normalized, services, declFile, add });
  checkSonarDrift({ repo, name, normalized, services, declFile, add });
  checkCustodyLayout({ repo, own, add });
  checkDeclarationIgnore(own, repo, shown, add);
  for (const item of applicationStackFindings(repo)) add('refuse', item.code, item.path, item.message);
  return buildResult({ repo, name, newRepo, declaration, governing, normalized, findings });
}
/** A report-safe view: custody as presence, never a value. */
function summary(service: ServiceLike) {
  return { provider: service.provider, mode: service.mode, auth: service.auth, host: service.host,
    stack: service.stack ? { owner: service.stack.owner ?? null, repository: service.stack.repository, root: service.stack.root, environment: service.stack.environment, compose: service.stack.compose, container: service.stack.container } : null,
    projects: service.projects, credentials: service.credentials.map((credential) => ({ id: credential.id, env: credential.env, key: credential.key,
      custody: `${credential.custody.repository}/${credential.custody.path}`, present: credential.custody.encPresent ?? null })),
    ci: service.ci, ownerAction: service.ownerAction };
}
// ---- the owner-ask guard --------------------------------------------------------------------------------
const asksAboutCustody = (body: string): boolean => /\b(tokens?|secrets?|credentials?|api[ _-]?keys?|passwords?|host|url|access)\b/i.test(body) || /\b(github|repository) (settings?|secrets?|variables?)\b|\bSONAR_[A-Z_]+/i.test(body);
/**
 * An ask that requests what a stack declaration already answers: a service declared `ownerAction: none`
 * whose custody is present (or needs none), named by one of its credential/CI variable names or by the
 * service's name next to a credential word. Returns {service, provider, declaration, matched, message}
 * or null. Declarations read: the asking repository's own (or governing) one, then the source host's
 * when its entry lists this repository.
 */
export function ownerAskConflict({ repo, question }: { repo?: string; question?: unknown } = {}): OwnerAskConflict | null {
  if (!repo || question === undefined || question === null) return null;
  const body = typeof question === 'string' ? question : JSON.stringify(question);
  for (const id of Object.keys(SERVICE_CATALOG)) {
    const service = resolveStackService(repo, id);
    if (!service || service.mode === 'disabled' || service.ownerAction !== 'none' || !custodyHeld(service)) continue;
    const names = [...service.credentials.map((credential) => credential.env), ...service.ci.secrets.map((item) => item.name), ...service.ci.vars.map((item) => item.name)].filter(Boolean);
    const byName = names.find((item) => new RegExp(String.raw`\b${escapeRegExp(item)}\b`).test(body));
    const words = [...new Set([id, service.provider, ...catalogOf(id).words].filter(Boolean))];
    const byWord = words.find((word) => new RegExp(String.raw`\b${escapeRegExp(word)}\b`, 'i').test(body));
    if (!byName && !(byWord && asksAboutCustody(body))) continue;
    const custody = service.credentials.map((credential) => `${credential.custody.repository}/${credential.custody.path}`);
    const custodyNote = custody.length ? ` and its credentials in custody (${custody.join(', ')})` : ` and auth ${service.auth}`;
    const sonarNote = id === 'sonar' ? 'Run starci gate sonar (status, ensure-project, scan) - it reads host, project and token from the declaration and custody. ' : '';
    const provisioningNote = service.ci.provisioning ? ` (${service.ci.provisioning})` : '';
    return { service: id, provider: service.provider, declaration: slash(service.declaration), matched: byName ?? byWord,
      message: `${id} (${service.provider}, ${service.mode}) is declared in ${slash(service.declaration)} with ownerAction none${custodyNote}; the owner is never asked for it. ${sonarNote}CI wiring is ${service.ci.wiring ?? 'undeclared'}${provisioningNote}.` };
  }
  return null;
}
// ---- CLI ------------------------------------------------------------------------------------------------
const USAGE = 'Usage: starci gate starcistacks <repo-root> [--new] [--json]\n\nHolds a repository\'s stack declaration services block (sonar, codecov, dependabot, audit, container-registry, analytics, error-tracking) and its custody layout to modules/schemas/application-stacks.schema.yaml and stacks-layout.yaml. Exit 0 clean (suspects allowed), 1 refused, 2 usage.\n';
async function checkStarciStacksMain(argv: string[] = []): Promise<{ exitCode: number; text: string }> {
  const rest = argv;
  const args = rest.filter((arg) => !['--json', '--new'].includes(arg));
  if (args.includes('--help') || args.includes('-h')) return { exitCode: 0, text: USAGE };
  if (args.length !== 1) return { exitCode: 2, text: USAGE };
  if (!isDir(args[0])) return { exitCode: 2, text: `${args[0]}: not a directory\n` };
  const result = checkStarciStacks(args[0], { newRepo: rest.includes('--new') });
  if (rest.includes('--json')) return { exitCode: result.ok ? 0 : 1, text: `${JSON.stringify(result, null, 2)}\n` };
  const lines = [...result.refused.map((line) => `  REFUSED ${line}`), ...result.suspect.map((line) => `  SUSPECT ${line}`)];
  const fixtureNote = result.followUp?.fixture ? ` from ${result.followUp.fixture}` : '';
  if (result.followUp) lines.push(`  follow-up: ${result.followUp.op} mode ${result.followUp.params.mode}${fixtureNote}`);
  const listing = `${lines.join('\n')}${lines.length ? '\n' : ''}`;
  const verdict = `${result.ok ? 'OK' : 'FAIL'}: starcistacks ${result.repository} - ${result.refused.length} refused, ${result.suspect.length} suspect, services: ${Object.keys(result.services).join(', ') || 'none declared'}.\n`;
  return { exitCode: result.ok ? 0 : 1, text: `${listing}${verdict}` };
}
if (isMain(import.meta.url)) {
  try {
    const { exitCode, text: out } = await checkStarciStacksMain(process.argv.slice(2));
    process.stdout.write(out); process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`check-starcistacks: ${error instanceof Error ? (error.stack ?? error) : error}\n`); process.exitCode = 2;
  }
}

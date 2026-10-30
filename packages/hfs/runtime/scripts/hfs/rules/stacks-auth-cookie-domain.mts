// stacks-auth-cookie-domain.mjs - R337 HFS_AUTH_COOKIE_DOMAIN_MISSING: the api's refresh cookie reaches the web server.
// The lite skeleton's passport sets its refresh cookie host-only on the api host unless `AUTH_COOKIE_DOMAIN` is set. When the web
// is served on app.<domain> and the api on api.<domain>, the web server forwards the browser's Cookie header to the api, and a
// host-only api cookie is not in it: the api refuses the session and the user loops back to sign-in.
//   Judged: a docker-swarm environment of an app whose api uses the skeleton's passport (the lite edition, a tracked
//   `.../src/modules/integrations/passport/passport.config.ts`) and whose rendered stack has the `api` and `web` services.
//   The hosts are read from the rendered stack of the environment, first match wins:
//     web  = web NEXT_PUBLIC_SITE_URL, AUTH_WEB_ORIGIN (api or web), the `deploy.verify.http` url named web, the api's first
//            HTTP_SECURITY_ALLOWED_ORIGINS origin;
//     api  = api AUTH_JWT_ISSUER, api GOOGLE_CALLBACK_URL, web NEXT_PUBLIC_API_URL, the `deploy.verify.http` url named api.
//   An unknown host is not judged. Ports are ignored (a cookie is scoped to a host, not a port).
//   Findings (error): different hosts and no AUTH_COOKIE_DOMAIN (declared by the api's stack environment, listed in the
//   environment's KEYS.md, or sealed under its secrets/); a declared AUTH_COOKIE_DOMAIN that is not a bare domain or is not a
//   parent of the hosts. Limit: no public-suffix list is read, only the common `co.uk` style second-level suffixes are refused.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { envelopeOf } from '../secret-document.mjs';
import { readText } from './read.mjs';
import { stacksDeploymentFindings } from './stacks-runtime.mjs';
import type { Parsed } from './rule-types.mjs';

export const HFS_AUTH_COOKIE_DOMAIN_MISSING = 'HFS_AUTH_COOKIE_DOMAIN_MISSING';
export const AUTH_COOKIE_DOMAIN = 'AUTH_COOKIE_DOMAIN';

type Dict = Record<string, unknown>;
interface Issue { code: string; at: string; message: string }

const PASSPORT_CONFIG = /(?:^|\/)src\/modules\/integrations\/passport\/passport\.config\.ts$/u;
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;
const SECOND_LEVEL_SUFFIX = /^(?:ac|co|com|edu|gov|net|org)\.[a-z]{2}$/u;
const SEALED_MEMBER = /^\.starcistacks\/([^/]+)\/secrets\/[^/]+\.enc(?:\.yaml)?$/u;
const ENV_ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/su;

const dict = (value: unknown): Dict => (plain(value) ? (value as Dict) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The environment of one rendered service as name to value; both the mapping and the `K=V` list forms. */
function environmentOf(service: unknown): Record<string, string> {
  const raw = dict(service).environment, out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const match = typeof entry === 'string' ? ENV_ASSIGNMENT.exec(entry) : null;
      if (match?.[1] !== undefined) out[match[1]] = match[2] ?? '';
    }
    return out;
  }
  for (const [name, value] of Object.entries(dict(raw))) if (value !== null && value !== undefined) out[name] = String(value);
  return out;
}

/** The lower-case host name of an origin or URL text (first entry of a comma list), or undefined. */
function hostOfOrigin(value: string | undefined): string | undefined {
  const first = value?.split(',').map((part) => part.trim()).find((part) => part !== '');
  if (first === undefined || !URL.canParse(first)) return undefined;
  const host = new URL(first).hostname.toLowerCase();
  return host === '' ? undefined : host;
}

const firstHost = (candidates: (string | undefined)[]): string | undefined => {
  for (const candidate of candidates) {
    const host = hostOfOrigin(candidate);
    if (host !== undefined) return host;
  }
  return undefined;
};

/** The `deploy.verify.http` url of the entry whose name mentions `word`, or undefined. */
function verifyUrl(spec: unknown, word: RegExp): string | undefined {
  const entry = list(dict(dict(dict(spec).deploy).verify).http).find((candidate) => word.test(String(dict(candidate).name ?? '')));
  return text(dict(entry).url);
}

/** The public hosts the environment declares for its web and its api; undefined when the stack does not state one. */
export function publicHosts({ model, spec }: { model: unknown; spec: unknown }): { web?: string; api?: string } {
  const services = dict(dict(model).services);
  const api = environmentOf(services.api), web = environmentOf(services.web);
  const webHost = firstHost([web.NEXT_PUBLIC_SITE_URL, api.AUTH_WEB_ORIGIN, web.AUTH_WEB_ORIGIN, verifyUrl(spec, /\bweb\b/iu), api.HTTP_SECURITY_ALLOWED_ORIGINS]);
  const apiHost = firstHost([api.AUTH_JWT_ISSUER, api.GOOGLE_CALLBACK_URL, web.NEXT_PUBLIC_API_URL, verifyUrl(spec, /\bapi\b/iu)]);
  return { ...(webHost === undefined ? {} : { web: webHost }), ...(apiHost === undefined ? {} : { api: apiHost }) };
}

/** The longest shared host suffix of at least two labels that is not a second-level public suffix, or undefined. */
export function commonParentDomain(left: string, right: string): string | undefined {
  const a = left.split('.').reverse(), b = right.split('.').reverse(), shared: string[] = [];
  for (let index = 0; index < Math.min(a.length, b.length) && a[index] === b[index]; index += 1) shared.push(a[index]!);
  const domain = shared.reverse().join('.');
  return shared.length >= 2 && BARE_DOMAIN.test(domain) && !SECOND_LEVEL_SUFFIX.test(domain) ? domain : undefined;
}

const isParentOf = (domain: string, host: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Whether the api's environment provides the key: a declared value, a KEYS.md row or a sealed member key. */
function keyProvided({ environment, api, files, repoRoot }: { environment: string; api: Record<string, string>; files: string[]; repoRoot: string | undefined }): boolean {
  if (AUTH_COOKIE_DOMAIN in api || `${AUTH_COOKIE_DOMAIN}_FILE` in api) return true;
  if (repoRoot === undefined) return false;
  const roster = `.starcistacks/${environment}/runtime/env/KEYS.md`;
  if (files.includes(roster) && (readText(repoRoot, roster) ?? '').includes(`\`${AUTH_COOKIE_DOMAIN}\``)) return true;
  return files.some((file) => {
    if (SEALED_MEMBER.exec(file)?.[1] !== environment) return false;
    const sealed = readText(repoRoot, file);
    if (sealed === null) return false;
    try { return envelopeOf(sealed).keys.includes(AUTH_COOKIE_DOMAIN); } catch { return false; }
  });
}

function declaredValueIssues(value: string, hosts: { web?: string; api?: string }, at: string): Issue[] {
  const domain = value.trim().toLowerCase();
  const issue = (message: string): Issue[] => [{ code: HFS_AUTH_COOKIE_DOMAIN_MISSING, at, message }];
  if (!BARE_DOMAIN.test(domain))
    return issue(`${AUTH_COOKIE_DOMAIN} must be a bare domain such as example.com (no scheme, port, path, leading dot or IP); the api refuses to boot on anything else`);
  const outside = [hosts.web, hosts.api].filter((host): host is string => host !== undefined && !isParentOf(domain, host));
  if (outside.length === 0) return [];
  const parent = hosts.web !== undefined && hosts.api !== undefined ? commonParentDomain(hosts.web, hosts.api) : undefined;
  return issue(`${AUTH_COOKIE_DOMAIN} is ${domain}, which is not a parent of ${outside.join(' and ')}; a browser drops a cookie whose Domain is not a parent of the host that sets it${parent === undefined ? '' : `; set it to ${parent}`}`);
}

/** The R337 issues of one rendered environment. `passport` says whether the api uses the skeleton's passport. */
export function authCookieDomainIssues(input: { environment: string; spec: unknown; model: unknown; files: string[]; repoRoot?: string; passport: boolean }): Issue[] {
  if (!input.passport) return [];
  const services = dict(dict(input.model).services);
  if (!plain(services.api) || !plain(services.web)) return [];
  const hosts = publicHosts(input), api = environmentOf(services.api);
  const at = `services.api.environment.${AUTH_COOKIE_DOMAIN}`;
  const declared = text(api[AUTH_COOKIE_DOMAIN]);
  if (declared !== undefined) return declaredValueIssues(declared, hosts, at);
  if (hosts.web === undefined || hosts.api === undefined || hosts.web === hosts.api) return [];
  if (keyProvided({ environment: input.environment, api, files: input.files, repoRoot: input.repoRoot })) return [];
  const parent = commonParentDomain(hosts.web, hosts.api);
  const remedy = parent === undefined
    ? 'they share no registrable parent domain, so the cookie cannot reach the web server; serve both under one domain'
    : `set ${AUTH_COOKIE_DOMAIN}=${parent} in the api's environment (the stack environment, KEYS.md or a sealed key)`;
  return [{ code: HFS_AUTH_COOKIE_DOMAIN_MISSING, at: `environments.${input.environment}`,
    message: `the web is served on ${hosts.web} and the api on ${hosts.api}, so the api's refresh cookie is host-only on ${hosts.api} and is missing from the Cookie header the web server forwards (a login loop); ${remedy}` }];
}

/** HFS finder over the tracked rendered Swarm environments of the lite app root whose api uses the skeleton's passport. */
export function stacksAuthCookieDomainFindings(context: Parsed) {
  if (context?.repo?.edition !== 'lite') return [];
  const files: string[] = context.all ?? context.files ?? [];
  const passport = files.some((file) => PASSPORT_CONFIG.test(file));
  if (!passport) return [];
  return stacksDeploymentFindings(context, (entry: { environment: string; spec: unknown; model: unknown }) =>
    authCookieDomainIssues({ environment: entry.environment, spec: entry.spec, model: entry.model, files, repoRoot: context.repoRoot, passport }));
}

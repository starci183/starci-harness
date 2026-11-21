// R266: declaration-bound Swarm custody, routing and service safety.
import path from 'node:path';
import fs from 'node:fs';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { composeEntries } from '../../lib/compose-values.mjs';
import { list } from '../../lib/list.mjs';
import { repositoryOf } from '../../lib/stack-services.mjs';
import { isInside } from '../../lib/walk.mjs';
import { readText } from './read.mjs';
import { edgeRoutes, externalIngressStack, sharedEdge } from './stacks-ingress.mjs';
import { stacksDeploymentFindings } from './stacks-runtime.mjs';
import type { Parsed } from './rule-types.mjs';

const mapping = (value: Parsed) => plain(value) ? value : {};
const present = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const VERSION = /^[1-9]\d*$/;
const VERSIONED_SECRET = /-v[1-9]\d*$/;
const SENSITIVE_KEY = /password|passwd|secret|token|credential|private[_-]?key|api[_-]?key|service[_-]?role|(?:(?:^|_)key$)/i;
const HOST = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i;

function secretVersionMatches(declaration: Parsed, secret: Parsed) {
  const version = String(declaration.version ?? '');
  return VERSION.test(version) && present(declaration.runtimeName)
    && declaration.runtimeName.endsWith(`-v${version}`) && secret.name === declaration.runtimeName;
}

function secretCustodyIssues(spec: Parsed, model: Parsed, add: Parsed) {
  const secrets = mapping(model.secrets);
  const declarations = new Map<string, Parsed>(list(spec.secrets).map((entry: Parsed): [string, Parsed] => [entry?.name, entry]));
  const names = new Set<string>([...Object.keys(secrets), ...declarations.keys()]);
  for (const name of names) {
    const secret = mapping(secrets[name]), declaration = mapping(declarations.get(name));
    const at = `secrets.${name}`;
    if (secret.external !== true || ['file', 'environment', 'content', 'value'].some(key => secret[key] !== undefined))
      add('STACKS_SECRET_NOT_EXTERNAL', at, 'Swarm secrets must be external engine secrets without an embedded source');
    if (!present(secret.name) || !VERSIONED_SECRET.test(secret.name) || !secretVersionMatches(declaration, secret))
      add('STACKS_SECRET_UNVERSIONED', at, 'Declare runtimeName and a positive version matching the immutable rendered secret name <logical>-v<N>');
  }
}

function grantedSecretTargets(service: Parsed, secrets: Parsed) {
  const targets = new Set();
  for (const entry of list<Parsed>(service.secrets)) {
    const source = plain(entry) ? entry.source : entry;
    if (!Object.hasOwn(secrets, source)) continue;
    const target = plain(entry) ? entry.target ?? source : source;
    if (present(target) && !target.includes('/') && !target.includes('..')) targets.add(`/run/secrets/${target}`);
  }
  return targets;
}

function sensitiveEnvironmentKey(key: string, declarations: Parsed) {
  const normalized = key.toUpperCase().replaceAll('-', '_');
  return SENSITIVE_KEY.test(key) || declarations.some((entry: Parsed) => entry?.name?.toUpperCase().replaceAll('-', '_') === normalized);
}

function credentialUri(value: Parsed) {
  if (!present(value)) return false;
  try {
    const uri = new URL(value);
    return Boolean(uri.password);
  } catch { return false; }
}

function environmentSecretIssues(id: string, service: Parsed, spec: Parsed, model: Parsed, add: Parsed) {
  const targets = grantedSecretTargets(service, mapping(model.secrets));
  for (const [key, value] of composeEntries(service.environment, { missingValue: null })) {
    if (key.endsWith('_FILE')) {
      const secretFile = sensitiveEnvironmentKey(key.slice(0, -5), list(spec.secrets)) || String(value).startsWith('/run/secrets/') || credentialUri(value);
      if (secretFile && !targets.has(value)) add('STACKS_SECRET_ENV_LITERAL', `services.${id}.environment.${key}`, 'A secret file binding must name the exact /run/secrets target granted to this service');
      continue;
    }
    if (sensitiveEnvironmentKey(key, list(spec.secrets)) || credentialUri(value))
      add('STACKS_SECRET_ENV_LITERAL', `services.${id}.environment.${key}`, 'Sensitive environment bindings must use a granted Swarm secret file; secret values must never be embedded');
  }
  for (const entry of list<Parsed>(service.secrets)) {
    const source = plain(entry) ? entry.source : entry;
    if (!Object.hasOwn(mapping(model.secrets), source))
      add('STACKS_SECRET_NOT_EXTERNAL', `services.${id}.secrets`, 'A service grant must reference a declared external engine secret');
  }
}

// Ingress mode goes through the routing mesh, which rewrites the client source IP; only the ingress, whose per-IP limits need the real
// client address behind its single proxy hop, may publish in host mode.
function allowedPort(entry: Parsed, ingress: boolean) {
  if (plain(entry)) return [undefined, 'ingress', ...(ingress ? ['host'] : [])].includes(entry.mode) && [80, 443].includes(Number(entry.published));
  if (typeof entry !== 'string') return false;
  const parts = String(entry).split('/')[0]!.split(':');
  return parts.length > 1 && [80, 443].includes(Number(parts.at(-2)));
}

function hostModePort(entry: Parsed) {
  return plain(entry) && entry.mode === 'host';
}

function publishedPortIssues(id: string, service: Parsed, spec: Parsed, add: Parsed) {
  if (service.ports === undefined || (Array.isArray(service.ports) && !service.ports.length)) return;
  const ingress = id === spec.ingress?.component;
  if (!ingress || !Array.isArray(service.ports) || !service.ports.every((entry: Parsed) => allowedPort(entry, ingress)))
    add('STACKS_PORT_PUBLISHED', `services.${id}.ports`, 'Only the declared ingress may publish ports, using ingress mode (or host mode, for the real client IP) and published ports 80 or 443');
  else if (service.ports.some(hostModePort) && service.deploy?.mode !== 'global' && !list(service.deploy?.placement?.constraints).some(present))
    add('STACKS_PORT_PUBLISHED', `services.${id}.deploy.placement`, 'An ingress publishing in host mode listens on every node it runs on, so it must be global mode or pinned by a placement constraint');
}

function hostOf(value: Parsed) {
  if (!present(value)) return null;
  let candidate = (value.trim().replace(/^https?:\/\//i, '').split('/')[0] as string).split(':')[0] as string; // split always yields one element
  candidate = candidate.toLowerCase().replace(/\.$/, '');
  return HOST.test(candidate) ? candidate : null;
}

function traefikHosts(rule: Parsed) {
  const hosts = [], text = String(rule);
  for (const match of text.matchAll(/\bHost\s*\(/g)) {
    if (!positiveHostCall(text.slice(0, match.index))) continue;
    const part = text.slice(match.index + match[0].length);
    const argumentsText = part.split(')')[0];
    for (const argument of argumentsText!.split(',')) {
      const quoted = argument.trim();
      if (!['`', '"', "'"].includes(quoted[0]!) || quoted.at(-1) !== quoted[0]) continue;
      const domain = quoted.slice(1, -1).toLowerCase();
      const host = HOST.test(domain) ? domain : null;
      if (host) hosts.push(host);
    }
  }
  return hosts;
}

function positiveHostCall(prefix: string) {
  const scopes = [false];
  let pending = false;
  for (const token of prefix.match(/"[^"]*"|'[^']*'|`[^`]*`|[()!]|[A-Za-z_]\w*|\S/g) ?? []) {
    if (token === '!') { pending = !pending; continue; }
    if (token === '(') scopes.push(scopes.at(-1) !== pending);
    if (token === ')' && scopes.length > 1) scopes.pop();
    pending = false;
  }
  return !scopes.at(-1) && !pending;
}

function labelHosts(service: Parsed, family: Parsed) {
  const hosts: Parsed[] = [];
  const labels = [...composeEntries(service.labels, { missingValue: null }), ...composeEntries(service.deploy?.labels, { missingValue: null })];
  if (family === 'traefik' && labels.some(([key, value]) => key === 'traefik.enable' && String(value) === 'false')) return hosts;
  for (const [key, value] of labels) {
    if (family === 'traefik' && key.startsWith('traefik.http.routers.') && key.endsWith('.rule')) hosts.push(...traefikHosts(value));
    if (family === 'caddy-docker-proxy' && /^caddy(?:_\d+)?$/.test(key)) hosts.push(...String(value).split(/[\s,]+/).map(hostOf).filter(Boolean));
  }
  return hosts;
}

function safeRegularFile(repoRoot: string, file: string) {
  const base = path.resolve(repoRoot), target = path.resolve(base, file);
  if (!isInside(base, target)) return false;
  try {
    if (!fs.lstatSync(target).isFile()) return false;
    let cursor = target;
    while (cursor !== base) {
      if (fs.lstatSync(cursor).isSymbolicLink()) return false;
      cursor = path.dirname(cursor);
    }
    return true;
  } catch {
    return false;
  }
}

function trackedConfigText(input: Parsed, relative: string) {
  if (!present(relative) || /\.enc(?:\.yaml)?$/.test(relative) || path.isAbsolute(relative)) return null;
  const directory = `.starcistacks/${input.environment}/`;
  const stack = input.spec.renderedModel ?? input.spec.composeFiles?.[0] ?? 'infra/swarm/stack.yaml';
  const file = path.posix.normalize(path.posix.join(directory, path.posix.dirname(stack), relative));
  const allowed = file.startsWith(`${directory}infra/`) || file.startsWith(`${directory}runtime/config/`);
  if (!allowed || file.includes('/secrets/') || !list(input.files).includes(file) || !input.repoRoot) return null;
  if (!safeRegularFile(input.repoRoot, file)) return null;
  return readText(input.repoRoot, file);
}

function caddyConfigSources(service: Parsed, model: Parsed) {
  const sources = [];
  for (const entry of list<Parsed>(service.configs)) {
    const source = plain(entry) ? entry.source : entry;
    const config = mapping(model.configs)[source];
    if (present(config?.file)) sources.push(config.file);
  }
  for (const entry of list(service.volumes)) {
    if (plain(entry) && entry.type === 'bind' && String(entry.target).endsWith('/Caddyfile')) sources.push(entry.source);
    if (typeof entry === 'string') {
      const [source, target] = entry.split(':');
      if (target?.endsWith('/Caddyfile')) sources.push(source);
    }
  }
  return sources;
}

function caddyfileHosts(text: string | null) {
  const hosts = [];
  let depth = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const clean = line.split('#')[0]!.trim();
    if (depth === 0 && clean.includes('{')) {
      const header = clean.split('{')[0];
      hosts.push(...header!.split(/[\s,]+/).map(hostOf).filter(Boolean));
    }
    depth += clean.split('{').length - clean.split('}').length;
    depth = Math.max(0, depth);
  }
  return hosts;
}

function routedHosts(input: Parsed) {
  const hosts = new Set<string | null>();
  const ingress = mapping(input.model.services)[input.spec.ingress?.component];
  const family = sharedEdge(input.spec) ? 'traefik' : repositoryOf(String(ingress?.image ?? '')).toLowerCase();
  for (const service of Object.values<Parsed>(mapping(input.model.services))) {
    for (const host of labelHosts(service, family)) hosts.add(host);
  }
  if (!family.startsWith('caddy')) return hosts;
  for (const source of caddyConfigSources(mapping(ingress), input.model)) {
    for (const host of caddyfileHosts(trackedConfigText(input, source))) hosts.add(host);
  }
  return hosts;
}

function publicRoutingIssues(input: Parsed, add: Parsed) {
  const { spec } = input, routed = routedHosts(input);
  const edge = sharedEdge(spec);
  const declared = new Set([...list(spec.ingress?.hosts), ...(edge ? edgeRoutes(spec).map((route: Parsed) => route?.host) : [])].map(hostOf).filter(Boolean));
  const dns = list(spec.dns);
  // A shared edge's hostnames live in the declaration only: the stack file carries none (its deploy renders the labels from ingress.routes). A tracked rendered model is the rendered output, which may.
  if (edge) for (const host of routed) {
    if (!declared.has(host) || !present(spec.renderedModel))
      add('STACKS_HOST_UNROUTED', `environments.${input.environment}.ingress.routes`, `the stack file names the host ${host}: hostnames are declared once in ingress.routes and rendered into the Traefik labels by the stack deploy, never written in the stack file`);
  }
  for (const host of new Set([...declared, ...routed])) {
    if (!dns.some((entry: Parsed) => hostOf(entry?.host) === host && present(entry.owner) && present(entry.receipt)))
      add('STACKS_DNS_UNDECLARED', `environments.${input.environment}.dns`, 'Each public host must declare its DNS owner and receipt');
    // An external shared ingress routes the hosts from its own dynamic files (published by `starci app stack ingress publish`), not from labels here.
    if (!declared.has(host) || (externalIngressStack(spec) === null && !edge && !routed.has(host)))
      add('STACKS_HOST_UNROUTED', `environments.${input.environment}.ingress.hosts`, 'Each public host must be declared and bound by an actual ingress route');
  }
  const ingress = mapping(input.model.services)[spec.ingress?.component];
  const publicIngress = declared.size || routed.size || list(ingress?.ports).length;
  if (publicIngress && (!present(spec.tls?.owner) || !present(spec.tls?.receipt)))
    add('STACKS_TLS_UNDECLARED', `environments.${input.environment}.tls`, 'Public ingress must declare its TLS owner and issuance/persistence receipt');
}

function usesPersistentVolume(service: Parsed) {
  return list(service.volumes).some((entry: unknown) => {
    if (plain(entry)) return entry.type === 'volume' || (present(entry.source) && !entry.source.startsWith('/'));
    if (typeof entry !== 'string' || !entry.includes(':')) return false;
    const source = entry.split(':')[0];
    return present(source) && !source!.startsWith('.') && !source!.startsWith('/') && !source!.includes(String.fromCodePoint(92));
  });
}

function placementIssues(id: string, component: Parsed, service: Parsed, add: Parsed) {
  const stateful = component.stateful === true || component.role === 'stateful' || present(component.database?.provider)
    || list(component.volumes).length > 0 || usesPersistentVolume(service);
  if (!stateful) return;
  const constraints = list(service.deploy?.placement?.constraints);
  if (!constraints.length || !constraints.every(present))
    add('STACKS_SERVICE_POLICY_MISSING', `services.${id}.deploy.placement`, 'Stateful services and persistent volumes must declare node placement constraints');
}

function healthCommand(test: Parsed) {
  if (present(test)) return test.trim();
  if (!Array.isArray(test) || !['CMD', 'CMD-SHELL'].includes(test[0]) || !test.slice(1).every(present)) return null;
  return test.slice(1).join(' ').trim();
}

function nontrivialHealthcheck(healthcheck: Parsed) {
  const command = healthCommand(healthcheck.test);
  if (healthcheck.disable === true || !command || command === 'NONE') return false;
  const unwrapped = command.replace(/^(?:\/bin\/)?(?:ba)?sh\s+-c\s+/, '').replace(/^["']|["']$/g, '').trim();
  const executable = (unwrapped.split(/\s/)[0] as string).split('/').at(-1) as string; // split yields at least one element
  return !['true', ':', 'echo'].includes(executable) && !/^exit\s+0(?:\s|$)/.test(unwrapped)
    && !/\|\|\s*(?:true|exit\s+0)(?:\s|$)/.test(unwrapped)
    && !endsWithSuccessfulCommand(unwrapped)
    && !/process\.exit\(\s*0\s*\)/.test(unwrapped);
}

function endsWithSuccessfulCommand(command: string) {
  const commands = command.split(/[;\n]/);
  if (commands.length < 2) return false;
  const last = commands.at(-1)!.trim();
  return last === 'true' || /^exit\s+0$/.test(last);
}

function positiveMonitor(value: Parsed) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (!present(value)) return false;
  const units = value.match(/[a-z]+/g) ?? [], quantities = value.split(/[a-z]+/);
  if (quantities.pop() !== '' || !units.length) return false;
  return units.every((unit: Parsed) => ['ns', 'us', 'ms', 's', 'm', 'h'].includes(unit))
    && quantities.every((quantity: Parsed) => /^\d+(?:\.\d+)?$/.test(quantity)) && /[1-9]/.test(value);
}

function updatePolicyIssues(id: string, service: Parsed, add: Parsed) {
  const deploy = mapping(service.deploy), update = mapping(deploy.update_config);
  const updateValid = ['start-first', 'stop-first'].includes(update.order) && update.failure_action === 'rollback' && positiveMonitor(update.monitor);
  const rollbackValid = Object.keys(mapping(deploy.rollback_config)).length > 0;
  const restartValid = ['none', 'any', 'on-failure'].includes(deploy.restart_policy?.condition);
  if (!updateValid || !rollbackValid || !restartValid)
    add('STACKS_SERVICE_POLICY_MISSING', `services.${id}.deploy`, 'Declare update order, failure_action: rollback, a positive monitor, rollback_config and restart_policy');
}

/** Machine issues shared by the HFS finder and the rendered-model gate; no secret contents are read or returned. */
export function swarmHardeningIssues(input: Parsed) {
  const normalized = { ...input, doc: mapping(input.doc), spec: mapping(input.spec), model: mapping(input.model) };
  const issues: Parsed[] = [], add = (code: string, at: Parsed, message: string) => issues.push({ code, at, message });
  secretCustodyIssues(normalized.spec, normalized.model, add);
  for (const [id, value] of Object.entries<Parsed>(mapping(normalized.model.services))) {
    const service = mapping(value), component = mapping(normalized.doc.components)[id] ?? {};
    environmentSecretIssues(id, service, normalized.spec, normalized.model, add);
    publishedPortIssues(id, service, normalized.spec, add);
    placementIssues(id, component, service, add);
    if (!nontrivialHealthcheck(mapping(service.healthcheck)))
      add('STACKS_SERVICE_POLICY_MISSING', `services.${id}.healthcheck`, 'Every Swarm service needs an enabled healthcheck that can fail when its process is unhealthy');
    updatePolicyIssues(id, service, add);
  }
  publicRoutingIssues(normalized, add);
  return issues;
}

/** R266 findings at the app root, over each available tracked rendered Swarm model. */
export function stacksSwarmFindings(context: Parsed) {
  return stacksDeploymentFindings(context, swarmHardeningIssues);
}

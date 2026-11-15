// local-tunnel.mts - the dev tunnel routes of `environments.<env>.local.tunnel` (PROJECT-STACKS-15), made by `starci app stack up --env <env> --execute` and
// read back by `stack verify`. The tunnel is the machine's locally managed named tunnel (`cloudflared tunnel create <name>` once): its ingress file is
// `<cloudflared home>/<name>.yml`, its DNS records are made with `cloudflared --config <that file> tunnel route dns --overwrite-dns <its tunnel id> <host>`
// over the account certificate (`cert.pem`) of that home, so no dashboard step is needed. The command names the tunnel's own ingress file and the id
// that file holds: without `--config`, cloudflared reads the home's default `config.yml`, whose `tunnel:` (another tunnel of the machine) wins over the
// name, and the record lands on the wrong tunnel. Nothing here reads or prints a credential: only host names, ports, the tunnel id and the file path.
// The ingress file is edited as text: a missing declared host is inserted before its catch-all rule, every other line stays; a declared host that
// already routes elsewhere is a refusal (the declaration and the machine disagree), never a silent rewrite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { LocalConfig } from './local-config.mjs';

/** The folder `cloudflared` keeps its certificate, credentials and local tunnel configuration in. */
export const cloudflaredHome = (ctx: StackContext): string => ctx.env.CLOUDFLARED_HOME ?? path.join(os.homedir(), '.cloudflared');

/** The loopback service one route points at. */
export const routeService = (local: LocalConfig, port: string): string => `http://127.0.0.1:${local.ports[port]}`;

const CATCH_ALL = /^(\s*)-\s+service:\s*http_status:\d+\s*$/u;

/** The tunnel id (`tunnel:`) of the tunnel's own ingress file, the one the DNS records route to. Pure. */
export function tunnelIdOf(text: string, file: string): string {
  let doc: { tunnel?: unknown } | null;
  try { doc = parseYaml(text) as typeof doc; } catch { throw refusal('STACK_LOCAL_TUNNEL_CONFIG', `${file} is not valid YAML`); }
  const id = typeof doc?.tunnel === 'string' ? doc.tunnel.trim() : '';
  if (id === '') throw refusal('STACK_LOCAL_TUNNEL_CONFIG', `${file} names no tunnel (\`tunnel: <id>\`, the id \`cloudflared tunnel create\` printed): the DNS records are routed to that id`);
  return id;
}

/** The arguments of one DNS route: the tunnel's own ingress file and its id, never the home's default `config.yml`. Pure. */
export const routeDnsArgs = (file: string, id: string, host: string): string[] => ['--config', file, 'tunnel', 'route', 'dns', '--overwrite-dns', id, host];

/** The tunnel id cloudflared says it routed a host to (`tunnelID=<id>` in its log lines), or null when it names none. Pure. */
export const routedTunnelOf = (output: string): string | null => /tunnelID=([0-9a-f-]{8,})/iu.exec(output)?.[1] ?? null;

/** The ingress file of the tunnel after the declared routes are in it: `text` unchanged when each is already routed to its service. Pure. */
export function withRoutes(text: string, wanted: ReadonlyArray<{ host: string; service: string }>, file: string): { text: string; added: string[] } {
  let doc: { ingress?: Array<{ hostname?: string; service?: string }> } | null;
  try { doc = parseYaml(text) as typeof doc; } catch { throw refusal('STACK_LOCAL_TUNNEL_CONFIG', `${file} is not valid YAML`); }
  const present = new Map((doc?.ingress ?? []).flatMap((rule) => (typeof rule.hostname === 'string' ? [[rule.hostname, rule.service ?? ''] as const] : [])));
  const missing: Array<{ host: string; service: string }> = [];
  for (const route of wanted) {
    const current = present.get(route.host);
    if (current === undefined) missing.push(route);
    else if (current !== route.service) throw refusal('STACK_LOCAL_TUNNEL_CONFLICT', `${file} routes ${route.host} to ${current}, the declaration routes it to ${route.service}: fix the one that is wrong (the declaration is the authority; edit the ingress rule by hand)`);
  }
  if (missing.length === 0) return { text, added: [] };
  const lines = text.split(/\r?\n/u);
  const at = lines.findIndex((line) => CATCH_ALL.test(line));
  if (at < 0) throw refusal('STACK_LOCAL_TUNNEL_CONFIG', `${file} has no catch-all ingress rule (- service: http_status:404) to insert the routes before`);
  const indent = (CATCH_ALL.exec(lines[at] as string) as RegExpExecArray)[1] as string;
  const rules = missing.flatMap((route) => [`${indent}- hostname: ${route.host}`, `${indent}  service: ${route.service}`]);
  lines.splice(at, 0, ...rules);
  return { text: lines.join(text.includes('\r\n') ? '\r\n' : '\n'), added: missing.map((route) => route.host) };
}

/** The doctor rows of the tunnel: the binary, the account certificate and the ingress file the routes are made with. Empty without a declared tunnel. */
export function tunnelRows(ctx: StackContext, local: LocalConfig): Array<{ id: string; ok: boolean; detail: string; fix: string | null }> {
  if (local.tunnel === undefined) return [];
  const home = cloudflaredHome(ctx);
  const binary = ctx.spawn('cloudflared', ['--version']).status === 0;
  const cert = fs.existsSync(path.join(home, 'cert.pem'));
  const file = path.join(home, `${local.tunnel.name}.yml`);
  const present = fs.existsSync(file);
  let id: string | null = null;
  if (present) { try { id = tunnelIdOf(fs.readFileSync(file, 'utf8'), file); } catch { id = null; } }
  return [
    { id: 'cloudflared', ok: binary, detail: binary ? 'installed' : 'not found on PATH', fix: binary ? null : 'winget install Cloudflare.cloudflared (Windows), brew install cloudflared (macOS), or the cloudflared package of your distribution' },
    { id: 'tunnel certificate', ok: cert, detail: cert ? `${path.join(home, 'cert.pem')} present` : `${path.join(home, 'cert.pem')} absent`, fix: cert ? null : 'cloudflared tunnel login (once per machine)' },
    { id: `tunnel ${local.tunnel.name}`, ok: id !== null, detail: !present ? `${file} absent` : id === null ? `${file} names no tunnel id (tunnel: <id>)` : `${file} present, tunnel ${id}`, fix: id !== null ? null : present ? `write the id cloudflared tunnel create ${local.tunnel.name} printed as tunnel: <id> in ${file}` : `cloudflared tunnel create ${local.tunnel.name}, then write ${file} with its ingress` },
  ];
}

/** The plan lines of a dry run. */
export const planTunnel = (local: LocalConfig): string[] => (local.tunnel === undefined ? [] : local.tunnel.routes.map((route) => `plan tunnel ${local.tunnel?.name ?? ''}: https://${route.host} -> ${routeService(local, route.port)} (ingress rule, DNS record)`));

/** `up --execute`: the ingress rules and DNS records of the declared routes, then one reachability read per route (a wait, never a failure: DNS may need a moment). */
export async function routeTunnel(ctx: StackContext, local: LocalConfig): Promise<string[]> {
  const tunnel = local.tunnel;
  if (tunnel === undefined) return [];
  const home = cloudflaredHome(ctx);
  const file = path.join(home, `${tunnel.name}.yml`);
  if (!fs.existsSync(path.join(home, 'cert.pem'))) throw refusal('STACK_LOCAL_TUNNEL_CERT', `${path.join(home, 'cert.pem')} is absent: run \`cloudflared tunnel login\` once on this machine (the account certificate the DNS records are made with)`);
  if (!fs.existsSync(file)) throw refusal('STACK_LOCAL_TUNNEL_CONFIG', `${file} is absent: create the tunnel once with \`cloudflared tunnel create ${tunnel.name}\` and give it an ingress file (\`tunnel: <id>\`, \`credentials-file\`, \`ingress:\` ending in \`- service: http_status:404\`)`);
  const lines: string[] = [];
  const text = fs.readFileSync(file, 'utf8');
  const id = tunnelIdOf(text, file);
  const next = withRoutes(text, tunnel.routes.map((route) => ({ host: route.host, service: routeService(local, route.port) })), file);
  if (next.added.length > 0) {
    fs.writeFileSync(file, next.text);
    lines.push(`tunnel ${tunnel.name}: ingress rule added for ${next.added.join(', ')} in ${file}; restart the connector of ${tunnel.name} so it reads the file (cloudflared reads it at start)`);
  } else lines.push(`tunnel ${tunnel.name}: every declared host already has its ingress rule`);
  for (const route of tunnel.routes) {
    const result = ctx.spawn('cloudflared', routeDnsArgs(file, id, route.host), { env: { ...ctx.env, TUNNEL_ORIGIN_CERT: path.join(home, 'cert.pem') } });
    if (result.status !== 0) throw refusal('STACK_LOCAL_TUNNEL_DNS', `cloudflared could not route ${route.host} to the tunnel ${tunnel.name} (${id}): ${(result.stderr || (result.error?.message ?? '')).trim().split(/\r?\n/u)[0]?.slice(0, 200) ?? ''}`);
    const routed = routedTunnelOf(`${result.stdout}\n${result.stderr}`);
    if (routed !== null && routed !== id) throw refusal('STACK_LOCAL_TUNNEL_DNS', `cloudflared routed ${route.host} to the tunnel ${routed}, not to ${tunnel.name} (${id}) that ${file} names: route it again with \`cloudflared --config ${file} tunnel route dns --overwrite-dns ${id} ${route.host}\``);
    lines.push(`tunnel ${tunnel.name}: DNS routes ${route.host} to the tunnel ${id}`);
  }
  lines.push(...await probeRoutes(ctx, local, false));
  return lines;
}

/** One read of the public side of an object-store route (`/minio/health/live` on the host): the proof the link a browser or a provider follows reaches the store. */
export async function probeRoutes(ctx: StackContext, local: LocalConfig, strict: boolean): Promise<string[]> {
  const stores = new Set(local.services.filter((service) => service.kind === 'object-store' && service.port !== null).map((service) => service.port));
  const lines: string[] = [];
  for (const route of local.tunnel?.routes ?? []) {
    if (!stores.has(route.port)) continue;
    const url = `https://${route.host}/minio/health/live`;
    let status: number | string;
    try { status = (await ctx.fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })).status; } catch (error) { status = (error as Error).message.slice(0, 80); }
    lines.push(`${status === 200 ? 'ok    ' : strict ? 'FAIL  ' : 'WAIT  '}public ${route.name}: GET ${url} -> ${String(status)}`);
  }
  return lines;
}

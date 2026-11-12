// stack-base-port.mts - the project base port of a dev environment (`environments.<env>.local.basePort`, PROJECT-STACKS-10) and the role table every
// host port of that environment follows, so two apps on one machine never collide. Pure functions over the normalised local block: the check rule
// R389 (rules/stacks-local.mts), `starci app stack doctor` (stack/local-doctor.mts), the scaffold (scaffold/app.mts) and the upgrade `starci app sync`
// makes (sync/dev-services.mts) all read them.
//
// The role table, base = `local.basePort`:
//   native processes (a process with a `port`; its role is its name, a name outside the lists below is `other`)
//     frontend  the primary front end (the first process of the frontend role)  base
//     api       the api (the first process of the api role)                      base + 1
//     gateway   the AI gateway (the first process of the gateway role)           base + 2   (the ai-router convention: the api port + 1)
//     other     every further native process (mcp, landing, further next apps, workers with a port)
//               base + 3 .. base + 79 when a gateway process is declared, base + 2 .. base + 79 when none is
//   compose services (a port of `local.ports` no native process holds; its role is the port's name, the database's is the port `local.database` names)
//     db               the database                                                 base + 90
//     mail             the dev mail sink's SMTP port                                base + 91
//     mailui           the dev mail sink's web UI                                   base + 92
//     storage          the dev object store's S3 API                                base + 93
//     storage-console  the dev object store's console                               base + 94
//     any other compose port (a cache, a vector store, an identity server) takes a free port of base + 80 .. base + 99; not judged yet
// A role no process or service plays leaves its slot empty; base and base + 1 stay reserved for the front end and the api either way.
// Every compose file of an environment with a base publishes its host ports from `local.ports` (`${STACK_PORT_<NAME>}`), never a literal port.
import type { LocalBlock } from './stack-local-config.mjs';

/** The number of consecutive ports a project owns from its base: base .. base + 99. */
export const BASE_PORT_SPAN = 100;

/** The first offset of the compose band: native processes stay below it, compose service ports take base + 80 .. base + 99. */
export const COMPOSE_BAND = 80;

/** The ports the owner reserves for the shared UI-lane `next dev` preview, which runs outside any app's stack: no app's base range may overlap it. */
export const RESERVED_PORTS = Object.freeze({ from: 3900, to: 3999 });

/** True when the range base..base+99 shares a port with the reserved preview range. */
export const overlapsReserved = (base: number): boolean => base <= RESERVED_PORTS.to && base + BASE_PORT_SPAN - 1 >= RESERVED_PORTS.from;

/** The roles of the native table. */
export type PortRole = 'frontend' | 'api' | 'gateway' | 'other';

/** Process names by role; a name in none of the lists is `other`. */
export const ROLE_NAMES: Readonly<Record<Exclude<PortRole, 'other'>, readonly string[]>> = Object.freeze({
  frontend: ['web', 'app', 'console', 'fe', 'frontend'],
  api: ['api', 'core', 'be', 'backend'],
  gateway: ['gateway', 'ai-gateway', 'ai-router'],
});

/** The compose roles of the table, by port name (`db` stands for the port `local.database` names), and the offset of each from the base. */
export const COMPOSE_ROLES: Readonly<Record<'db' | 'mail' | 'mailui' | 'storage' | 'storage-console', number>> = Object.freeze({
  db: 90,
  mail: 91,
  mailui: 92,
  storage: 93,
  'storage-console': 94,
});

/** A compose role of the table. */
export type ComposeRole = keyof typeof COMPOSE_ROLES;

/** The host port of a compose role for a base: base + its offset. */
export const composePort = (base: number, role: ComposeRole): number => base + COMPOSE_ROLES[role];

/** The role a process name plays in the table. */
export function roleOf(name: string): PortRole {
  for (const role of ['frontend', 'api', 'gateway'] as const) if (ROLE_NAMES[role].includes(name)) return role;
  return 'other';
}

/** The ports a base owns, both ends included. */
export const rangeOf = (base: number): { from: number; to: number } => ({ from: base, to: base + BASE_PORT_SPAN - 1 });

/** True when the ranges of two bases share a port. */
export const rangesOverlap = (a: number, b: number): boolean => Math.abs(a - b) < BASE_PORT_SPAN;

/** One departure from the role table: `code` is the failure code, `at` names the process or port, `message` says the port it must have. */
export interface BasePortProblem { code: 'STACKS_BASE_PORT_ROLE' | 'STACKS_COMPOSE_PORT_ROLE'; at: string; message: string }

type Judged = Pick<LocalBlock, 'basePort' | 'ports' | 'processes'> & { database?: Pick<NonNullable<LocalBlock['database']>, 'port'> | null };

/** The native processes of the block that hold a declared port, in declaration order. */
export function nativeProcesses(block: Pick<LocalBlock, 'ports' | 'processes'>): Array<{ name: string; port: number; role: PortRole }> {
  return block.processes.flatMap((process) => {
    const port = process.port === null ? undefined : block.ports[process.port];
    return port === undefined ? [] : [{ name: process.name, port, role: roleOf(process.name) }];
  });
}

/** The compose role a port of the block plays, or null: the port the database names is `db`, a port named like a role is that role; a port a native process holds plays none. */
export function composeRoleOf(block: Pick<Judged, 'processes' | 'database'>, name: string): ComposeRole | null {
  if (block.processes.some((process) => process.port === name)) return null;
  if (block.database?.port === name) return 'db';
  if (name === 'db') return block.database ? null : 'db';
  return Object.hasOwn(COMPOSE_ROLES, name) ? (name as ComposeRole) : null;
}

/** The compose ports of the block that play a role of the table: port name, role and declared port, in declaration order. */
export function composePorts(block: Pick<Judged, 'ports' | 'processes' | 'database'>): Array<{ name: string; role: ComposeRole; port: number }> {
  return Object.entries(block.ports).flatMap(([name, port]) => {
    const role = composeRoleOf(block, name);
    return role === null ? [] : [{ name, role, port }];
  });
}

function nativeProblems(base: number, block: Judged): BasePortProblem[] {
  const processes = nativeProcesses(block);
  const first = new Map<PortRole, string>();
  for (const process of processes) if (process.role !== 'other' && !first.has(process.role)) first.set(process.role, process.name);
  const low = first.has('gateway') ? base + 3 : base + 2;
  const high = base + COMPOSE_BAND - 1;
  const problems: BasePortProblem[] = [];
  const exact: Record<Exclude<PortRole, 'other'>, { port: number; what: string }> = {
    frontend: { port: base, what: 'the primary front end: basePort' },
    api: { port: base + 1, what: 'the api: basePort + 1' },
    gateway: { port: base + 2, what: 'the AI gateway: basePort + 2' },
  };
  for (const process of processes) {
    const own = process.role !== 'other' && first.get(process.role) === process.name ? exact[process.role] : null;
    if (own) {
      if (process.port !== own.port) problems.push({ code: 'STACKS_BASE_PORT_ROLE', at: `processes.${process.name}`, message: `is ${own.what} = ${own.port}, not ${process.port}` });
    } else if (process.port < low || process.port > high) {
      problems.push({ code: 'STACKS_BASE_PORT_ROLE', at: `processes.${process.name}`, message: `is a further native process: its port must be from ${low} to ${high} (basePort ${first.has('gateway') ? '+ 3' : '+ 2'} to basePort + ${COMPOSE_BAND - 1}), not ${process.port}` });
    }
  }
  return problems;
}

/** The departures of the block's host ports from the role table of its `basePort` (native processes, then compose roles); none when no base is declared. */
export function basePortProblems(block: Judged): BasePortProblem[] {
  const base = block.basePort;
  if (base === null) return [];
  const compose = composePorts(block)
    .filter((entry) => entry.port !== composePort(base, entry.role))
    .map((entry): BasePortProblem => ({ code: 'STACKS_COMPOSE_PORT_ROLE', at: `ports.${entry.name}`, message: `is the ${entry.role} compose port: basePort + ${COMPOSE_ROLES[entry.role]} = ${composePort(base, entry.role)}, not ${entry.port}` }));
  return [...nativeProblems(base, block), ...compose];
}

/** One host port a compose file publishes as a literal number instead of `${STACK_PORT_<NAME>}`: the service and the published entry. */
export interface LiteralPublish { service: string; entry: string }

/** The `ports` entries of the compose `services` mapping whose host side is a literal port (`3080:3080`, `127.0.0.1:1025:1025`), so the base cannot move it. */
export function literalPublishes(services: Record<string, unknown>): LiteralPublish[] {
  const out: LiteralPublish[] = [];
  for (const [service, spec] of Object.entries(services)) {
    const ports = spec !== null && typeof spec === 'object' ? (spec as { ports?: unknown }).ports : undefined;
    if (!Array.isArray(ports)) continue;
    for (const item of ports) {
      const entry = typeof item === 'number' ? String(item) : typeof item === 'string' ? item : item !== null && typeof item === 'object' ? String((item as { published?: unknown }).published ?? '') : '';
      const host = typeof item === 'object' && item !== null ? entry : publishedHost(entry);
      if (host !== null && /^\d+(?:-\d+)?$/u.test(host)) out.push({ service, entry: typeof item === 'object' && item !== null ? `published: ${entry}` : entry });
    }
  }
  return out;
}

/** The host port part of a short-syntax compose publish (`[ip:]host:container[/proto]`); null for a container-only port, which publishes nothing fixed. */
function publishedHost(entry: string): string | null {
  const bare = entry.replace(/\/(?:tcp|udp)$/u, '');
  const parts = bare.startsWith('[') ? bare.replace(/^\[[^\]]*\]:/u, '').split(':') : bare.split(':');
  if (parts.length === 1) return null;
  return parts.length >= 3 ? (parts[parts.length - 2] ?? null) : (parts[0] ?? null);
}

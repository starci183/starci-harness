// stack-base-port.mts - the project base port of a dev environment (`environments.<env>.local.basePort`, PROJECT-STACKS-10) and the role table the
// native process ports of that environment follow, so two apps on one machine never collide. Pure functions over the normalised local block:
// the check rule R389 (rules/stacks-local.mts) and `starci app stack doctor` (stack/local-doctor.mts) both read them.
//
// The role table, base = `local.basePort`, native processes only (a process with a `port`; compose service ports are exempt):
//   frontend  the primary front end (the first process of the frontend role)  base
//   api       the api (the first process of the api role)                      base + 1
//   gateway   the AI gateway (the first process of the gateway role)           base + 2   (the ai-router convention: the api port + 1)
//   other     every further native process (mcp, landing, further next apps, workers with a port)
//             base + 3 .. base + 99 when a gateway process is declared, base + 2 .. base + 99 when none is
// A role no process plays leaves its slot empty; base and base + 1 stay reserved for the front end and the api either way.
// The role of a process is its name; a name outside the lists below is `other`.
import type { LocalBlock } from './stack-local-config.mjs';

/** The number of consecutive ports a project owns from its base: base .. base + 99. */
export const BASE_PORT_SPAN = 100;

/** The ports the owner reserves for the shared UI-lane `next dev` preview, which runs outside any app's stack: no app's base range may overlap it. */
export const RESERVED_PORTS = Object.freeze({ from: 3900, to: 3999 });

/** True when the range base..base+99 shares a port with the reserved preview range. */
export const overlapsReserved = (base: number): boolean => base <= RESERVED_PORTS.to && base + BASE_PORT_SPAN - 1 >= RESERVED_PORTS.from;

/** The roles of the table. */
export type PortRole = 'frontend' | 'api' | 'gateway' | 'other';

/** Process names by role; a name in none of the lists is `other`. */
export const ROLE_NAMES: Readonly<Record<Exclude<PortRole, 'other'>, readonly string[]>> = Object.freeze({
  frontend: ['web', 'app', 'console', 'fe', 'frontend'],
  api: ['api', 'core', 'be', 'backend'],
  gateway: ['gateway', 'ai-gateway', 'ai-router'],
});

/** The role a process name plays in the table. */
export function roleOf(name: string): PortRole {
  for (const role of ['frontend', 'api', 'gateway'] as const) if (ROLE_NAMES[role].includes(name)) return role;
  return 'other';
}

/** The ports a base owns, both ends included. */
export const rangeOf = (base: number): { from: number; to: number } => ({ from: base, to: base + BASE_PORT_SPAN - 1 });

/** True when the ranges of two bases share a port. */
export const rangesOverlap = (a: number, b: number): boolean => Math.abs(a - b) < BASE_PORT_SPAN;

/** One departure from the role table: `at` names the process, `message` says the port it must have. */
export interface BasePortProblem { at: string; message: string }

type Judged = Pick<LocalBlock, 'basePort' | 'ports' | 'processes'>;

/** The native processes of the block that hold a declared port, in declaration order. */
export function nativeProcesses(block: Pick<LocalBlock, 'ports' | 'processes'>): Array<{ name: string; port: number; role: PortRole }> {
  return block.processes.flatMap((process) => {
    const port = process.port === null ? undefined : block.ports[process.port];
    return port === undefined ? [] : [{ name: process.name, port, role: roleOf(process.name) }];
  });
}

/** The departures of the native process ports from the role table of the block's `basePort`; none when no base is declared. */
export function basePortProblems(block: Judged): BasePortProblem[] {
  const base = block.basePort;
  if (base === null) return [];
  const processes = nativeProcesses(block);
  const first = new Map<PortRole, string>();
  for (const process of processes) if (process.role !== 'other' && !first.has(process.role)) first.set(process.role, process.name);
  const low = first.has('gateway') ? base + 3 : base + 2;
  const problems: BasePortProblem[] = [];
  const exact: Record<Exclude<PortRole, 'other'>, { port: number; what: string }> = {
    frontend: { port: base, what: 'the primary front end: basePort' },
    api: { port: base + 1, what: 'the api: basePort + 1' },
    gateway: { port: base + 2, what: 'the AI gateway: basePort + 2' },
  };
  for (const process of processes) {
    const own = process.role !== 'other' && first.get(process.role) === process.name ? exact[process.role] : null;
    if (own) {
      if (process.port !== own.port) problems.push({ at: `processes.${process.name}`, message: `is ${own.what} = ${own.port}, not ${process.port}` });
    } else if (process.port < low || process.port > base + BASE_PORT_SPAN - 1) {
      problems.push({ at: `processes.${process.name}`, message: `is a further native process: its port must be from ${low} to ${base + BASE_PORT_SPAN - 1} (basePort ${first.has('gateway') ? '+ 3' : '+ 2'} to basePort + 99), not ${process.port}` });
    }
  }
  return problems;
}

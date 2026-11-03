// local-ports.mjs - free-port checks of a dev environment and the name of whatever holds a port that is not free.
import net from 'node:net';
import { firstLine, lines as splitLines } from './context.mjs';
import type { StackContext } from './context.mjs';

/** True when nothing listens on the loopback `port` (a bind attempt, so a wildcard listener counts too). */
export const bindFree = (port: number): Promise<boolean> => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});

/** True when something accepts a TCP connection on the loopback `port`. */
export const tcpOpen = (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});

/** What holds `port`: a docker container (by published port), else the process (netstat/tasklist on Windows, lsof elsewhere), else "an unknown process". */
export function holderOf(ctx: Pick<StackContext, 'spawn' | 'platform'>, port: number): string {
  const container = ctx.spawn('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']);
  const name = firstLine(container.stdout);
  if (container.status === 0 && name) return `container ${name}`;
  if (ctx.platform === 'win32') {
    const table = ctx.spawn('netstat', ['-ano', '-p', 'tcp']);
    const row = splitLines(table.stdout).map((line) => line.trim().split(/\s+/u)).find((cells) => cells[3] === 'LISTENING' && cells[1]?.endsWith(`:${port}`));
    const pid = row?.[4];
    if (pid) {
      const task = ctx.spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      const image = /^"([^"]+)"/u.exec(firstLine(task.stdout))?.[1];
      return image ? `process ${image} (pid ${pid})` : `process pid ${pid}`;
    }
    return 'an unknown process';
  }
  const listing = ctx.spawn('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const pid = /^p(\d+)/mu.exec(listing.stdout)?.[1];
  const command = /^c(.+)$/mu.exec(listing.stdout)?.[1];
  return pid ? `process ${command ?? 'unknown'} (pid ${pid})` : 'an unknown process';
}

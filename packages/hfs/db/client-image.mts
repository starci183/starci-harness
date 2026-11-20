// client-image.mts - the PostgreSQL client tools of the db verbs on a host that has none. psql and pg_dump are the ones inside the pinned
// postgres image (DB_BASE_IMAGE), run as a throwaway `docker run --rm` container with the connection passed in: the password travels only in the
// environment of that docker process (`-e PGPASSWORD`, never in an argument), a `-f` file is bind-mounted read-only, and a database on the host's
// own loopback is reached as host.docker.internal (Docker Desktop) or on the host network (a Linux engine). It reaches every database the host
// can reach, a staging or production one included, where `docker exec` into a container cannot. The host's own binary stays the first choice.
import fs from 'node:fs';
import path from 'node:path';
import { DB_BASE_IMAGE } from './image.mjs';

/** The host names a container cannot reach as itself: the host's own loopback. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The label every throwaway client container carries. */
export const CLIENT_LABEL = 'starci.db-client=1';

/**
 * The `docker` arguments that run `command args...` (psql or pg_dump) in the pinned image. Every argument equal to one of `urls` (a connection
 * URL without its password) is rewritten for the container's network; the file after each `-f` is mounted at /starci/<n>.sql, and the folder of a `--file` output is mounted writable. The password is
 * not here: the caller passes PGPASSWORD in the docker process's environment.
 */
export function clientImageArgs(command: string, args: readonly string[], urls: readonly string[], { platform = process.platform, image = DB_BASE_IMAGE }: { platform?: NodeJS.Platform; image?: string } = {}): string[] {
  const head = ['run', '--rm', '-i', '--label', CLIENT_LABEL, '-e', 'PGPASSWORD'];
  const mounts: string[] = [];
  let hostNetwork = false;
  const mapped = args.map((arg, index) => {
    if (urls.includes(arg)) {
      const url = new URL(arg);
      if (!LOOPBACK.has(url.hostname)) return arg;
      if (platform === 'linux') { hostNetwork = true; return arg; }
      url.hostname = 'host.docker.internal';
      return url.toString();
    }
    if (args[index - 1] === '-f' && path.isAbsolute(arg) && fs.existsSync(arg)) {
      const target = `/starci/${index}.sql`;
      mounts.push('--mount', `type=bind,source=${arg},target=${target},readonly`);
      return target;
    }
    if (args[index - 1] === '--file' && path.isAbsolute(arg)) {
      // The output file of pg_dump / pg_dumpall: its folder is mounted writable and the tool writes the file there.
      const folder = `/starci/out${index}`;
      mounts.push('--mount', `type=bind,source=${path.dirname(arg)},target=${folder}`);
      return `${folder}/${path.basename(arg)}`;
    }
    return arg;
  });
  return [...head, ...(hostNetwork ? ['--network', 'host'] : ['--add-host', 'host.docker.internal:host-gateway']), ...mounts, image, command, ...mapped];
}

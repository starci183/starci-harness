// Serves a built folder on loopback for the render proof; a built Storybook is static files, so this is no dev server.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webm': 'video/webm', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.mpd': 'application/dash+xml', '.m3u8': 'application/vnd.apple.mpegurl' };
const [folder = 'storybook-static', port = '6007'] = process.argv.slice(2);
const base = resolve(folder);

createServer((request, response) => {
  const file = resolve(join(base, decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)));
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1');

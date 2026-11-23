// edge-server.mts - the edge of a dev web (local-edge.mts): a small HTTP proxy that holds the web's public port, the one the dev tunnel routes,
// while the web process itself runs on a backend port behind it. It forwards to a backend only once that backend passed the page probe: the
// probe page answers 200 with HTML that links at least one stylesheet, every linked stylesheet answers 200, and, when the app uses Grammar,
// the stylesheets hold Grammar's `.starci-core-icon` rule. Until then, and whenever the backend stops answering, every request gets a small
// "updating" page that reloads itself, never a half-built app (a page with no Grammar CSS draws every icon unsized). A restart writes the
// new backend port into the backend file; the edge probes it and switches once it passed, so the old page answers until the new one is whole.
// It runs standalone (`node edge-server.mjs <config.json>`) from a copy in the environment's state folder, with node built-ins only, so an
// `npm ci` of the checkout never touches a file it holds.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';

/** The edge's configuration file, written by local-edge.mts. */
export interface EdgeConfig {
  /** The public port the edge listens on (the web's declared port). */
  listen: number;
  /** The file naming the backend port: `{"port": <n>}`. */
  backendFile: string;
  /** The file the edge writes its state into. */
  statusFile: string;
  /** The probe page path (the web's health path). */
  probePath: string;
  /** A rule the linked CSS must hold (Grammar's icon rule), or null. */
  marker: string | null;
  /** The name of the app on the updating page until a probed page gave its title. */
  title: string;
}

/** What the edge writes into its status file. */
export interface EdgeStatus {
  listening: boolean;
  backend: number | null;
  live: boolean;
  detail: string;
  title: string;
  at: string;
  error?: string;
}

/** The stylesheet hrefs of an HTML page, in order. Pure. */
export function stylesheetHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    if (!/\brel\s*=\s*["']?stylesheet\b/iu.test(tag)) continue;
    const href = /\bhref\s*=\s*"([^"]+)"|\bhref\s*=\s*'([^']+)'/iu.exec(tag);
    const value = href?.[1] ?? href?.[2];
    if (value) hrefs.push(value.replaceAll('&amp;', '&'));
  }
  return hrefs;
}

/** True when the CSS holds the marker rule itself (`.starci-core-icon`, not only `.starci-core-icon-button`). Pure. */
export function holdsMarker(css: string, marker: string): boolean {
  const escaped = marker.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${escaped}(?![\\w-])`, 'u').test(css);
}

/** The app name out of a page title (`NIVO OS · Hệ điều hành` gives `NIVO OS`). Pure. */
export function appName(html: string): string | null {
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1]?.trim();
  if (!title) return null;
  return title.split(/\s+[·|–—-]\s+/u)[0]?.trim() || null;
}

/** The updating page: says the app is updating and reloads itself every few seconds; never cached. Pure. */
export function holdingPage(title: string): string {
  const name = title.replaceAll(/[<>&"]/gu, '');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>${name} đang cập nhật</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.5 system-ui,sans-serif;background:#fff;color:#1f2328}@media (prefers-color-scheme:dark){body{background:#111;color:#e6e6e6}}</style></head><body><p>${name} đang cập nhật, tải lại sau vài giây</p></body></html>`;
}

/**
 * Probes one backend: the probe page answers 200 (following redirects inside the backend) with HTML linking at least one stylesheet, every
 * stylesheet answers 200, and the marker is in them when one is asked for. The verdict, a detail line and the page's app name.
 */
export async function probeBackend(port: number, probePath: string, marker: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; detail: string; title: string | null }> {
  const base = `http://127.0.0.1:${port}`;
  try {
    let url = new URL(probePath, base);
    let response = await fetcher(url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(180_000) });
    for (let hop = 0; hop < 3 && response.status >= 300 && response.status < 400; hop += 1) {
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, url);
      if (next.port !== String(port) && next.host !== url.host) break;
      url = new URL(next.pathname + next.search, base);
      response = await fetcher(url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(180_000) });
    }
    if (response.status !== 200) return { ok: false, detail: `${url.pathname} answered ${response.status}`, title: null };
    const html = await response.text();
    const title = appName(html);
    const hrefs = stylesheetHrefs(html);
    if (hrefs.length === 0) return { ok: false, detail: `${url.pathname} links no stylesheet`, title };
    const sheets: string[] = [];
    for (const href of hrefs) {
      const sheet = new URL(href, url);
      const css = await fetcher(new URL(sheet.pathname + sheet.search, base), { signal: AbortSignal.timeout(180_000) });
      if (css.status !== 200) return { ok: false, detail: `stylesheet ${sheet.pathname} answered ${css.status}`, title };
      sheets.push(await css.text());
    }
    if (marker !== null && !sheets.some((css) => holdsMarker(css, marker))) return { ok: false, detail: `no linked stylesheet holds ${marker}`, title };
    return { ok: true, detail: `${url.pathname} and its ${hrefs.length} stylesheet(s) answered 200${marker === null ? '' : `, ${marker} present`}`, title };
  } catch (error) {
    return { ok: false, detail: `backend ${port} does not answer (${(error as Error).message})`, title: null };
  }
}

const readBackend = (file: string): number | null => {
  try {
    const port = (JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: unknown }).port;
    return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : null;
  } catch { return null; }
};

/** Runs the edge until it is killed. */
export function runEdge(config: EdgeConfig): void {
  let backend: number | null = null;
  let live = false;
  let detail = 'no backend yet';
  let title = config.title;
  let listening = false;
  let probing = false;
  const write = (error?: string): void => {
    const status: EdgeStatus = { listening, backend, live, detail, title, at: new Date().toISOString(), ...(error === undefined ? {} : { error }) };
    const temporary = `${config.statusFile}.${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, `${JSON.stringify(status)}\n`); fs.renameSync(temporary, config.statusFile); } catch { /* the next tick writes again */ }
  };
  const tick = async (): Promise<void> => {
    const wanted = readBackend(config.backendFile);
    if (wanted !== backend) { backend = wanted; live = false; detail = wanted === null ? 'no backend yet' : `probing backend ${wanted}`; write(); }
    if (live || backend === null || probing) return;
    probing = true;
    const port = backend;
    try {
      const verdict = await probeBackend(port, config.probePath, config.marker);
      if (verdict.title !== null) title = verdict.title;
      if (port !== backend) return;
      live = verdict.ok;
      detail = verdict.detail;
      write();
    } finally { probing = false; }
  };
  const hold = (response: http.ServerResponse): void => {
    response.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5', refresh: '5' });
    response.end(holdingPage(title));
  };
  const lost = (): void => { if (live) { live = false; detail = `backend ${backend ?? '?'} stopped answering`; write(); } };
  const server = http.createServer((request, response) => {
    if (!live || backend === null) { hold(response); return; }
    const upstream = http.request({ host: '127.0.0.1', port: backend, method: request.method, path: request.url, headers: request.headers }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
      answer.pipe(response);
    });
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') lost();
      if (!response.headersSent) hold(response); else response.destroy();
    });
    request.pipe(upstream);
  });
  server.on('upgrade', (request, socket, head) => {
    if (!live || backend === null) { socket.destroy(); return; }
    const upstream = net.connect(backend, '127.0.0.1', () => {
      const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}`];
      for (let index = 0; index < request.rawHeaders.length; index += 2) lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => { socket.destroy(); });
    socket.on('error', () => { upstream.destroy(); });
  });
  server.on('error', (error: NodeJS.ErrnoException) => { listening = false; write(`${error.code ?? 'error'}: ${error.message}`); process.exit(1); });
  server.listen({ port: config.listen, host: '::', ipv6Only: false }, () => { listening = true; write(); });
  setInterval(() => { void tick(); }, 1000).unref();
  // A live backend is re-checked by connection only (cheap): a restart that ends it sends the edge back to the updating page at once.
  setInterval(() => {
    if (!live || backend === null) return;
    const probe = net.connect(backend, '127.0.0.1');
    probe.on('connect', () => { probe.destroy(); });
    probe.on('error', () => { lost(); });
  }, 2000).unref();
  void tick();
}

const [, script, configFile] = process.argv;
if (script !== undefined && configFile !== undefined && /edge-server\.mjs$/u.test(script)) {
  runEdge(JSON.parse(fs.readFileSync(configFile, 'utf8')) as EdgeConfig);
}

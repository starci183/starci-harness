// build.mjs - the assembler of the design canvas (skills/claude-design, contexts/project/gallery.md PROJECT-GALLERY-6). Run it from the app's
// .starcistacks/canvas/: it joins tokens.css, canvas.css and every pages/<NN>-<slug>.html in NN order into <app>-design.html, with an index of the
// screens. It refuses a fragment that holds a <script> or a section without id, data-pid and data-title (exit 1, naming the file).
// usage: node <harness>/skills/claude-design/kit/build.mjs <app> "<Title>"
import fs from 'node:fs';
import path from 'node:path';

const [app, title = 'Design'] = process.argv.slice(2);
if (!app) {
  console.error('usage: node build.mjs <app> "<Title>" (run in the app\'s .starcistacks/canvas/)');
  process.exit(2);
}
const files = fs.readdirSync('pages').filter((name) => name.endsWith('.html')).sort();
const problems = [];
const sections = [];
const fragments = files.map((name) => {
  const html = fs.readFileSync(path.join('pages', name), 'utf8');
  if (/<script\b/iu.test(html)) problems.push(`pages/${name} holds a <script>`);
  for (const [tag] of html.matchAll(/<section\b[^>]*class="page"[^>]*>/gu)) {
    const attr = (key) => new RegExp(`\\s${key}="([^"]+)"`, 'u').exec(tag)?.[1];
    const [id, pid, screen] = [attr('id'), attr('data-pid'), attr('data-title')];
    if (!id || !pid || !screen) problems.push(`pages/${name}: a section lacks id, data-pid or data-title: ${tag}`);
    else sections.push({ id, pid, screen });
  }
  return html;
});
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
const css = `${fs.readFileSync('tokens.css', 'utf8')}\n${fs.readFileSync('canvas.css', 'utf8')}`;
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${css}
:root{color-scheme:light}html,body{margin:0;background:#fff;font-family:Inter,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:light}}:root[data-theme="dark"]{color-scheme:light}
</style></head><body><nav class="index">${sections.map(({ id, screen }) => `<a href="#${id}">${screen}</a>`).join('')}</nav><main class="board">${fragments.join('\n')}</main></body></html>`;
const out = `${app}-design.html`;
fs.writeFileSync(out, html);
console.log(out, fs.statSync(out).size, 'bytes,', sections.length, 'screens from', files.length, 'pages');

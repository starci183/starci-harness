// A committed record names no path of the host that wrote it (check-cache.md "Layout and format"): the architecture machine's report and the boot
// proof's result keep every path under the app root as `<app>/...` with forward slashes, so one commit writes the same bytes in every checkout and
// on CI, and the record served in another checkout names that checkout's paths again.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { APP_ROOT_TOKEN, hostData, portableData } from '../cache/records.mjs';

const report = (root: string, sep: string) => ({
  repository: [root, 'be'].join(sep),
  compiler: { resolved: [root, 'node_modules', 'typescript', 'lib', 'typescript.js'].join(sep), version: '5.9.3' },
  loaded: [[root.split('\\').join('/'), 'be', 'src', 'main.ts'].join('/')],
  outside: '/usr/lib/node/node.exe',
  count: 3,
});

test('two checkouts of one commit, on two hosts, write the same portable data', () => {
  const windows = portableData(report('C:\\work\\one\\app', '\\'), 'C:\\work\\one\\app');
  const linux = portableData(report('/home/runner/work/two/app', '/'), '/home/runner/work/two/app');
  assert.deepEqual(windows, linux);
  assert.deepEqual(windows, { repository: `${APP_ROOT_TOKEN}/be`, compiler: { resolved: `${APP_ROOT_TOKEN}/node_modules/typescript/lib/typescript.js`, version: '5.9.3' }, loaded: [`${APP_ROOT_TOKEN}/be/src/main.ts`], outside: '/usr/lib/node/node.exe', count: 3 });
});

test('the portable data of a record is this checkout\'s paths again when it is served', () => {
  const root = path.resolve('/srv/checkout/app');
  const served = hostData(portableData(report(root, path.sep), root), root, path.sep) as { repository: string; compiler: { resolved: string } };
  assert.equal(served.repository, path.join(root, 'be'));
  assert.equal(served.compiler.resolved, path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js'));
});

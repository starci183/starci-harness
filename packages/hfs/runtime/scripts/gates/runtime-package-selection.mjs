// npm selects the root publish inventory from tracked names and verified generated names, without copying unrelated payload.
import fs from 'node:fs';
import path from 'node:path';
import { containedPath } from '../lib/path-key.mjs';
import { isLinkLike } from '../api/fs/is-link-like.mjs';
import { packDryRun } from '../api/npm/pack-dry-run.mjs';
import { runNpm } from '../api/npm/run-npm.mjs';

/** npm's selected relative names over a fresh placeholder tree; only package/ignore metadata is copied from source. */
export function packTrackedSelection(root, projection, { tracked, generated = [], env = process.env, run = runNpm } = {}) {
  fs.mkdirSync(projection);
  const sourceRoot = path.resolve(root);
  for (const relative of new Set([...tracked, ...generated])) {
    const target = containedPath(projection, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmignore', '.gitignore'].includes(path.basename(relative))) {
      containedPath(sourceRoot, relative);
      const source = path.resolve(sourceRoot, relative);
      for (let cursor = source; cursor !== sourceRoot; cursor = path.dirname(cursor)) if (isLinkLike(cursor)) throw new Error(`tracked selection metadata contains a link: ${relative}`);
      fs.copyFileSync(source, target);
    } else fs.writeFileSync(target, '');
  }
  const listed = packDryRun(projection, { spawn: (args, options) => run(args, { ...options, env }) });
  if (listed.error || listed.status !== 0) throw new Error('npm could not select the tracked-only root projection');
  const packed = JSON.parse(listed.stdout);
  return Array.isArray(packed) && packed.length === 1 && Array.isArray(packed[0].files) ? packed[0].files.map((file) => file.path) : null;
}

// Snapshots and rollback for the additive completion of a full app.
import fs from "node:fs";
import path from "node:path";

export function remember(snapshot, target) {
  if (snapshot.has(target)) return;
  snapshot.set(
    target,
    fs.existsSync(target) && fs.statSync(target).isFile()
      ? fs.readFileSync(target)
      : null,
  );
}

export function ensureParent(root, target, directories) {
  const missing = [];
  for (
    let at = path.dirname(target);
    at.startsWith(root) && at !== root && !fs.existsSync(at);
    at = path.dirname(at)
  )
    missing.push(at);
  for (const directory of missing.reverse()) {
    fs.mkdirSync(directory);
    directories.push(directory);
  }
}

export function writeFile(root, file, content, snapshot, directories) {
  const target = path.join(root, ...file.split("/"));
  remember(snapshot, target);
  ensureParent(root, target, directories);
  fs.writeFileSync(target, content);
}

export function restore(snapshot, directories) {
  for (const [target, content] of [...snapshot.entries()].reverse()) {
    if (content === null) {
      if (fs.existsSync(target) && fs.statSync(target).isFile())
        fs.unlinkSync(target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  for (const directory of [...directories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch {
      /* It is non-empty or already absent: preserve it. */
    }
  }
}

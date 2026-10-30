// Snapshots and rollback for the additive completion of a full app.
import fs from "node:fs";
import path from "node:path";

/** The files an upgrade touched, by absolute path: their prior bytes, or null when the file did not exist. */
export type Snapshot = Map<string, Buffer | null>;

export function remember(snapshot: Snapshot, target: string): void {
  if (snapshot.has(target)) return;
  snapshot.set(
    target,
    fs.existsSync(target) && fs.statSync(target).isFile()
      ? fs.readFileSync(target)
      : null,
  );
}

export function ensureParent(root: string, target: string, directories: string[]): void {
  const missing: string[] = [];
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

export function writeFile(root: string, file: string, content: string, snapshot: Snapshot, directories: string[]): void {
  const target = path.join(root, ...file.split("/"));
  remember(snapshot, target);
  ensureParent(root, target, directories);
  fs.writeFileSync(target, content);
}

export function restore(snapshot: Snapshot, directories: readonly string[]): void {
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

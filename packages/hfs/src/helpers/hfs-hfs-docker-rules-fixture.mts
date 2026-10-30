import fs from 'node:fs';
import path from 'node:path';
import { byCodeUnit } from '../../runtime/scripts/lib/list.mjs';
import { loadSlotManifest } from '../../runtime/scripts/hfs/slots.mjs';
import { cleanup, gitAdd, installTypeScript, writeCleanRepo } from './hfs-cli-fixture.mjs';

interface DockerRuleFixture { dir: string; snapshot: Map<string, Buffer> }

const fixtures = new Map<string, DockerRuleFixture>();

const walk = (root: string, relative = ''): string[] => {
  const files: string[] = [];
  const dir = path.join(root, ...relative.split('/').filter(Boolean));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!relative && (entry.name === '.git' || entry.name === 'node_modules')) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, child));
    else files.push(child);
  }
  return files.sort(byCodeUnit);
};

const snapshotOf = (dir: string): Map<string, Buffer> => new Map(dockerRuleFixtureFiles(dir).map((relative): [string, Buffer] => [relative, fs.readFileSync(path.join(dir, ...relative.split('/')))]));

const restore = ({ dir, snapshot }: DockerRuleFixture): string => {
  for (const relative of dockerRuleFixtureFiles(dir)) {
    if (!snapshot.has(relative)) fs.rmSync(path.join(dir, ...relative.split('/')), { force: true });
  }
  for (const [relative, expected] of snapshot) {
    const target = path.join(dir, ...relative.split('/'));
    let actual: Buffer | null = null;
    try { actual = fs.readFileSync(target); } catch {}
    if (actual?.equals(expected)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected);
  }
  return dir;
};

export const DOCKER_RULES_MANIFEST = loadSlotManifest();

export function dockerRuleFixtureFiles(dir: string): string[] {
  return walk(dir);
}

export function dockerRulesRepoOf(declaration: Parameters<typeof writeCleanRepo>[0], mutate?: (dir: string) => void): string {
  const key = JSON.stringify(declaration);
  let fixture = fixtures.get(key);
  if (!fixture) {
    const dir = gitAdd(installTypeScript(writeCleanRepo(declaration)));
    fixture = { dir, snapshot: snapshotOf(dir) };
    fixtures.set(key, fixture);
  }
  const dir = restore(fixture);
  if (mutate) mutate(dir);
  return dir;
}

export function cleanupDockerRuleFixtures(): void {
  cleanup([...fixtures.values()].map(({ dir }) => dir));
  fixtures.clear();
}

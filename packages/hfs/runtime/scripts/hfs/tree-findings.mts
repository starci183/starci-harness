import { readTree, treeFacts, untrackedEntries } from './tree.mjs';
import { liteStarciworkTreeFindings } from './path-findings.mjs';
import type { PathFinding } from './path-findings.mjs';
import type { Resolver } from './slots.mjs';

const CHECK_CACHE_DIR = '.starcistacks/cache';

/** The tree findings of R03: empty directories, ghost siblings, untracked entries outside an ignored slot. */
export function treeFindings({ repoRoot, resolver, tracked = [], reportedUntracked = new Set() }: { repoRoot: string; resolver: Resolver; tracked?: string[]; reportedUntracked?: Set<string> }): PathFinding[] {
  const inIgnoredSlot = (rel: string): boolean => resolver.classifyPath(`${rel}/.probe`).tracking === 'ignored';
  const findings = liteStarciworkTreeFindings(repoRoot, resolver, tracked);
  const facts = treeFacts(readTree(repoRoot, { isIgnored: inIgnoredSlot }));
  for (const { path: dir, below } of facts.empty) {
    findings.push({ code: 'HFS_EMPTY_DIR', level: 'error', path: dir, below, message: `${dir} has no file below it` + (below ? ` (nor in its ${below} sub-director${below === 1 && 'y' || 'ies'})` : '') + '; git tracks no empty directory, so it is a leftover' });
  }
  for (const { path: dir, of, distance } of facts.ghosts) {
    findings.push({ code: 'HFS_GHOST_TREE', level: 'error', path: dir, of, distance, message: `${dir} is empty and ${distance} edit${distance === 1 ? '' : 's'} from its sibling ${of}: a renamed or misspelt structure that was never removed` });
  }
  for (const entry of untrackedEntries(repoRoot)) {
    const bare = entry.replace(/\/$/, '');
    if (reportedUntracked.has(bare)) continue;
    const ignored = entry.endsWith('/') ? inIgnoredSlot(bare) : resolver.classifyPath(bare).tracking === 'ignored';
    if (!ignored) findings.push({ code: 'HFS_UNTRACKED_ROOT_ENTRY', level: 'error', path: bare, message: `${entry} is neither tracked nor git-ignored, and no ignored slot owns it` });
  }
  // The committed check cache is written by the CLI and committed with the change: before that commit its files are untracked, and a run's own output is no finding.
  return findings.filter((finding) => !(finding.path === CHECK_CACHE_DIR || String(finding.path).startsWith(`${CHECK_CACHE_DIR}/`)));
}

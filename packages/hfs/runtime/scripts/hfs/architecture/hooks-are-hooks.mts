import path from 'node:path';
import { machineKit } from './machine-ast.mjs';
import type { Identifier, Statement } from 'typescript';
import type { MachineInput, MachineKit } from './machine-ast.mjs';
import { treeOf } from './required-files.mjs';
import type { RepositoryTree, SlotResolver } from './required-files.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { Violation } from './ast-walks.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

/** One shared file of a hooks domain: its repository-relative path and base name. */
interface SharedFile {
  rel: string;
  base: string;
}

/** One declaration of a helper function in a hooks domain. */
interface HelperDeclaration {
  file: GraphFile;
  node: Identifier;
}

/** domain root -> helper name -> its declarations. */
type DeclaredHelpers = Map<string, Map<string, HelperDeclaration[]>>;

export interface HooksAreHooksResult {
  violations: Violation[];
  coverage: { status: 'checked'; domains: number };
}

/**
 * R56 `hooks-are-hooks` (FE_HOOKS_ARE_HOOKS), the repository half of the eslint rule `hooks-folder-holds-hooks-only`, which
 * judges one file at a time and leaves to the machine what needs the whole tree. Per domain folder of hooks
 * (slot fe.hooks, apps/<app>/src/hooks/<domain>):
 *
 *   - at most one shared file, named `<domain>.shared.ts`: a second `*.shared.ts`, or one named for another domain, is a
 *     second dumping ground for non-hook helpers;
 *   - no helper declared twice: a top-level function or arrow-function constant that is not a hook and whose name is declared
 *     in two files of the domain is a helper copied instead of shared; it lives once in `<domain>.shared.ts`.
 */
export const HOOKS_ARE_HOOKS_RULE_IDS = ['FE_HOOKS_ARE_HOOKS'];

const RULE = 'FE_HOOKS_ARE_HOOKS';
const HOOKS_SLOT = 'fe.hooks';
const HOOK_NAME = /^use[A-Z0-9]/u;
const SHARED = /\.shared\.[cm]?tsx?$/u;

const sharedFilesOf = (tree: RepositoryTree, resolver: Pick<SlotResolver, 'classifyPath'>, domains: Set<string>): Map<string, SharedFile[]> => {
  const shared = new Map<string, SharedFile[]>(); // domain root -> [file]
  for (const rel of [...tree.files].sort(byCodeUnit)) {
    const classified = resolver.classifyPath(rel);
    if (classified.slot !== HOOKS_SLOT || !classified.root) continue;
    domains.add(classified.root);
    const base = path.posix.basename(rel);
    if (/\.spec\.[cm]?tsx?$/u.test(base) || !SHARED.test(base)) continue;
    let list = shared.get(classified.root);
    if (!list) {
      list = [];
      shared.set(classified.root, list);
    }
    list.push({ rel, base });
  }
  return shared;
};

const reportSharedFileViolations = (shared: Map<string, SharedFile[]>, violations: Violation[]): void => {
  for (const [root, list] of shared) {
    const domain = path.posix.basename(root);
    const at = (item: SharedFile, message: string) => violations.push({ ruleId: RULE, path: item.rel, line: 1, column: 1, domain, message });
    for (const item of list) {
      if (item.base.replace(/\.[cm]?tsx?$/u, '') !== `${domain}.shared` || path.posix.dirname(item.rel) !== root) {
        at(item, `${item.rel} is a shared file that is not ${root}/${domain}.shared.ts; a hooks domain has one shared file for its non-hook helpers, named after the domain. Move the helpers into it.`);
      }
    }
    for (const item of list.filter(entry => entry.base.replace(/\.[cm]?tsx?$/u, '') === `${domain}.shared` && path.posix.dirname(entry.rel) === root).slice(1)) {
      at(item, `${item.rel} is a second shared file of hooks domain ${domain}; a domain has exactly one, ${domain}.shared.ts. Merge the helpers into it.`);
    }
  }
};

const helperDeclarationsOf = (statement: Statement, ts: TypeScriptApi): [string, Identifier][] => {
  const found: [string, Identifier][] = [];
  if (ts.isFunctionDeclaration(statement) && statement.name) found.push([statement.name.text, statement.name]);
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) found.push([declaration.name.text, declaration.name]);
    }
  }
  return found;
};

const recordDeclaredHelper = (declared: DeclaredHelpers, root: string, name: string, file: GraphFile, node: Identifier): void => {
  if (HOOK_NAME.test(name)) return;
  let byName = declared.get(root);
  if (!byName) {
    byName = new Map();
    declared.set(root, byName);
  }
  let list = byName.get(name);
  if (!list) {
    list = [];
    byName.set(name, list);
  }
  list.push({ file, node });
};

const declaredHelpersOf = (graph: HfsGraph, resolver: Pick<SlotResolver, 'classifyPath'>, ts: TypeScriptApi): DeclaredHelpers => {
  const declared: DeclaredHelpers = new Map(); // domain root -> name -> [{file, node}]
  for (const file of graph.files.values()) {
    if (file.slot !== HOOKS_SLOT) continue;
    const root = resolver.classifyPath(file.rel).root;
    for (const statement of file.sourceFile.statements) {
      for (const [name, node] of helperDeclarationsOf(statement, ts)) recordDeclaredHelper(declared, root, name, file, node);
    }
  }
  return declared;
};

const reportDuplicateHelpers = (declared: DeclaredHelpers, violations: Violation[], kit: MachineKit): void => {
  for (const [root, byName] of declared) {
    const domain = path.posix.basename(root);
    for (const [name, list] of byName) {
      if (list.length < 2) continue;
      for (const item of list.slice(1)) {
        const others = list.map(entry => entry.file.rel).filter(rel => rel !== item.file.rel).sort(byCodeUnit);
        violations.push({ ruleId: RULE, path: item.file.rel, ...kit.at(item.file.rel, item.file.sourceFile, item.node), domain, helper: name,
          message: `${name} is declared again in hooks domain ${domain} (also in ${others.join(', ')}); a helper the hooks share is written once, in ${domain}.shared.ts.` });
      }
    }
  }
};

export function checkHooksAreHooks(input: MachineInput & { config: ArchitectureConfig }): HooksAreHooksResult {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts, resolver } = kit;
  const violations: Violation[] = [];
  const domains = new Set<string>();
  const shared = sharedFilesOf(treeOf(config.root), resolver, domains);
  reportSharedFileViolations(shared, violations);
  reportDuplicateHelpers(declaredHelpersOf(graph, resolver, ts), violations, kit);
  return { violations, coverage: { status: 'checked', domains: domains.size } };
}

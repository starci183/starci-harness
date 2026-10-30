import path from 'node:path';
import type { SourceFile } from 'typescript';
import { canonical, isInside } from './config.mjs';
import type { ArchitectureConfig, OwnerRecord } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import { relativePath, workspaceExportSources } from './typescript.mjs';
import type { ImportEdge } from './typescript.mjs';
import type { TypeContext } from './type-context.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
import { globExpression } from '../../lib/glob.mjs';
import { posixPath } from '../../lib/path-key.mjs';
import { registryImporter, registrySlot } from './entity-registry.mjs';

/** An owner with its absolute root and entry, and the files that count as its public entries. */
interface OwnerDeclaration extends OwnerRecord {
  entries: Set<string>;
  isEntry: (file: string) => boolean;
  declared: string[];
}

/** One step of the walk through re-exports: a file and the chain of files that led to it. */
interface ReexportStep {
  file: string;
  chain: string[];
}

/** A cross-owner import that does not enter the owner through a public entry: the owner entered and the chain of files followed. */
interface OwnerBypass {
  owner: OwnerDeclaration;
  chain: string[];
}

function absolute(root: string, relative: string): string {
  return canonical(path.resolve(root, ...relative.split('/')));
}

/**
 * The extra public entries the slot manifest declares for the owner (slot field `entries`, on the slot that holds its entry file):
 * exact files as absolute paths, and the entries holding a `*` (one file per operation, `graphql/queries/query-*.ts`) as patterns.
 */
function slotEntries(config: ArchitectureConfig, owner: OwnerRecord): { exact: string[]; patterns: RegExp[] } {
  const found = config.hfs?.classifyPath?.(owner.entry);
  const names: string[] = found?.slot ? config.hfs.slot(found.slot)?.entries ?? [] : [];
  const exact = names.filter(name => !name.includes('*')).map(name => absolute(config.root, `${found.root}/${name}`));
  const patterns: RegExp[] = names.filter(name => name.includes('*')).map(name => globExpression(`${posixPath(absolute(config.root, found.root))}/${name}`));
  return { exact, patterns };
}

/** The owner's public entries: its declared entry, the `entries` its slot declares, plus every source file its package.json `exports` maps when the owner is a workspace package. */
function ownerDeclarations(config: ArchitectureConfig, context: TypeContext): OwnerDeclaration[] {
  return config.owners.map((owner): OwnerDeclaration => {
    const root = absolute(config.root, owner.root);
    const entry = absolute(config.root, owner.entry);
    const workspace = context.workspaces?.find(item => item.root === root);
    const { exact: declared, patterns } = slotEntries(config, owner);
    const entries = new Set([entry, ...declared, ...(workspace ? workspaceExportSources(context.ts, workspace) : [])]);
    const isEntry = (file: string): boolean => entries.has(file) || patterns.some(pattern => pattern.test(posixPath(file)));
    return { ...owner, root, entry, entries, isEntry, declared };
  }).sort((a, b) => b.root.length - a.root.length);
}

function ownerOf(owners: OwnerDeclaration[], file: string): OwnerDeclaration | null {
  return owners.find(owner => isInside(owner.root, file)) ?? null;
}

function reexportSteps(context: TypeContext, current: ReexportStep): ReexportStep[] {
  return (context.edges.get(current.file) ?? []).filter(candidate => candidate.reexport).map(candidate => ({ file: candidate.to, chain: [...current.chain, candidate.to] }));
}

function privateOwnerChain(context: TypeContext, owners: OwnerDeclaration[], edge: ImportEdge): OwnerBypass | null {
  const sourceOwner = ownerOf(owners, edge.from);
  const queue: ReexportStep[] = [{ file: edge.to, chain: [edge.from, edge.to] }];
  const visited = new Set<string>();
  for (let current = queue.shift(); current; current = queue.shift()) {
    if (visited.has(current.file)) continue;
    visited.add(current.file);
    const owner = ownerOf(owners, current.file);
    if (owner && sourceOwner?.id !== owner.id) return owner.isEntry(current.file) ? null : { owner, chain: current.chain };
    queue.push(...reexportSteps(context, current));
  }
  return null;
}

/**
 * A `*.builder.ts` of slot be.tests.fixtures.builders arranges data at the schema level: it may deep-import the persistence
 * entity classes and connection entity lists (slot be.persistence) of any capability. No other file may.
 */
function arrangesSchema(config: ArchitectureConfig, from: string, to: string): boolean {
  const resolver = config.hfs;
  if (!resolver?.classifyPath) return false;
  return resolver.classifyPath(relativePath(config.root, from)).slot === 'be.tests.fixtures.builders'
    && resolver.classifyPath(relativePath(config.root, to)).slot === 'be.persistence';
}

/**
 * The entity registry (slot role entity-registry, entity-registry.mjs) is imported by deep path, and only from the files its slot's
 * `importedBy` names: app composition and the test world. Any other importer goes through the owner's entry, which never exports it.
 */
function importsRegistry(config: ArchitectureConfig, from: string, to: string): boolean {
  const slot = registrySlot(config.hfs, relativePath(config.root, to));
  return slot !== null && registryImporter(config.hfs, slot, relativePath(config.root, from));
}

function publicEntryViolations(config: ArchitectureConfig, context: TypeContext, owners: OwnerDeclaration[], sourceFiles: Map<string, SourceFile>): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const owner of owners) {
    const sourceFile = sourceFiles.get(owner.entry);
    if (!sourceFile) {
      violations.push({ ruleId: 'ARCH_OWNER_EXPORT_BYPASS', path: relativePath(config.root, owner.entry), line: 1, column: 1, owner: owner.id,
        message: `Owner ${owner.id} public entry is outside the configured TypeScript programs, so its boundary cannot be checked.` });
      continue;
    }
    const publicFiles = new Set<SourceFile>([
      sourceFile,
      ...owner.declared.map(file => sourceFiles.get(file)).filter((file): file is SourceFile => Boolean(file)),
    ]);
    for (const entryFile of publicFiles) {
      for (const statement of entryFile.statements) if (context.ts.isExportDeclaration(statement) && !statement.exportClause) {
        violations.push({
          ruleId: 'ARCH_OWNER_EXPORT_STAR',
          path: relativePath(config.root, canonical(entryFile.fileName)),
          ...sourceLocation(entryFile, statement),
          owner: owner.id,
          message: `Owner ${owner.id} public entry must use explicit named exports rather than export *.`,
        });
      }
    }
  }
  return violations;
}

function ownerImportViolations(config: ArchitectureConfig, context: TypeContext, owners: OwnerDeclaration[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const sourceFile of context.files) {
    const from = canonical(sourceFile.fileName);
    for (const edge of context.edges.get(from) ?? []) {
      const bypass = privateOwnerChain(context, owners, edge);
      if (!bypass) continue;
      const target = bypass.chain.at(-1) ?? edge.to;
      if (arrangesSchema(config, from, target)) continue;
      if (bypass.chain.length === 2 && importsRegistry(config, from, target)) continue;
      violations.push({
        ruleId: 'ARCH_OWNER_EXPORT_BYPASS',
        path: relativePath(config.root, from),
        line: edge.line,
        column: edge.column,
        owner: bypass.owner.id,
        specifier: edge.specifier,
        resolvedPath: relativePath(config.root, target),
        dependencyChain: bypass.chain.map(file => relativePath(config.root, file)),
        message: `Cross-owner dependency must enter ${bypass.owner.id} through ${relativePath(config.root, bypass.owner.entry)}.`,
      });
    }
  }
  return violations;
}

/** Enforce explicit same-source owner entries without constraining imports inside one owner. */
export function checkOwners(config: ArchitectureConfig, context: TypeContext): ArchitectureViolation[] {
  if (!config.owners?.length) return [];
  const owners = ownerDeclarations(config, context);
  const sourceFiles = new Map(context.files.map((file): [string, SourceFile] => [canonical(file.fileName), file]));
  return [
    ...publicEntryViolations(config, context, owners, sourceFiles),
    ...ownerImportViolations(config, context, owners),
  ];
}

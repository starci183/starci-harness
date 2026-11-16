// mcp-tools.mts - HFS_MCP_TOOLS_SNAPSHOT (R302): the committed MCP tool-catalog snapshot of an app has the canonical shape.
// An app that serves an MCP server commits the catalog its clients rely on at `contracts/<app>/<contract>.tools.json` (slot
// be.contract.mcp-tools): `{ contract: "<server>@<major>", server: { name, version }, tools: [{ name, description, inputSchema, ... }] }`,
// the `tools/list` result of the server at that contract major. The canon emits no MCP catalog, so the check is the shape: the
// file names a declared be app and its own contract, the contract is the server name at an integer major, every tool has a unique
// name, a description and an object input schema. A file that is not JSON is a finding too.
// HFS_MCP_TOOLS_SNAPSHOT_MISSING (R302) is the presence half: a back end whose source (src/**, apps/**, specs aside) imports the MCP server
// entry of the SDK (`@modelcontextprotocol/sdk/server`, any subpath) serves an MCP server, so it commits at least one catalog under
// contracts/<app>/; without one, the shape check above has nothing to judge and the agent runtime's tools are unreviewed. Reported in
// `--env local`, blocking in `--env prod` (the code is localOnly).
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { found, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const MCP_TOOLS_SNAPSHOT = 'HFS_MCP_TOOLS_SNAPSHOT';
const MCP_TOOLS_SNAPSHOT_MISSING = 'HFS_MCP_TOOLS_SNAPSHOT_MISSING';
/** A back-end source file, specs and declaration files aside. */
const SOURCE = /^(?:src|apps)\/.+(?<!\.d)\.[cm]?ts$/u;
const SPEC = /[.-](?:spec|integration-spec|e2e-spec|contract-spec)\.[cm]?ts$/u;
/** An import, re-export, dynamic import or require of the SDK's server entry. */
const MCP_SERVER_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]@modelcontextprotocol\/sdk\/server(?:\/[^'"]*)?['"]/mu;
const SNAPSHOT = /^contracts\/([^/]+)\/([^/]+)\.tools\.json$/u;
const CONTRACT = /^([a-z][a-z0-9-]*)@([1-9]\d*)$/u;

const text = (value: Parsed) => typeof value === 'string' && value.trim() !== '';

/** The shape problems of one tool entry at index `index`, given the names already seen. */
function toolProblems(tool: Parsed, index: number, seen: Parsed) {
  if (!plain(tool)) return [`tools[${index}] is not an object`];
  const at = text(tool.name) ? `tool ${tool.name}` : `tools[${index}]`;
  const problems = [];
  if (!text(tool.name)) problems.push(`${at} has no name`);
  else if (seen.has(tool.name)) problems.push(`${at} is listed twice`);
  else seen.add(tool.name);
  if (!text(tool.description)) problems.push(`${at} has no description`);
  if (!plain(tool.inputSchema) || tool.inputSchema.type !== 'object') problems.push(`${at} has no inputSchema of type object`);
  return problems;
}

/** The shape problems of a parsed snapshot whose file stem is `stem`. */
function snapshotProblems(doc: Parsed, stem: string) {
  if (!plain(doc)) return ['is not a JSON object'];
  const problems = [];
  const contract = CONTRACT.exec(String(doc.contract ?? ''));
  if (!contract) problems.push('contract is not `<server>@<major>` (a kebab-case server name and an integer major from 1)');
  else if (doc.contract !== stem) problems.push(`contract ${doc.contract} differs from the file name ${stem}.tools.json`);
  if (!plain(doc.server) || !text(doc.server.name) || !text(doc.server.version)) problems.push('server has no name and version');
  else if (contract && doc.server.name !== contract[1]) problems.push(`server.name ${doc.server.name} differs from the contract server ${contract[1]}`);
  if (!Array.isArray(doc.tools) || doc.tools.length === 0) return [...problems, 'tools is not a non-empty list'];
  const seen = new Set();
  return [...problems, ...doc.tools.flatMap((tool: Parsed, index: number) => toolProblems(tool, index, seen))];
}

/** The findings of R302 for the be side at `repoRoot` (be-relative `files`, the side view `repo`). */
export function mcpToolsSnapshotFindings({ repoRoot, files, repo }: { repoRoot: string; files: string[]; repo: Repo }) {
  if (repo.profile !== 'be') return [];
  const apps = new Set((repo.apps ?? []).map((app: Parsed) => app.name));
  const findings = [];
  for (const file of files) {
    const match = SNAPSHOT.exec(file);
    if (!match) continue;
    const [, app, stem] = match;
    const fix = 'commit the server\'s `tools/list` result as `{ contract: "<server>@<major>", server: { name, version }, tools: [...] }`';
    if (!apps.has(app)) {
      findings.push(found(MCP_TOOLS_SNAPSHOT, file, `${file} belongs to no be app: ${app} is not declared in hfs.json sides.be.apps; a tool catalog lives under contracts/<app>/ of the app that serves it`, { app }));
      continue;
    }
    let doc;
    try { doc = JSON.parse(readText(repoRoot, file) ?? ''); } catch { doc = undefined; }
    const problems = doc === undefined ? ['is not readable JSON'] : snapshotProblems(doc, stem!);
    if (problems.length) findings.push(found(MCP_TOOLS_SNAPSHOT, file, `${file} is not a canonical MCP tool catalog: ${problems.join('; ')}; ${fix}`, { app, problems }));
  }
  findings.push(...missingCatalogFindings(repoRoot, files));
  return findings;
}

/** HFS_MCP_TOOLS_SNAPSHOT_MISSING: the back end serves an MCP server (its source imports the SDK's server entry) and commits no catalog. */
function missingCatalogFindings(repoRoot: string, files: readonly string[]) {
  if (files.some((file) => SNAPSHOT.test(file))) return [];
  const servers = files.filter((file) => SOURCE.test(file) && !SPEC.test(file) && MCP_SERVER_IMPORT.test(readText(repoRoot, file) ?? ''));
  if (servers.length === 0) return [];
  const [first] = servers;
  return [found(MCP_TOOLS_SNAPSHOT_MISSING, first!, `${first} serves an MCP server (it imports @modelcontextprotocol/sdk/server${servers.length > 1 ? `, as ${servers.length - 1} more file${servers.length === 2 ? ' does' : 's do'}` : ''}), but the back end commits no tool catalog: commit the server's \`tools/list\` result at contracts/<app>/<server>@<major>.tools.json of the app that serves it (R302, BE-AI-6)`, { local: true, servers })];
}

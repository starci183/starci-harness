// nivoos-package-check.mts - the nivoos package check of `starci app check` (R436, contexts/project/business-repo.md PROJECT-BUSINESS-1): for each package
// hfs.json `sides.nivoos.packages` declares, `nivoos package check <entry> --out <out>` run from the package folder with this Node, through the heavy governor
// (a `build` child of the step's parity port). The nivoos CLI type-checks the entry under the package's own tsconfig, loads it, builds the seed document in memory and
// fails when the committed seed document or secrets template differs from that fresh build. It runs inside the `checks` step, beside the project checks
// (cache/project-checks.mts), wherever the hfs gate runs. A package reads what it reads (its sources, the SDK), so its verdict is never cached.
// The CLI is the package's own dev dependency (`@starci/nivoos-cli`, or the package `nivoos`): resolved from packages/<name>/node_modules, then the app root's, by the `bin` its manifest names. When it is not
// installed the finding says how to add it, and nothing is run.
import fs from 'node:fs';
import path from 'node:path';
import { nivoosPackagesOf, type NivoosPackage } from '../runtime/scripts/hfs/nivoos-side.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { ParityRun } from './parity-family.mjs';

/** The finding of a nivoos package whose check failed or could not run. */
export const NIVOOS_PACKAGE_CHECK = 'HFS_NIVOOS_PACKAGE_CHECK';
/** The most lines of a red check's output its finding carries. */
const TAIL_LINES = 20;

/** The nivoos packages hfs.json declares at `repoRoot`, defaults applied; none when it declares none or cannot be read (the declaration shape is judged by the hfs structure pass). */
export function declaredNivoosPackages(repoRoot: string): NivoosPackage[] {
  try { return nivoosPackagesOf((JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')) as { sides?: unknown }).sides); } catch { return []; }
}

/** The packages that provide the `nivoos` bin: the published CLI first, then a package named for the bin. */
export const NIVOOS_CLI_PACKAGES: readonly string[] = ['@starci/nivoos-cli', 'nivoos'];

/** The script the `nivoos` bin of one CLI package installed under `modules` (a node_modules folder) names, or null when it is not installed there. */
function binOfPackage(modules: string, name: string): string | null {
  try {
    const folder = path.join(modules, ...name.split('/'));
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['nivoos'];
    if (bin === undefined) return null;
    const file = path.join(folder, bin);
    return fs.existsSync(file) ? file : null;
  } catch { return null; }
}

/** The script the `nivoos` bin of an install at `modules` names, from whichever CLI package provides it; null when the CLI is not installed there. */
function binOf(modules: string): string | null {
  for (const name of NIVOOS_CLI_PACKAGES) {
    const file = binOfPackage(modules, name);
    if (file !== null) return file;
  }
  return null;
}

/** The nivoos CLI script for a package: its own node_modules first, then the app root's; null when neither holds it. */
export function nivoosCli(repoRoot: string, name: string): string | null {
  return binOf(path.join(repoRoot, 'packages', name, 'node_modules')) ?? binOf(path.join(repoRoot, 'node_modules'));
}

/** The Node warnings a `.ts` entry in a package without `"type": "module"` makes the CLI print: noise around the verdict, never part of it. */
const NODE_NOISE = /^(?:\(node:\d+\) |Reparsing as ES module|To eliminate this warning|\(Use `node --trace-warnings)/u;

/** The last TAIL_LINES non-empty lines of a check's output, less the Node warnings, joined. */
const tailOf = (text: string): string => text.split(/\r?\n/u).map((line) => line.trimEnd()).filter((line) => line.trim() !== '' && !NODE_NOISE.test(line)).slice(-TAIL_LINES).join('\n');

/** Runs the check of every declared nivoos package: its findings (one per red package) and one line per package, `nivoos package check <name>: green|red (exit n)`. */
export async function runNivoosPackageChecks({ repoRoot, run, env }: { repoRoot: string; run: ParityRun; env: NodeJS.ProcessEnv }): Promise<{ findings: CheckFinding[]; lines: string[] }> {
  const findings: CheckFinding[] = [];
  const lines: string[] = [];
  for (const entry of declaredNivoosPackages(repoRoot)) {
    const folder = `packages/${entry.name}`;
    const cli = nivoosCli(repoRoot, entry.name);
    if (cli === null) {
      findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${folder}/package.json`, message: `the nivoos CLI is not installed for ${folder}: add "@starci/nivoos-cli" to the devDependencies of ${folder}/package.json (with the nivoos SDK it authors with) and run npm install, then \`nivoos package check ${entry.entry} --out ${entry.out}\` runs here (PROJECT-BUSINESS-1)` });
      lines.push(`  nivoos package check ${entry.name}: red, the nivoos CLI is not installed`);
      continue;
    }
    const result = await run({ kind: 'build', label: `app check nivoos package check ${entry.name}`, cwd: path.join(repoRoot, folder), argv: [process.execPath, cli, 'package', 'check', entry.entry, '--out', entry.out], env });
    const output = tailOf(`${result.stdout}\n${result.stderr}`);
    const exit = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
    if (result.status === 0 && result.error === undefined) {
      lines.push(`  nivoos package check ${entry.name}: green (exit 0)${output === '' ? '' : `: ${output.split('\n').at(-1) ?? ''}`}`);
      continue;
    }
    findings.push({ code: NIVOOS_PACKAGE_CHECK, level: 'error', path: `${folder}/${entry.entry}`, message: `nivoos package check ${entry.name} failed (${exit}): the package does not type-check or build, or its committed ${entry.out}/ differs from a fresh build (\`npm run build\` in ${folder}, then commit the seed)${output === '' ? '' : `\n${output}`}` });
    lines.push(`  nivoos package check ${entry.name}: red (${exit})`);
  }
  return { findings, lines };
}

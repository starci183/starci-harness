// eslint-list.cts - ESLint over a list of files in ONE process, through the app's own install (the Node API of the ESLint the side's folder resolves).
//
// The CLI of ESLint takes its files as arguments, and a diff of hundreds of long paths outgrows the Windows command line (32,767 characters), which
// used to cut the list into chunks that each built the whole TypeScript program again. This runner reads the list from a JSON file named by its one
// argument ({ files, fix }), lints it once from its working directory (the side folder) and prints the results as the `--format json` of the CLI
// does (the list of result objects), so the launcher validates them the same way. Its exit code is the CLI's: 0 clean of errors, 1 at least one
// error, 2 the run could not complete (the message is on stderr). It stays CommonJS like bound-sys.cts, which may be preloaded in front of it.
//
// The project graph the canon's graph rules read is built in this process, once per side. When the job names the canons (`graph.canons`, the entry file
// of each installed canon) and a file (`graph.out`), the runner asks each canon for the snapshot of the graph it built (`projectGraphSnapshot`) after
// the lint and writes `{ snapshots }` there, so the cache keeps the graph findings without building the graph a second time in the CLI. A canon that
// cannot answer leaves its snapshot out; the report and the exit code are never affected.
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const { createRequire } = require('node:module') as typeof import('node:module');
const { pathToFileURL } = require('node:url') as typeof import('node:url');

interface GraphHandoff { out: string; canons: { name: string; entry: string }[] }
interface Job { files: string[]; fix: boolean; graph?: GraphHandoff }
interface Result { errorCount: number; fatalErrorCount: number }
interface Eslint { lintFiles(files: string[]): Promise<Result[]> }
interface EslintApi { ESLint: { new (options: { cwd: string; fix: boolean }): Eslint; outputFixes(results: Result[]): Promise<void> } }

/** Writes the snapshot of the graph each named canon built in this process; a canon that cannot answer is left out. */
async function handOutGraph(handoff: GraphHandoff, repoRoot: string): Promise<void> {
  const snapshots: Record<string, unknown> = {};
  for (const { name, entry } of handoff.canons) {
    try {
      const canon = await import(pathToFileURL(entry).href) as { projectGraphSnapshot?: (input: { repoRoot: string }) => unknown };
      if (typeof canon.projectGraphSnapshot === 'function') snapshots[name] = canon.projectGraphSnapshot({ repoRoot });
    } catch { /* the cache builds this canon's graph itself */ }
  }
  fs.writeFileSync(handoff.out, JSON.stringify({ snapshots }));
}

async function main(): Promise<number> {
  const job = JSON.parse(fs.readFileSync(String(process.argv[2]), 'utf8')) as Job;
  const cwd = process.cwd();
  const { ESLint } = createRequire(path.join(cwd, 'package.json'))('eslint') as EslintApi;
  const results = await new ESLint({ cwd, fix: job.fix }).lintFiles(job.files);
  if (job.fix) await ESLint.outputFixes(results);
  if (job.graph !== undefined) await handOutGraph(job.graph, cwd);
  process.stdout.write(JSON.stringify(results));
  return results.some((result) => result.errorCount > 0 || result.fatalErrorCount > 0) ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${String((error as Error | undefined)?.stack ?? error)}\n`);
    process.exitCode = 2;
  },
);

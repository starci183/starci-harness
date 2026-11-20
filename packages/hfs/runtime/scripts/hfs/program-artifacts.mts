// program-artifacts.mts - the files a TypeScript program of an app must not read: build artifacts, what a framework's build or dev server writes into
// the work tree and git ignores (a generated environment declaration, a build folder's route types, a package's dist, a .tsbuildinfo). A program
// whose include globs reach them reads them in one checkout and not in another (a clean checkout, CI, the lander have none), so its result and its
// key would depend on build history rather than on the commit (contexts/project/check-cache.md "Untracked program inputs"). The rule is git's own:
// a root file git ignores is an artifact, unless it is generated code the app's declared code generation writes (a folder named `__generated__`,
// cache/codegen.mts), which is the one untracked input a program may read: `npm run codegen` writes it in every checkout alike.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** The folder name generated code lands in (the convention of the GraphQL and OpenAPI generators `npm run codegen` runs). */
export const GENERATED_FOLDER = '__generated__';

/** Whether `file` (any separator) lies under a folder named GENERATED_FOLDER. */
export const isGeneratedCode = (file: string): boolean => file.split(/[\\/]/u).includes(GENERATED_FOLDER);

const comparable = (file: string): string => {
  const resolved = path.resolve(file).split(path.sep).join('/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * The files of `files` (absolute, or relative to `cwd`) that are build artifacts: git ignores them in the repository at `cwd` (untracked and matched
 * by an ignore rule; a tracked file is never one) and they are not generated code. Empty outside a git repository or when git cannot answer, so a
 * program then reads what its tsconfig includes, as before.
 */
export function buildArtifacts(cwd: string, files: readonly string[]): Set<string> {
  const candidates = files.filter((file) => !isGeneratedCode(file));
  if (candidates.length === 0) return new Set();
  const answer = spawnSync('git', ['-C', cwd, 'check-ignore', '--stdin', '-z'], { input: `${candidates.join('\0')}\0`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  // check-ignore exits 0 when some path is ignored, 1 when none is, 128 on an error (not a repository, a path outside it).
  if (answer.error !== undefined || answer.status !== 0) return new Set();
  const ignored = new Set(String(answer.stdout).split('\0').filter((line) => line !== '').map((file) => comparable(path.resolve(cwd, file))));
  return new Set(candidates.filter((file) => ignored.has(comparable(path.resolve(cwd, file)))));
}

/** `files` without the build artifacts among them (buildArtifacts), order kept. */
export function withoutBuildArtifacts(cwd: string, files: readonly string[]): string[] {
  const artifacts = buildArtifacts(cwd, files);
  return artifacts.size === 0 ? [...files] : files.filter((file) => !artifacts.has(file));
}

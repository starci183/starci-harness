// repo-identity.mjs - who a repository is, independent of the folder it is checked out in.
// A git worktree (<lanes root>/<lane>/<name>) and the main checkout of the same repository are ONE repository:
// they carry the same README title, the same stack-declaration project name and the same sibling repositories.
import fs from 'node:fs';
import path from 'node:path';
import { revParseQuery } from '../api/git/rev-parse-query.mjs';
import { remote as gitRemote } from '../api/git/remote.mjs';
import { gitOutputOf, withoutGitLocalEnv } from '../lib/git.mjs';
import { trimTrailingSlashes } from './trailing-slashes.mjs';
/** One git call (a scripts/api/git call file) in `root`: its trimmed stdout; throws unless git exits 0. */
const git = (call, root, args, env) => gitOutputOf(call(args, { cwd: root, env: identityQueryEnvironment(env) })).trim(); // gitOutputOf threw unless git exited 0, whose stdout is text
/** Identity queries need repository configuration, never age identities or selected service connection credentials. */
export function identityQueryEnvironment(parent, privateNames = []) {
    const selected = new Set(privateNames.map((name) => name.toUpperCase()));
    return Object.fromEntries(Object.entries(withoutGitLocalEnv(parent)).filter(([name]) => !selected.has(name.toUpperCase()) && !/^(?:SOPS_AGE_KEY(?:_FILE)?|SONAR_.*)$/iu.test(name)));
}
const real = (p) => { try {
    return fs.realpathSync(p);
}
catch {
    return path.resolve(p);
} };
const GIT_SUFFIX_SOURCE = String.raw `\.git$`;
const GIT_SUFFIX = new RegExp(GIT_SUFFIX_SOURCE, 'iu');
const known = new Map();
const stateOf = (root) => { try {
    const stat = fs.statSync(path.join(root, '.git'));
    return `${real(root)}|${stat.ino}|${stat.mtimeMs}`;
}
catch {
    return null;
} };
/** { repositoryRoot, inWorkTree, home } for `root`: home is the main checkout folder when root is a repository top level. */
function identityOf(root, env = process.env) {
    const state = stateOf(root);
    if (state === null)
        return askGit(root, env);
    if (!known.has(state))
        known.set(state, askGit(root, env));
    return known.get(state);
}
function askGit(root, env) {
    let inWorkTree = false, repositoryRoot = false, home = null;
    try {
        // Identity comes from Git only when root IS a repository (or worktree) top level, never a folder inside one.
        // One git call answers both questions: the top level on the first line, the common git dir on the second.
        const [top, commonDir] = git(revParseQuery, root, ['--show-toplevel', '--git-common-dir'], env).split(String.fromCodePoint(10)).map((line) => line.trim());
        repositoryRoot = real(top) === real(root);
        inWorkTree = true;
        const common = path.resolve(root, commonDir);
        if (repositoryRoot && path.basename(common) === '.git')
            home = path.dirname(common);
    }
    catch { /* Not a Git work tree; the caller falls back to the folder and package name. */ }
    return { inWorkTree, repositoryRoot, home };
}
/**
 * The product repository name: the origin remote's repository name (one name for every clone and worktree, whatever
 * folder holds it), else the main checkout's folder name (so a worktree and its main checkout agree), else package.json
 * name outside Git, else the folder name. A folder inside a larger repository (a nested product, an example) is named by
 * its own folder.
 */
export function repositoryName(root, { env = process.env } = {}) {
    const { inWorkTree, repositoryRoot, home } = identityOf(root, env);
    if (repositoryRoot) {
        try {
            const remote = trimTrailingSlashes(git(gitRemote, root, ['get-url', 'origin'], env)).replace(GIT_SUFFIX, '');
            const name = remote.split(/[/:]/u).pop();
            if (name)
                return name;
        }
        catch { /* No origin remote. */ }
    }
    if (home)
        return path.basename(home);
    if (inWorkTree && !repositoryRoot)
        return path.basename(root);
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (typeof pkg.name === 'string' && pkg.name)
            return pkg.name.replace(/^@[^/]+\//u, '');
    }
    catch { /* No readable package.json. */ }
    return path.basename(root);
}
/** The folder whose siblings are this repository's sibling repositories: the main checkout for a worktree, else root. */
export function repositoryHome(root) {
    return identityOf(root).home ?? path.resolve(root);
}

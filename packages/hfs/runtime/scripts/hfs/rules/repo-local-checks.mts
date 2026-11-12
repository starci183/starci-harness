// repo-local-checks.mts - HFS_REPO_LOCAL_CHECK (R103): a repository carries no check, lint rule or lint plugin of its own outside its extension
// folder (PROJECT-LINT-3). Every generic check lives in the .claude runtime or in a canon package (`@starci/eslint-canon-*`); a project's own law
// is a rule of its `ext/` folder (ext/hfs/, ext/lint/) or a project check: a file `ext/checks/<name>.mjs` that ext/manifest.json `checks` declares,
// which `starci app check` runs as its own step (project-checks.mts, R402). This rule refuses the rest by name:
//   - a file or folder named `eslint-local-rules*`, `eslint-plugin*` or `eslint-local-plugin*`, or one below an `eslint-rules/` or `lint-rules/` folder;
//   - a check file in a `scripts/` or `tools/` folder (or one folder below it): a runnable file (`.js`, `.mjs`, `.cjs`,
//     `.ts`, `.mts`, `.cts`, `.sh`, `.ps1`) whose name holds the word check as a whole word, split on
//     `-`, `_` and `.` (`check-schema.mjs`, `tool-names-check.mjs`, `flow_check.cjs`, `ids.check.mjs`, `checks-all.mjs`, `seed-checker.mjs`): the
//     forms a name takes for "this file checks", and never a word that merely starts with it (`checkout.mjs`, `checkpoint.mjs`);
//   - a file of `ext/checks/` that ext/manifest.json `checks` does not declare: the folder holds declared checks only;
//   - a package.json script that runs such a file (a script that runs a declared check is the developer's shortcut to it and stays).
// A check under another name is the reviewer's, not a name test's. The check reads the tracked tree, the extension manifest and the package manifests. Not judged here,
// because another rule already is: a file that defines an ESLint rule or a stylelint plugin by its content, and a script that swaps the
// configuration (HFS_TOOL_CONFIG_LOCAL, R16), and an eslint.config that differs from the render, a relative import of a local plugin included
// (HFS_RULE_OFF_WITHOUT_REPLACEMENT, R17); the shape of the manifest's `checks` (HFS_EXT_INVALID, R381) and a declared check that fails (R402).
import { found, readJson } from './read.mjs';
import type { Parsed } from './rule-types.mjs';

const REPO_LOCAL_CHECK = 'HFS_REPO_LOCAL_CHECK';
const LOCAL_RULE_FILE = /(?:^|\/)(?:eslint-local-rules|eslint-plugin|eslint-local-plugin)[^/]*(?:\/|$)|(?:^|\/)(?:eslint-rules|lint-rules)\//;
/** The folder of the project checks, in the project's extension (slot app.ext): the one home of a project check. */
export const PROJECT_CHECKS_DIR = 'ext/checks/';
/** A runnable file (JavaScript, TypeScript, shell, PowerShell) in a `scripts/` or `tools/` folder or one folder below it: its name. */
const IN_TOOL_FOLDER = /(?:^|\/)(?:scripts|tools)\/(?:[^/]+\/)?([^/]+\.(?:[cm]?[jt]s|sh|ps1))$/;
/** The word check as a whole word of a file name split on `-`, `_` and `.`: check, checks or checker. */
const CHECK_WORD = /^(?:check|checks|checker)$/iu;
/** A path a package.json script runs: a `scripts/` or `tools/` file, or a file of ext/checks/, as a whole command word. */
const RUN_PATH = /(?:^|[\s&|;(])(?:\.\/)?((?:[^\s&|;()]*\/)?(?:scripts|tools)\/[^\s&|;()]+|ext\/checks\/[^\s&|;()]+)/gu;

/** Whether the file name `name` says it checks: one of its words is check, checks or checker. */
export const namesACheck = (name: string): boolean => name.split(/[-_.]/u).some((word) => CHECK_WORD.test(word));

/** The `run` files ext/manifest.json `checks` declares (its shape is the extension check's, R381). */
export function declaredCheckFiles(repoRoot: string): Set<string> {
  const declaration = readJson(repoRoot, 'ext/manifest.json');
  const checks = Array.isArray(declaration?.checks) ? declaration.checks : [];
  return new Set(checks.map((check: Parsed) => check?.run).filter((run: Parsed): run is string => typeof run === 'string'));
}

/** Whether `file` is a check kept outside the lawful home: a check-named file of a tool folder, or an undeclared file of ext/checks/. */
function looseCheck(file: string, declared: ReadonlySet<string>): boolean {
  if (file.startsWith(PROJECT_CHECKS_DIR)) return !declared.has(file);
  const name = IN_TOOL_FOLDER.exec(file)?.[1];
  return name !== undefined && namesACheck(name);
}

/** The findings of the package.json scripts of `file` that run a repository-local check. */
function scriptFindings(repoRoot: string, file: string, declared: ReadonlySet<string>) {
  const findings = [];
  const pkg = readJson(repoRoot, file);
  for (const [name, command] of Object.entries<Parsed>(pkg?.scripts ?? {})) {
    const runs = [...String(command).matchAll(RUN_PATH)].map((match) => String(match[1]));
    if (runs.some((run) => looseCheck(run, declared))) findings.push(found(REPO_LOCAL_CHECK, file, `${file} script ${name} runs a repository-local check (${String(command).slice(0, 80)}); a project check lives in ext/checks/ and is declared in ext/manifest.json checks (PROJECT-LINT-3), a generic check belongs to the .claude runtime`));
  }
  return findings;
}

/** The findings of R103 over the tracked paths `files` of the repository at `repoRoot`. */
export function repoLocalCheckFindings({ repoRoot, files }: { repoRoot: string; files: string[] }) {
  const findings = [];
  const declared = declaredCheckFiles(repoRoot);
  for (const file of files) {
    if (file.includes('node_modules/')) continue;
    if (LOCAL_RULE_FILE.test(file)) findings.push(found(REPO_LOCAL_CHECK, file, `${file} is a local lint rule or plugin; a repository keeps no rule of its own: a project's own lint rule is a rule of its ext/lint/ folder, declared in ext/manifest.json (PROJECT-LINT-3), a generic one is proposed to the canon (@starci/eslint-canon-*) in the .claude runtime`));
    else if (file.startsWith(PROJECT_CHECKS_DIR) && !declared.has(file)) findings.push(found(REPO_LOCAL_CHECK, file, `${file} sits in ext/checks/ but ext/manifest.json checks does not declare it: add {"id": "<kebab-id>", "run": "${file}", "why": "<what it guards>"} to ext/manifest.json checks, or delete it`));
    else if (looseCheck(file, declared)) findings.push(found(REPO_LOCAL_CHECK, file, `${file} is a check kept outside its home: a project check is a file of ext/checks/ that ext/manifest.json checks declares, which starci app check runs (PROJECT-LINT-3, R402); move it there and declare it, or delete it when the .claude runtime already checks the same`));
    else if (file === 'package.json' || file.endsWith('/package.json')) findings.push(...scriptFindings(repoRoot, file, declared));
  }
  return findings;
}

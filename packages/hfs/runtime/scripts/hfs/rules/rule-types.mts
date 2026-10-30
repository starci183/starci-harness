// rule-types.mts - the shapes the hfs content rules (scripts/hfs/rules, runtime-rules) share. Types only, no runtime code.
// The declaration read from hfs.json, the slot resolver and the parsed documents (YAML, JSON, SQL ASTs, compiler nodes)
// are judged by the rules themselves, so they enter as `Parsed`: the one parsed-input boundary of this area.

/** A value parsed from disk (JSON, YAML, a SQL or TypeScript AST node) whose shape the reading rule judges itself. */
// reason: parsed-input boundary; the rule that reads the value checks its shape before relying on it
export type Parsed = any;

/** The TypeScript compiler API module, as `loadTypescript(repoRoot, here)` returns it. */
export type Ts = typeof import('typescript');

/** One finding of a rule: its code, level, file and message, plus the rule's own fields. */
export interface Finding {
  code: string;
  level: string;
  path: string;
  message: string;
  [field: string]: unknown;
}

/** What a rule reads of the declaration (hfs.json) of the repository it judges. */
export interface Repo {
  profile?: string;
  edition?: string | undefined;
  apps?: readonly Parsed[];
  sides?: Record<string, Parsed>;
  [field: string]: Parsed;
}

/** The slot resolver of a repository (scripts/hfs/slots.mjs): classification of a path, slot lookup, ownership. */
export interface Resolver {
  sides?: Record<string, Resolver>;
  classifyPath(file: string): Parsed;
  slot(name: string): Parsed;
  [member: string]: Parsed;
}

/** The context `starci app check` passes to every finder of a rule. */
export interface RuleContext {
  repoRoot: string;
  files: string[];
  all?: string[];
  repo: Repo;
  resolver: Resolver;
  manifest: Parsed;
  isRoot?: boolean;
  inScope?: (file: string) => boolean;
}

/** A finder: the findings of one rule over one repository. */
export type Finder = (context: RuleContext) => Finding[];

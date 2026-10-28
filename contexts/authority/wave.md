# Tier 2: a wave

A wave is one scoped round on a merged tree. It runs when a batch lands on one tree: Debug after merging what it lands
(its lanes, a workflow's or worker's branch, package edit branches) and before it pushes, a Kernel or the inline runner
when a batch of tasks has landed on the workflow worktree and again before the workflow finishes, an app session before
it pushes. Merge every ready branch
first and run one round; never a round per branch or per merge.

## The scope decision comes first

Before any command, write the scope decision, and keep it beside the run (the handoff's evidence, the merge commit body,
the release record):

1. **Diff:** `base..head` of the round.
2. **Changed files** in that range.
3. **Reach:** their reverse imports, plus what depends on them without importing them: generated files (database types,
   the GraphQL schema, i18n catalogs), migrations to types and integrations, schemas, catalogs and contexts a check reads,
   templates and configuration.
4. **Commands:** the exact commands with their file or suite lists: the lint and typecheck of the reached files, the
   tests related to the changed files, the named integration proofs, a CLI change run against a scratch repository
   (CONTRIBUTING.md CONTRIB-1).
5. **Skipped, and why:** every check left out and the tier that covers it.

Choose the cheapest command that covers the scope and run independent commands in parallel. Run the full set only when
the reach is everything.

## Reuse and repair

A row whose inputs did not change since it was green is reused, never rerun: Debug landing a workflow reuses its
Kernel's green rows, and a push reuses the round it follows. After a red, repair the red files and rerun only the red
rows and the rows that depend on them. A red belongs to the tasks that landed the files its findings name (a composer also
answers for the modules deferred to it), whichever task left the check; a task whose own files are green stays green, a finding in a file no task of the round landed is the round's
error and fails no task, and a task returned on a shared red that names no file spends no try (`cli/src/harness/wave.ts`). A green round goes to main at once ([ci.md](ci.md)).

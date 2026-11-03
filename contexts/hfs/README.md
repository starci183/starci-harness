# HFS: the app shape

HFS is the one source and storage standard of a StarCi app: what may exist in the repository, where, which tier may
import which, and which rules judge it. It is data a machine reads; the reasons live in the patterns
([be](../code/be/README.md), [fe](../code/fe/README.md)).

| File | Holds | Read by |
|---|---|---|
| [slots.yaml](slots.yaml) | the slot manifest: editions, sides, app and trigger kinds, the tier matrix, rule parameters and every slot | the app CLI checks, the canon lint factories, the architecture machine, templates; an agent through `starci app slot` |
| [rules.yaml](rules.yaml) | the rule catalog: id, finding code, the law in one sentence, failure codes, enforcers | gates and lint (by code), an agent resolving a cited `R<n>` |

An app declares itself in `hfs.json` (kind app, its `edition` fixed at scaffold, its sides, apps, patterns,
backing services and its grammar). No product content lives here; product records belong in the app's `.starciwork`.

## One word, one meaning: "slot"

- **slot** (unqualified, in hfs and patterns): an entry of [slots.yaml](slots.yaml), a place a path may live.
- **anatomy slot**: a named part of a vendor or grammar component (`data-slot`), in [vendor](../vendor/README.md) and
  the [grammar contract](../grammars/contract.md).
- `Slot<T>` and `SlotView`: code identifiers of the front-end status recipe; prose calls the value a **resource**
  ([code/fe](../code/fe/README.md#data-status-of-a-region)).

## Slot fields

| Field | Meaning |
|---|---|
| `id` | stable dot-separated name (`<profile>.<...>`); never changes meaning inside a major |
| `profiles` | `app`, or the sides (`be`, `fe`) the slot exists in; the path is relative to that side |
| `path` | pattern: `<name>` binds one segment, `*`/`?` stay in a segment, `**` spans directories, `{a,b}` alternates; a trailing `/` owns the directory except what a more specific slot owns |
| `presence` | `required`, `optional`, `opt-in` (legal only when `hfs.json` declares it), `forbidden`; `litePresence` overrides it under lite |
| `tracked` | `tracked`, `ignored` (must be git-ignored) or `external` (must not exist; `goesTo` says where it lives) |
| `tier`, `owner`, `entries` | the node in the direction matrix; whether each matching directory is an owner; extra entry files besides `index.ts` |
| `role`, `importedBy` | the one part a file slot plays that a rule reads (`entity-registry`: the lite `PRIMARY_ENTITIES` list); the side-relative patterns of the only files that import it by deep path |
| `requires`, `allows`, `forbids`, `minInstances`, `requiredInstances` | what an instance must, may and must not hold |
| `tests`, `coverage` | `unit-beside`, `e2e` or `none`; whether the logic roles of the subtree, and the files its slots declare in `logic`, are measured |
| `logic` | on a coverage-required `unit-beside` directory slot, the files it requires or allows that carry logic without a logic-role suffix (`passport.tokens.ts`): each is measured at 100 per file like a logic-role file, and its `<file>.spec.ts` beside it is a legitimate unit spec the slot admits unlisted; it names files, never a role |
| `budget` | size budgets of the slot (lines per file, files, exports, hooks); the one owner of those numbers |
| `trigger`, `pattern`, `appKind`, `composedBy`, `provider` | the feature kind, the declared pattern that enables it, the app kind it describes, the app kinds that compose it, the connection provider that enables it |
| `managedBy`, `liteManagedBy` | the template directory the app sync renders it from; a difference is drift |
| `managedOnly` | true: the slot only lists files sync renders (it needs `managedBy`); the slot that owns the path judges the file, so a rendered service keeps the rules and the tier of its folder |
| `editions`, `lite`, `editionWhy` | the editions it exists in, the fields it carries under lite, and why lite differs |
| `rules` | finding codes of [rules.yaml](rules.yaml) that judge the slot |

## Rule parameters (`ruleParams`)

The values a rule reads, each stated once: `common` (file and function line budgets, feature file budget, the
duplicate-block threshold), `be` (raw-library owners, the in-process event vocabulary the CQRS rule refuses, the
spec doubles of the test kit, injected parameter names, the closed file-suffix vocabulary and banned suffixes, the
unit, logic, value and thin roles, pattern proof scenarios, the patterns each trigger kind needs, the `app add`
kinds, backing services, and the lite overlay), `db` (allowed Postgres extensions, the queue outbox shape). A rule
law names the parameter instead of its value.

## Rules

A rule is a law that a machine can decide; one that needs judgement is a pattern rule reviewed by an agent. Each
entry names its enforcers by kind (`eslint-be`, `eslint-fe`, `eslint-grammar-core`, `stylelint`, `machine`,
`hfs`, `sonar`). Every rule is an error: no baseline, allowlist or suppression exists for a product. The rules of the
StarCi runtime repository itself are harness policy, not app knowledge, and are not in this catalog.

## The harness's own shape

The harness repository is a tree of kind `runtime` (its `hfs.json`), and its shape is [harness.yaml](harness.yaml), in
the field vocabulary above: each slot has an `id`, a `path` pattern (or a list), `presence` (`required`, `optional`,
`forbidden`), what it `holds` and the `rule` it serves. Three fields are the runtime's own: `per` makes a required slot
hold in every instance folder (`packages/<name>/`), with `requires` naming the files each must hold and `exempt` the
instances it does not apply to; `jsonKey` narrows a forbidden slot to JSON files that declare the key (a `package.json`
with `bin` is a second CLI); `generated` marks copies made from an owner in `contexts/` (a package's `runtime/`).

`starci check shape` places every file of the tree as it stands (tracked and untracked, never what `.gitignore`
ignores). Forbidden slots judge first: a match is `SHAPE_FORBIDDEN`. A file no other slot holds is `SHAPE_UNPLACED`; a
required slot, or one instance of it, with no file is `SHAPE_MISSING`. A slot with `enforce: target` states a law the
tree is still moving to (every package TypeScript in `src/` built to `dist/`, knowledge only in `contexts/`): a violation
is `SHAPE_TARGET` unless one of its dated `exceptions` (a literal file or folder, `until`, `owner`, `why`) covers it. An
exception that covers nothing is `SHAPE_EXCEPTION_STALE` and one past its date `SHAPE_EXCEPTION_EXPIRED`, so the list
only shrinks; a gate slot has no exceptions. A new place for a file is a new slot here, never a wider pattern elsewhere.

## Editing

A slot or rule changes here first, in its one entry, and the patterns cite it. A changed path, presence, import edge
or budget is a major change of the manifest and needs an owner ruling ([decisions/rulings.yaml](../decisions/rulings.yaml));
adding an optional slot or a rule is a minor one.

## Rule notes

The rules below judge repository hygiene, deployment and supply chain. Their law is one sentence in [rules.yaml](rules.yaml); each
note says what the rule protects and what to do when it fires. A rule that guards a UI composition has its page under
`contexts/ui/` or `contexts/code/fe/` instead.

| Rule | Protects | When it fires |
|---|---|---|
| R07 | `.starciwork` stays product records | Move agent or session data out of `.starciwork`; it holds product records only. |
| R09 | identity custody | Point an identity's secret at `secrets/identity-<slug>.enc`; UAT chooses an identity by role. |
| R223 | roles do not act as each other | The command guard refuses `git push`, `git tag` and raw git writes by role; use the verb that owns the step. |
| R224 | the protected zone | Edit the zone declared in `modules/kernel/protected-zone.yaml` only by the owner path. |
| R225 | the hook model | Keep pre-commit L0 only (no typecheck or test run) and let pre-push call the bundled push policy. |
| R03 | the tree holds only declared things | Track the file under a slot, or add it to `.gitignore` through the managed block. |
| R04 | the shared ignore list | Run `starci app sync --execute`; never edit the managed `.gitignore` block by hand. |
| R10 | `.starcistacks` shape | Fix the stack declaration to the edition's standard; dependencies in Docker, the app on Swarm. |
| R12 | the automatic gate stays fast | Move the e2e out of pre-commit, coverage and automatic CI; run it on demand. |
| R13 | no commit skips the gate | Restore the pre-commit hook path and the CI lint step; never redirect `core.hooksPath`. |
| R14 | one version per dependency | Align the versions or the root overrides; use npm only. |
| R15 | canon packages match their pins | Change the pin in `contexts/stack/pins.yaml` or the dependency, not both silently. |
| R24 | the architecture machine reads the repository | Fix `hfs.json` so the machine sees files; zero analysed files is red. |
| R104 | findings are fixed, not hidden | Delete the suppression file, script or option and fix the finding in code. |
| R105 | proof commands run | Create the file the `.starciwork` proof command names, or correct the command. |
| R143 | the monorepo shape | Declare the workspaces, an exact `packageManager`, the pinned turbo and one root lockfile. |
| R146 | each workspace declares what it imports | Add the import to that workspace's `package.json`; the app root declares no workspace package. |
| R187 | image builds are reproducible | Build from the app root and copy only from inside the build context. |
| R189 | image entry | Start the built entry in exec form with the port, exposure and HEALTHCHECK of the app kind. |
| R190 | base images are pinned | Use a prior stage, the canon node base from `stack/pins.yaml`, or a digest-pinned image. |
| R191 | no secret in an image | Remove the copied file, URL or credential-named ARG or ENV; pass secrets at run time. |
| R220 | lite secret custody | Keep secrets only in the sealed `.starcistacks/<env>/secrets/<slug>.enc` members. |
| R249 | environment values parse | Fix the stored value so it parses as the type its `EnvSource` reader declares. |
| R251 | deploy workflows are safe | Declare protected environments, permissions and concurrency; pin actions by commit SHA. |
| R252 | scripts do not leak secrets | Remove plaintext secret loads and xtrace from scripts and workflows. |
| R267 | a release can be restored | Declare the images lock, release pointers, health assertions and a backup with a restore proof. |
| R269 | supply chain is watched | Add Dependabot schedules, `npm audit` in CI, and an SBOM and provenance on release images. |
| R270 | documentation is true | Correct or delete a cited path, script, verb, environment key or rule id that does not exist. |
| R271 | release tags | Tag `v<package version>`, push images under `sha-<sha>` and retag the digest for the release name. |
| R275 | one ingress | Declare one ingress component with a digest-pinned image and its hosts per Swarm environment. |
| R276 | lite has no self-hosted store | Use the managed database; declare Redis only when needed, durably, on a declared volume. |
| R282 | the repository stays small | Keep assets inside the `be.assets` budget and allowlist; never track model weights or datasets. |
| R283 | removed words stay removed | Replace the word `hfs.json` `lexicon.removed` lists with its replacement. |
| R293 | deploy tooling has one owner | Call the canon stack verbs instead of re-implementing them in scripts or workflows. |
| R294 | deploy config is coherent | Fix the environment's deploy block until the stack verbs normalise it against the real tree. |
| R296 | service custody and CI execution copies | Bind each sealed tooling copy to its exact product service, project, environment, member and key; keep runtime keys out of CI. |
| R297 | app secrets are not CI secrets | Remove from CI secrets or vars any key granted to the app container. |
| R298 | CI declarations match use | Declare each referenced secret or variable in its CI class, and drop declarations nothing consumes. |
| R299 | workflow expressions | Use only contexts that exist at that workflow key. |
| R300 | public build values | Give each required `NEXT_PUBLIC_*` value a Dockerfile ARG default or a build arg in every environment. |
| R301 | one CI standard | Deliver CI through `starci app sync`, never by editing the workflow by hand. |
| R314 | navbar control size | Use one control height and one icon size per region from the Grammar scale. |
| R315 | navbar order | Order the cluster language, theme, notifications, account, each from the Grammar. |
| R316 | no bottom tabs | Keep the Grammar shell's navigation on every viewport; do not draw a bottom tab bar. |
| R337 | auth cookie domain | Set the cookie domain when the web and the api are served from different hosts. |
| R343 | the check cache is trusted only at its base | Re-run the check and commit the computed cache; never edit a record. |

# Contributing to the harness

These rules hold for every edit of this repository: `cli/`, `ops/`, `policy/`, `contexts/`, `packages/`, `skills/`
and the root documents. Read [contexts/README.md](contexts/README.md) first. Each rule is a heading with a stable id (`CONTRIB-<n>`), so
a task can name the ids it applied.

## Setup and the checks you run

Node 24 (`node:sqlite` unflagged). The CLI builds with `tsc` into `cli/dist`, which git never tracks.

```sh
cd cli
npm ci                  # also builds cli/dist (prepare); once per checkout, never per branch where it is shared
cd ..
node cli/dist/main.js check loosening
node cli/dist/main.js check secrets
```

Which checks you run, and when, is [contexts/authority/](contexts/authority/README.md): a branch runs at most a typecheck
or lint of the files it touched, the merged batch runs one scoped round (`starci check run` runs the runtime tier of this
repository's profile, `runtime` in [hfs.json](hfs.json), over the round's diff), and CI the rest. A package under
`packages/` is installed and built inside its own folder ([packages/README.md](packages/README.md) says how, including
the siblings that must be installed together).

## How a change is proved

### CONTRIB-1 The CLI keeps no spec suite

A CLI change is proved by running the built CLI (`node cli/dist/main.js ...`) against a scratch git repository created
under a temp directory, with `STARCI_LOCAL_ROOT` pointed at a temp state base, in the wave round on the merged tree
([contexts/authority/wave.md](contexts/authority/wave.md)). The proof is scoped to what the change touches; never run it
inside a real project or this checkout's `.runtime/`. Do not add a test framework to `cli/`.

### CONTRIB-2 Packages keep their specs

Each package under `packages/` proves itself with its own `node:test` specs (`npm test` in its folder), which CI runs. A
rule change in a canon comes with the spec that holds it. The Grammar is exempt and keeps none, by the owner's order of 2026-11-26 ("xóa tests grammars và ghi rules chặt vì useless"): it takes no shots either (the owner, same day: "Bỏ vụ chụp hình đi, xoá luôn"): it is proven by its code, its stories and its contract, read in review, and the shape gate slots `never.grammar-tests` and `never.grammar-shots` refuse a spec, test, runner config or screenshot there ([contexts/ui/proof.md](contexts/ui/proof.md) GRAMMAR-NO-TESTS).

### CONTRIB-3 Test only what you changed

A branch runs no tests, the wave runs the tests its scope decision names, and the full suite is CI's, after the push
([contexts/authority/](contexts/authority/README.md)).

## CONTRIB-4 One owner per fact

A fact, number, path, name or rule has exactly one owner; everything else reads it, cites it or is generated from it.
A second copy is a defect even while both agree.

| fact | owner |
|---|---|
| a verb: path, flags, effect, roles, json schema | its one `defineVerb({...})` file, listed in `cli/src/registry.ts`; `starci explain` prints it |
| a label: its base context, inputs, output keys and checks, floor, host tools and procedure | its op file `ops/ops/<label>.md` |
| the standard build flow (which labels a Work record walks, in which order, what satisfies a step) and the bounded repair routes | `ops/lanes.yaml` and `ops/routes.yaml`, read by `cli/src/harness/lanes.ts` and `routes.ts` |
| the op pattern (base and extend) and the worker procedure common to every brief | [ops/ops/README.md](ops/ops/README.md) |
| check presets, routing, failure bounds, budgets, liveness thresholds, the uat image | `ops/checks.yaml`, `ops/routing.yaml`, `ops/liveness.yaml`, `ops/uat.yaml` |
| the map of ops/, the router's steps, failure classes and their accounting | [ops/README.md](ops/README.md) |
| gate tiers, profiles, project overlays, banned markers, the secret scan's configuration | the files of [policy/](policy/README.md), mapped by its README |
| what each gate and marker detects | `cli/src/core/check/` and `cli/src/shared/secrets.ts` |
| every state path | `cli/src/harness/ledger.ts` |
| task states and their transitions | `TRANSITIONS` in `cli/src/harness/tasks.ts`, changed only through `setStatus` |
| how the CLI is built, the verb standard, how the harness inside it works (ledgers, settling, graph, seat launch) | [cli/README.md](cli/README.md), naming the code that implements each |
| load order | [contexts/README.md](contexts/README.md) |
| who may edit, commit, merge, push and publish, and which tier of checks each role runs | [contexts/authority/](contexts/authority/README.md) |
| axes, roles, where state lives and how a project is found, the host environment, hard rules, open questions | one file each in [contexts/harness/](contexts/README.md#harness) |
| what the harness is, how it works, how to install it, the verb groups, CI | [README.md](README.md) |
| how a release is published and the secret it needs | CONTRIB-20 below |
| what each CLI release changed | [CHANGELOG.md](CHANGELOG.md); a package's, its own `CHANGELOG.md` |
| how to report a vulnerability; the conduct expected | [SECURITY.md](SECURITY.md); [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| how app code is written | [contexts/](contexts/README.md) |

When you find a copy, keep the owner, make the other site read or cite it, and delete the copy in the same commit. If
no owner exists yet, create it first. Never answer a duplicate with an allowlist, a baseline or a suppression.

## Writing rules and prose

### CONTRIB-5 Present tense, no ghosts

Describe the tree as it is. Do not define something by the state it replaced; history lives in git.

### CONTRIB-6 Rewrite the concept where it lives

A change is a change to a concept, never a line added beside the rules that already hold it. Before editing, read the
harness for that concept, then:

1. **Name it.** Write down the concept the change touches and every term, rule id and synonym it goes by.
2. **Find every place it lives.** Search the whole tree for those terms (`contexts/`, `ops/`, `policy/`, `skills/`,
   `cli/src/`, `cli/README.md`, the root documents) and read each hit in its paragraph, not as a line.
3. **Rewrite those places.** Rules A, B, C and D that the change touches become A', B', C' and D', so the general rule is
   true with the change. A new sentence is written only when the concept had no home, and then in its owner (CONTRIB-4).
4. **No case notes.** Never answer a change with an exception beside the old rule: "if E then E'", "except", "note",
   "also", a bullet that narrows or contradicts an existing one, or a second section for the same concept. A carve-out the
   owner rules is written into the general sentence itself.
5. **Code the same way.** A fix lands in the function that owns the behaviour, not as a guard at a caller that patches one
   symptom, and the path it makes dead is deleted in the same commit.
6. **Show the search.** The commit message lists the places found and how each changed, or why it stays.

Appended cases contradict silently: a reader takes the first sentence and never meets the second, and the tree grows
without becoming truer. Held by review.

### CONTRIB-7 Feedback is fixed at its root

Owner feedback and owner decisions become a code change that removes the cause, or the rule rewritten in its owning
file. Never a check written for that one case ([CONTRIB-10](#contrib-10-general-checks-only)). There is
one rule book, `contexts/` and this file: a decision is written once, as the rule that holds now, and never logged a
second time, attributed or dated. A rule cites other rules by their ids, never a ruling, a decision log or a date, and a
CHANGELOG entry says what changed, never which ruling asked for it. A question that awaits the owner is one entry of
[contexts/harness/questions.md](contexts/harness/questions.md) until it is answered. It never becomes a case note
beside a rule or a "lessons" section. No design document sits beside the owners: plans, phases and history live in git,
not in a file.

### CONTRIB-8 Claims execute

A sentence that says something refuses, validates or is enforced names code that does it. If the code does not, fix the
code or remove the claim.

### CONTRIB-9 Data is data

`ops/` and `policy/` hold declarative YAML (and the op files' front matter) the CLI validates; a key no code reads is
deleted. Numbers live there once and are never repeated in prose.

### CONTRIB-10 General checks only

Checks are general. A one-off mistake gets no check: fix its root cause (an
API or generator change that removes the choice, or the fix in the owning component) or rewrite the general rule in its
one place. A new check, lint rule, finding code or refusal needs all of:

1. a broad bug class, stated without naming one app, file, component or literal;
2. evidence that it recurred in more than one place or app;
3. no existing general check that can be widened to cover it;
4. the owner's sign-off, recorded in the commit.

Widen an existing check before adding a code. A rule with no gate is held by review, and that is a complete state, not a
debt.

## Code rules

### CONTRIB-11 No loosening

ESLint `strictTypeChecked` plus `stylisticTypeChecked` with `noInlineConfig`. Never `eslint-disable`, `ts-ignore`,
`as any`, `NOSONAR`, a skipped check, `|| true` or `--no-verify`. Change the code, not the gate; an unavoidable marker
is an exception in `policy/loosening.yaml` with its reason, never inline.

### CONTRIB-12 One verb, one file

A verb is one `defineVerb` in its own file. Refusals throw `Refusal(code, message)`; a red verdict returns exit code 1.

### CONTRIB-13 No shell

Host processes run without a shell through `cli/src/shared/exec.ts`; git goes through the one runner in `cli/src/shared/git.ts`.

### CONTRIB-14 House style

4-space indent, no semicolons, double quotes, a one-line JSDoc on every export, comments only where they carry a rule.
No new dependency without a reason the owner accepts. Line endings are LF (`.gitattributes`).

### CONTRIB-21 Add only what is missing; remove completely

The harness has two consumers before beta, NIVO and StarCi Next. Before adding anything (a Grammar component or prop, an hfs rule
or enforcer, a lint rule, a CLI verb or flag, a contexts page or section), challenge it in this order, and add it only when every
answer says add:

1. **Does it exist?** Search Grammar, hfs, the lint packages and `contexts/` (`starci contexts search`). If it exists, use it or cite it.
2. **Can an existing thing take it** as a parameter, variant or option instead?
3. **Does the compiler, a type or an existing check already catch it?** Then no lint rule and no hfs rule (CONTRIB-10).
4. **Do NIVO or Next need it now?** If not, it waits for beta.

A Grammar component or prop then enters `@starci/grammar` only through
[contexts/grammars/contributing.md](contexts/grammars/contributing.md): tier, budget, types, lint, knowledge, its stories in both
families and modes, its contract row and family section, and the change reviewed by a person.

When something is removed or replaced:

1. **Migrate the consumers** to the replacement in the same change, through NIVO's and Next's own lanes, landed with or before
   the harness lane.
2. **Delete it completely:** code, types, exports, stories, fixtures, styles, baselines, lint rules, enforcer and catalog rows, docs
   and every link to it. No tombstone page, no "removed / replaced by" note, no deprecated alias or re-export, no compat shim, no
   old flag still accepted, no guard lint: the compiler and the missing export are the guard.
3. **Rewrite the owning pages** to describe only what exists now (CONTRIB-5); a CHANGELOG records no pre-beta removal.
4. **Prove it is gone:** a grep for the old name across `D:/.claude`, `D:/Repositories/nivoos-lite` and the Next repositories finds
   nothing outside git history.
5. **Stop and ask the owner** when a removal breaks a consumer flow that has no replacement yet; never keep a shim instead.

A lane's report carries one line for each: for an addition, what it searched and why nothing existing fit; for a removal, the
empty grep. Held by review. From beta on, a removal keeps a deprecation, a migration note and a CHANGELOG entry.

## Commit and push

### CONTRIB-16 Your own worktree

Work in your own worktree on your own branch. Never stash, reset, force or switch branches in a checkout holding someone
else's work; two agents never write the same files.

### CONTRIB-17 Small commits with hooks

Commit with hooks, in small commits whose message says what the change does.

### CONTRIB-18 Push after a green scoped check

Main is pushed right after a green wave round ([contexts/authority/wave.md](contexts/authority/wave.md)) with
`starci release push --execute` (dry without it; it refuses a dirty tree, a non fast-forward and a secret in the pushed range). In this repository it also
runs the light gates CI refuses on, locally and in the dry run: the plan judgement of CI's publish step against the base CI would use
(`RELEASE_VERSION_NOT_BUMPED`, `RELEASE_DEPENDENCY_SKEW`, `RELEASE_DEPENDENCY_UNPUBLISHED`, `RELEASE_PEER_RANGE_EXCLUDES_PIN`) and the contexts anchors
(`PUSH_ANCHORS_RED`: `contexts anchor` with no id) (`cli/src/core/release/push-gate.ts`). The specs of a package stay CI's. CI judges
everything else.

### CONTRIB-19 A red CI is the next commit

A red CI is fixed by the next commit, scoped to the red checks (`starci check ci` names them). It does not
block the next push.

### CONTRIB-20 Publishing is CI's

An unreleased harness package change is usable the moment it is coded through the local registry (`starci deps publish-local`,
then `starci deps install-local` in the app; [contexts/authority/packages.md](contexts/authority/packages.md)); reaching npm is a
separate step CI takes alone. CI is two workflows. [.github/workflows/ci.yml](.github/workflows/ci.yml) only tests and never writes to npm
or to main, so a newer push cancels the `ci` run still going for an older commit (on main as on a pull request) and the newer run tests the
whole tree: its `plan` measures from the last main commit whose `ci` run succeeded, and a cancelled run is not a success. Each `package` job
packs its package once, after its specs, and keeps the tarball as the artifact `tarball-<name>-<version>-<sha>`.
[.github/workflows/publish.yml](.github/workflows/publish.yml) starts when a `ci` run of a push to main succeeds (never when it failed or was
cancelled: every job green, the Sonar quality gate and the app job included), reads that run's jobs, plan and tarballs, and publishes; it checks out the run's commit, is never cancelled and queues one
run at a time (group `publish-main`; a queued run is replaced by a newer queued one). It publishes nothing when its commit is no longer main's
tip when its turn comes (an older commit published after a newer one would move the `alpha` dist-tag back; the run of the newer commit publishes
every version not yet on npm, the older ones included). Its run is named `publish <sha>` and is red for that sha when it fails: `starci check ci`
counts it ([cli/README.md](cli/README.md) "CI verdict and publication"). `starci release publish --base <the plan's base>` judges the plan (its dry run), then with `--execute` publishes in two phases every package under
`packages/` and then the CLI (`starci-harness`, from `cli/`) whose version is not on npm yet, a dependency before its
dependent, skipping a private one and a version already on npm, with npm provenance, under the dist-tag a prerelease version names
(`1.0.0-alpha.1` goes to `alpha`, a plain version to `latest`). The packages are published from the tarballs the `package` jobs packed after
their specs (`--tarballs`: the tested bits, stamped with the commit, never rebuilt; a due package no job packed, its folder unchanged since a green base,
is built and packed in the run), four `npm publish` at a time, and read back together. A package publishes once the repo-wide gates (`gate (repo)`: secrets, loosening, shape) are green and so is the
`package` job of every folder of its build order the plan tested, itself and the siblings it needs,; a due package any of them failed is held and named, and so is each dependent of it ([.github/scripts/publish-gate.mts](.github/scripts/publish-gate.mts)).
The CLI follows in the same run, once the harness job and every gate are green. A red Sonar quality gate or app job holds every package and
the CLI (2026-11-17): nothing publishes from a ci run that is not green as a whole. A `publish` run is never cancelled, so a publication is never cut short, and a
re-run (of the failed jobs) publishes only what is still missing. The plan is refused, before anything reaches npm, when a package changed since the base (its
specs and test folders aside) while its version is already on npm (`RELEASE_VERSION_NOT_BUMPED`, measured from the
commit npm recorded for that version), and when a due package requires a sibling (`dependencies`, `peerDependencies`)
at another version than the sibling's folder holds at that commit (a same-minor range `~x.y.z` is met by any patch of it), or at a
version that is neither on npm nor due in the same run. The Grammar family takes
a same-minor range in the canon pins: a Grammar patch publishes the three family packages alone, and a minor raises the
range in `@starci/hfs` and releases the whole family ([contexts/grammars/contributing.md](contexts/grammars/contributing.md) "Patch or
minor"). A raised version npm does not serve is published whatever its content, even with an empty diff, because the stack pins name it and an immutable registry needs it; `unchanged` never appears in the plan. A stack pin of a package at a version npm does not serve and this run does not publish refuses `RELEASE_PIN_UNPUBLISHED`. A package the plan publishes, or one a stack pin names at the version its folder holds, whose
`peerDependencies` range excludes the version a sibling is pinned at (or published at) refuses `RELEASE_PEER_RANGE_EXCLUDES_PIN` (`cli/src/core/release/peer-range.ts`): an
app installs the pinned set, and an excluded peer fails `npm ci` with ERESOLVE. The canons peer `@starci/hfs` by a same-minor range and read its runtime at run time, so an hfs patch does not release them and
an hfs minor moves their peer range in the commit that raises the pin. The canons that peer hfs are `eslint-canon-be`, `eslint-canon-fe` and the Grammar
lint `eslint-grammar-core` (`eslint-grammar-offset-pop` peers it exactly), so every hfs minor cuts each of them, the Grammar family as a
patch, in that commit: the range stays same-minor and is never widened, since a canon reads the hfs runtime it was tested against.
A canon or Grammar release cut on an older hfs minor while a newer one is open serves that older line only, and the newer line
takes its own cut. `packages/hfs/src/canon-pins.spec.mts` holds each canon's peer admitting the hfs folder's version, and
`deps publish-local` holds the same line on the local registry ([contexts/authority/packages.md](contexts/authority/packages.md) "The local registry"). A change to a package therefore raises the version in its `package.json` and sets its CHANGELOG
(the CLI's is [CHANGELOG.md](CHANGELOG.md)) to a `## <version>` section with a one-line summary in the commit that makes it (versioned history starts at beta); a package and the sibling version it requires
move in one commit. The CLI is the one exception, held for the second phase: `cli/package-lock.json` installs its
siblings from npm, so its commit requires each at a version npm serves, and it requires every `@starci` package
(`cli/package.json` and each copy its lockfile resolves) at its pin in [contexts/stack/pins.yaml](contexts/stack/pins.yaml),
refused `CLI_PIN_SKEW` by the `check pins` gate on every push and by `release publish` before the CLI publishes. A pin
of a package the CLI requires is therefore raised together with the CLI's requirement and lockfile, in the same commit when npm
already serves the new version, else in the next one once the first phase published it. In between, `check pins` is
`pending` (exit 0), not red, while every skew pins this commit's own package version that npm answers with a 404; a skew to a
version npm already serves, or a registry that cannot be asked, stays red, and the publish run skips a CLI that trails its pins.
The follow-up commit is CI's own and is made inside the publish run: the `cli-follow` step ([.github/scripts/cli-follow.mts](.github/scripts/cli-follow.mts)), once
the packages are on npm and npm serves every skewed pin, raises the CLI's requirement and lockfile to the pins, bumps its
prerelease when that version is on npm and records it in [CHANGELOG.md](CHANGELOG.md); the run commits that, builds the CLI against the registry
copies, runs its tests, publishes the CLI from that commit (`release publish` accepts the one cli-follow commit directly above main's tip, nothing
else, though it is not pushed yet) and only then pushes the commit to main with the repository secret
`HARNESS_BOT_TOKEN` (a fine-grained token, contents: write on this repository; a push with `GITHUB_TOKEN` starts no run; without it the CLI
waits). The `ci` run of that commit finds nothing due: when a diff changes only the CLI's version and requirements, its lockfile and the changelog,
and the CLI version it holds is on npm, `release affected` plans no package and no harness job. Every CI job installs the CLI with the siblings of the commit packed over the registry copies
([.github/actions/cli-install](.github/actions/cli-install/action.yml)), the siblings those require at run time packed with them (a version npm
does not serve yet comes from its tarball) and every `file:` sibling they copy built first, and the publish run publishes the CLI as committed,
refusing while a sibling it requires is held. `starci release publish --execute` from a
workstation is Debug's fallback when CI cannot publish, with the owner's approval.

The job reads one repository secret, `NPM_TOKEN`, handed to npm alone in the publish step: an npm granular access token
with read and write on the `starci-harness` package and the `@starci` scope (or an automation token of the publishing
account). The owner adds it once, and again when it expires, with `gh secret set NPM_TOKEN --repo
starci183/starci-harness`, pasting the token at the prompt; it is never written to a file, a command line or this
repository.

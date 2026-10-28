# Release

Selection authorizes no release. Resolve the repository, the commit, the package and version; when any is
unclear, present the plan and get the owner's OK. Continue an unchanged approved release without asking
again. Push main after a green wave round ([contexts/authority/wave.md](../../../contexts/authority/wave.md): the
scope decision first, then one scoped round); CI is the critic, runs the full suite on main and publishes new package
versions ([contexts/authority/ci.md](../../../contexts/authority/ci.md)).

## 1. Scoped check

```text
starci check run
```

The runtime tier of the repository's policy profile ([policy/quality.yaml](../../../policy/quality.yaml)):
secrets, loosening, canon, typecheck and lint, scoped to the diff against `origin/main`. Run one step alone
with `starci check lint`, `starci check typecheck`, `starci check secrets` or `starci check loosening`.
A red gate is fixed in the code. Never loosen a gate, add an inline disable or a policy exception to pass.

## 2. Push

```text
starci release push --dry-run
starci release push
```

The one way main moves: it refuses unless the branch is main, the tree is clean, the push is a fast-forward
and the pushed range holds no secret, then runs `git push` with the hooks. Never push by hand, force or skip
hooks.

## 3. Read CI

```text
starci release ci-status
starci release ci-status --sha <commit>
starci check ci --ref origin/main
```

`ci-status` prints the verdict (green, red, pending, none). `check ci` exits 0 only on green, for a script or
a deliver contract (preset `ci-green`). A red CI becomes a scoped `code` task for the red checks; it never
blocks the next push.

## 4. Cut

```text
starci release cut --dry-run
starci release cut
```

Tags `v<version>` of the package (`--package <p>` when there are several) on a commit already on the remote
main, with its finished CHANGELOG section as the notes, and pushes the tag alone. It runs no suite.

## 5. Publish

```text
starci release publish
```

On the harness, CI publishes on every push to main (CONTRIBUTING.md CONTRIB-20); run it by hand only as Debug's fallback
when CI cannot. Without `--publish` it only prints the plan: every package version not yet on npm (`--package <p>`
narrows it). The plan is judged before anything is published: a due package requiring a sibling at another version than
the sibling's folder holds is `RELEASE_DEPENDENCY_SKEW`, one requiring a private sibling `RELEASE_DEPENDENCY_UNPUBLISHED`,
and with `--base <commit>` (CI passes its plan's base) a package changed since then whose version is already on npm is
`RELEASE_VERSION_NOT_BUMPED`: raise its version and CHANGELOG. `--publish` publishes a dependency before its dependent.
npm is public and permanent: show the plan and get the owner's OK for exactly those packages and versions every time,
then publish. It publishes from a clean commit on the remote main and reads each version back; `PUBLISH_NOT_CONFIRMED`
means the registry does not show it yet.

## CI gate

`requireCi` in [policy/quality.yaml](../../../policy/quality.yaml) lists the actions that wait for a green CI
of their commit (`release.cut`, `release.publish`, `deploy.prod`; the file names which apply). They refuse `CI_NOT_GREEN`
until `release ci-status` of that commit is green. Wait for CI; never route around the gate.

Report the pushed commit, the tag, the published versions and the CI verdict, saying so when CI is still
pending. A local green check is not a CI verdict.

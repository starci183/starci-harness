# Tier 3: CI

CI is the critic. After a green wave ([wave.md](wave.md)) is pushed to main, CI runs the full suite: unit tests with
coverage, e2e, build, Sonar, and the Grammar's plays and DNA measurement. It publishes every package version
not on npm yet as soon as that package's own jobs are green, never waiting for the whole run, so the push that carries a
bumped version is the act of publishing (decision "Coded is usable; publishing is CI's" in
[harness/decisions.md](../harness/decisions.md); [CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20 owns the jobs, which
checks gate each, the refusals, the fallback and the secret). Which suites each
profile's CI runs is `ci` of [policy/quality.yaml](../../policy/quality.yaml); the workflow is
[.github/workflows/ci.yml](../../.github/workflows/ci.yml).

A red CI after a push opens the next fix at once, scoped to the red checks (`starci release ci-status` names them): a
`code` contract from a Supervisor, a lane from Debug, a commit from an app session. It is top priority and blocks nobody:
main, the next push and the next goal keep moving while it runs. Only the actions `requireCi` lists wait for a green CI.

# Tier 3: CI

CI is the critic. After a green wave ([wave.md](wave.md)) is pushed to main, CI runs the full suite: unit tests with
coverage, build, Sonar, and, on a change to `packages/grammar`, the job `grammar proof`: the theme proof, and the Grammar publishes only when it is green; the render proof runs by hand. A newer push cancels the run
still going on main (the new run tests the whole tree); a cancelled run is not green and not red, `starci check ci` reports it `cancelled`. The
workflow [.github/workflows/publish.yml](../../.github/workflows/publish.yml), never cancelled, then publishes every package version
not on npm yet whose own jobs were green, from the tarballs those jobs packed, and moves, tests and publishes the CLI, so the push that carries a
bumped version is the act of publishing: coded is usable, and publishing is CI's ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20 owns the jobs, which
checks gate each, the refusals, the fallback and the secret). A failed publish makes its commit red for `starci check ci`; the next push
publishes whatever is still missing. Which suites each
profile's CI runs is `ci` of [policy/quality.yaml](../../policy/quality.yaml); the workflows are
[.github/workflows/ci.yml](../../.github/workflows/ci.yml) and publish.yml.

A red CI after a push opens the next fix at once, scoped to the red checks (`starci check ci` names them): a
`code` contract from a Supervisor, a lane from Debug, a commit from an app session. It is top priority and blocks nobody:
main, the next push and the next goal keep moving while it runs. Only the actions `requireCi` lists wait for a green CI.

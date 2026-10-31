# UAT: walk a Work flow with `uat run`

A `uat` task walks one flow of the project's Work in a real browser and lands one screenshot per step. The flow, its
accounts and its expectations come from the flow's record (`work/uat-flow@1`), never retyped by hand;
[contexts/project/work.md](../../../contexts/project/work.md) owns the record, its state vocabulary and where a run
lands. The machine is the harness's ([contexts/harness/rules.md](../../../contexts/harness/rules.md) hard rule 8): your script runs through
the harness's uat run verb (section 4) in the image pinned in [ops/uat.yaml](../../../ops/uat.yaml).

## 1. Send the task from the record

```text
starci task send --uat uat.<feature>.<flow>
```

`--workflow`, `--retry-of` and `--launch` work as for any task. A workflow file walks a flow with a task that names
only `uat: uat.<feature>.<flow>` (beside `dependsOn`, `difficulty` and `risk`); its run id is `<workflow>-<task key>`, so a
replan builds the same contract, and `WORK_ROOT_ELSEWHERE` refuses a workflow defined outside the Work root.

- **Work root.** The task is queued in the repository that owns `.starciwork`: the app's own, or the one its
  `hfs.json` names as `"work": {"root": "../<be repository>"}` (relative to that `hfs.json`). So a send from the fe
  repository queues the task, its run and its Work commit in the be repository; file the result and verify there.
  `WORK_ROOT_UNKNOWN`, `WORK_ROOT_MISSING` and `WORK_ROOT_AMBIGUOUS` (the repository holds `.starciwork` and names
  another root) say which binding is wrong.
- **The contract** (`uatContract` in [cli/src/harness/work.ts](../../../cli/src/harness/work.ts)) extends the uat op
  file [ops/ops/uat.md](../../../ops/ops/uat.md): the summary is the record's title; the details carry the entry, the
  actor, the accounts file (named, never its values) and every step with its expectation, its screenshot name
  (`step-01.png` ...) and its check ids; `context.extend` reads the record and the accounts file; `allowPaths` is the
  run folder `<flow>/runs/<runId>`; `output.extend` asks for one `steps` entry per record step; `checks.extend` adds
  nothing: the op's base `uat-flow` takes the record and run from the inputs and judges the walk on the receipt
  `starci uat run` writes ([ops/checks.yaml](../../../ops/checks.yaml)). A retry walks into the run
  folder of the task it retries.
- **Gates at send:** `WORK_RUNS_TRACKED` when git would commit the run folder (raw output stays git-ignored),
  `WORK_EVIDENCE_IGNORED` when git ignores the flow's `evidence.yaml`, `WORK_RECORD_MISSING` and
  `WORK_RECORD_INVALID` for the record itself.

## 2. Write the script

A plain ESM file (`.mjs`) in the run folder that does its work at top level and ends when the work ends:

```js
import { chromium } from "playwright"

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto("http://127.0.0.1:3000/workspace")
await page.screenshot({ path: "step-01.png" })
await page.getByRole("button", { name: "Sign in" }).click()
await page.screenshot({ path: "step-02.png" })
await browser.close()
```

- One screenshot per record step, under the name the contract gives. A relative path lands in the run folder
  (`/evidence`, the working directory); the script's own folder is mounted read-only.
- Keep the script outside the app's source (the app canon forbids test runners in the product).

## 3. The 127.0.0.1 rule

Open the app on `http://127.0.0.1:<port>` (or `localhost`), exactly as on the host, and name each port with
`--forward`. Inside the container the harness listens on 127.0.0.1 for every forwarded port and relays it to the
host, so secure-context cookies (`__Host-`), CSRF origins and OIDC redirect URIs behave as they do there. Never
point the browser at `host.docker.internal` or a LAN address. On a Linux Docker engine the host service must listen
where the Docker gateway reaches it (`0.0.0.0`), since the relay arrives from the bridge.

## 4. Run it

```text
starci uat run <run-folder>/walk.mjs --forward 3000,3001 --out <run-folder>
```

- `--out` is relative to the repository root and is created. `--timeout <seconds>` bounds the run (the default is in
  `ops/uat.yaml`); at the deadline the container is killed and removed.
- `--json` reports the image, the forwards, the files the run wrote, the exit code, the duration and the tail of
  stdout and stderr. Exit 0 is green, 1 is red or refused, 2 is bad usage.
- Before the container starts, the checkout the verb runs in gets what a wave gives the checkout it judges: each install
  it holds takes the project's local `@starci` package sources when the project is in local package mode (`starci deps
  source --local`), so the walk serves the packages the wave judged, never the registry pins; then every workspace package
  its app imports is built or restored from the build cache, the preparation `check run` makes before its typecheck (each
  under the heavy governor). Serve the app from that checkout; an install or a package that cannot be given refuses
  `UAT_APP_SETUP_FAILED`.
- The relay tallies the pages the walk opened (the browser's document requests, redirects aside) into the receipt. When
  every one answered 5xx the walk met no app and is refused `UAT_APP_UNSERVED`: an environment failure, never a finding.
  File the result as it stands; `task result` fails the attempt as the harness's own (`walk-unserved`) and the workflow
  dispatches the task again at the same try.
- A refusal names its cause: `UAT_DOCKER_UNREACHABLE` (no Docker engine; tell the Supervisor), `UAT_SCRIPT_MISSING`,
  `UAT_OUT_OUTSIDE`, `UAT_PREPARE_FAILED`, `UAT_IMAGE_UNVERSIONED`, `UAT_ENV_MISSING`, `UAT_APP_SETUP_FAILED`,
  `UAT_APP_UNSERVED`.

## 5. Credentials and parameters

A flow that signs in needs the test account, and the script must never hold it in a file. The harness passes
named variables from your own shell into the container, by name only: the value never reaches a command line,
the output or the `--json` report, which lists the names.

1. Read the test account file the brief names, on the host, into variables of your own shell. Never echo them.
2. Run the script with `--env` naming them, and the script's own parameters after `--`:

```text
starci uat run flows/sign-in.mjs --env UAT_USER,UAT_PASS --forward 3000 --out <run-folder>
```

   Append `-- --role admin` (anything after `--`) to hand the script its own arguments: it reads them as
   `process.argv.slice(2)`, as if run directly.
3. In the script, read `process.env.UAT_USER` and `process.env.UAT_PASS`, and never log, screenshot or write them.

A name that is not set refuses `UAT_ENV_MISSING` before anything runs; `STARCI_UAT_*` names are the harness's own.

## 6. File the result

Write `report.md` in the run folder (what you walked and saw per step), then the result output the contract's
details spell out: `verdict` plus one entry per step with `order`, `status`, `screenshot` and every check id answered
with what you observed. Dry-replay with `starci task verify <task> --contract <copy>`, then file it with
`starci task result <task> --status done --output @<file>`. A walk that saw the product fail is still filed `done`
with `"verdict": "failed"`: the verify turns red and the record says where it stopped. A step you may not walk (an
owner authorization is missing) is `skipped`, which keeps the verdict from passing.

- **`uat-flow` is red** when a record step has no entry (or two), an entry is not `passed`, a check id is unanswered
  or off its expected value, a screenshot is missing from the run folder, `report.md` is missing, or the verdict
  disagrees with the steps. It reads the run folder in the work tree, since the folder is git-ignored and never in
  the clean checkout.

## 7. What the settle writes

`task verify` writes only the record's `state` and `activity` and appends the run to the flow's `evidence.yaml`
(`work/evidence@1`: run id, task, time, verdict, the failing step and reason when red, and the sha256 of every file
of the run folder). Every write lands in the Work root, which is the task's own repository, so there is never a
commit in a second repository.

| verdict | record | commit |
|---|---|---|
| green | `state: done`, `activity: idle` | inside the task's harness commit |
| red | `activity: blocked`, state kept | a Work commit of its own (`work: <id> blocked at step <n>`), since a red verdict lands no harness commit |

Both move the branch only by compare-and-swap from the HEAD the settle read, under the project's settle lock, and
nothing is pushed. A record or `evidence.yaml` with uncommitted edits is left as it is, and the verify report says so
(`work: ... left as it was`).

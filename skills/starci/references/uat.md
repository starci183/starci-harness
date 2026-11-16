# Walk screens in a browser with `uat run`

An `audit` task ([ops/ops/audit.md](../../../ops/ops/audit.md)) walks the implemented screens in a real browser and lands
one screenshot per screen and state, each held by the run's receipt. The machine is the harness's
([contexts/harness/rules.md](../../../contexts/harness/rules.md) hard rule 8): your script runs through the harness's uat run
verb (section 3) in the image pinned in [ops/uat.yaml](../../../ops/uat.yaml). The run folder is the task's only allowPath.

## 1. Write the script

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

- One screenshot per screen and state, under the name the contract gives. A relative path lands in the run folder
  (`/evidence`, the working directory); the script's own folder is mounted read-only.
- Keep the script outside the app's source (the app canon forbids test runners in the product).

## 2. The 127.0.0.1 rule

Open the app on `http://127.0.0.1:<port>` (or `localhost`), exactly as on the host, and name each port with
`--forward`. Inside the container the harness listens on 127.0.0.1 for every forwarded port and relays it to the
host, so secure-context cookies (`__Host-`), CSRF origins and OIDC redirect URIs behave as they do there. Never
point the browser at `host.docker.internal` or a LAN address. On a Linux Docker engine the host service must listen
where the Docker gateway reaches it (`0.0.0.0`), since the relay arrives from the bridge.

## 3. Run it

```text
starci uat run <run-folder>/walk.mjs --forward 3000,3001 --out <run-folder>
```

- `--out` is relative to the repository root and is created. `--timeout <seconds>` bounds the run (the default is in
  `ops/uat.yaml`); at the deadline the container is killed and removed.
- `--json` reports the image, the forwards, the files the run wrote, the exit code, the duration and the tail of
  stdout and stderr. Exit 0 is green, 1 is red or refused, 2 is bad usage.
- Before the container starts, the checkout the verb runs in gets what a wave gives the checkout it judges: its install,
  the packages its lockfile names; then every workspace package
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

## 4. Credentials and parameters

A walk that signs in needs the test account, and the script must never hold it in a file. The harness passes
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

## 5. File the result

Compare each screenshot with the screen's direction and the grammar, then file the result the audit op asks for
(`verdict`, `findings`, `citeGrades`) with `starci task result <task> --status done --output @<file>`. A walk that saw
the product drift is still filed `done` with `"verdict": "failed"`: the verify turns red and the findings route to code.

# UAT: walk the flows with `uat run`

A `uat` task walks the product's flows in a real browser and lands one screenshot per step as evidence. The
harness owns the machine: it runs your script in the official Playwright image pinned in
[ops/uat.yaml](../../../ops/uat.yaml), with the matching `playwright` package already inside the image. Never install
Playwright or a browser, add it to the product's `package.json`, or run Docker yourself.

## 1. Write the script

A plain ESM file (`.mjs`) that does its work at top level and ends when the work ends:

```js
import { chromium } from "playwright"

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto("http://127.0.0.1:3000/")
await page.screenshot({ path: "01-home.png" })
await page.getByRole("link", { name: "Sign in" }).click()
await page.screenshot({ path: "02-sign-in.png" })
const title = await page.title()
await browser.close()
if (!title.includes("Dashboard")) throw new Error("the sign-in flow did not reach the dashboard")
```

- One screenshot per step, numbered in walk order. A relative path lands in the evidence folder (`/evidence`, the
  working directory); the script's own folder is mounted read-only.
- A failed expectation throws: the script's exit code is the verdict, 0 green and anything else red.
- Keep the script outside the app's source (the app canon forbids test runners in the product): put it where the
  contract's `allowPaths` say, in a folder that holds only scripts.

## 2. The 127.0.0.1 rule

Open the app on `http://127.0.0.1:<port>` (or `localhost`), exactly as on the host, and name each port with
`--forward`. Inside the container the harness listens on 127.0.0.1 for every forwarded port and relays it to the
host, so secure-context cookies (`__Host-`), CSRF origins and OIDC redirect URIs behave as they do there. Never
point the browser at `host.docker.internal` or a LAN address. On a Linux Docker engine the host service must listen
where the Docker gateway reaches it (`0.0.0.0`), since the relay arrives from the bridge.

## 3. Run it

```text
starci uat run flows/sign-in.mjs --forward 3000,3001 --out uat-evidence/sign-in
```

- `--out` is relative to the repository root and is created; without it the evidence goes to
  `uat-evidence/<container>`. `--timeout-ms` bounds the run (the default is in `ops/uat.yaml`); at the deadline
  the container is killed and removed.
- The first run on a host builds the local run image once (base pull plus the playwright package) and says so.
- `--json` reports the image, the forwards, the evidence folder and the files the run wrote, the exit code, the
  duration and the tail of stdout and stderr. Exit 0 is green, 1 is red or refused, 2 is bad usage.
- A refusal names its cause: `UAT_DOCKER_UNREACHABLE` (no Docker engine; tell the Supervisor), `UAT_SCRIPT_MISSING`,
  `UAT_OUT_OUTSIDE`, `UAT_PREPARE_FAILED`, `UAT_IMAGE_UNVERSIONED`, `UAT_ENV_MISSING`.

## 4. Credentials and parameters

A flow that signs in needs the test account, and the script must never hold it in a file. The harness passes
named variables from your own shell into the container, by name only: the value never reaches a command line,
the output or the `--json` report, which lists the names.

1. Read the test account file the brief names, on the host, into variables of your own shell. Never echo them.
2. Run the script with `--env` naming them, and the script's own parameters after `--`:

```text
starci uat run flows/sign-in.mjs --env UAT_USER,UAT_PASS --forward 3000 --out uat-evidence/sign-in
```

   Append `-- --role admin` (anything after `--`) to hand the script its own arguments: it reads them as
   `process.argv.slice(2)`, as if run directly.
3. In the script, read `process.env.UAT_USER` and `process.env.UAT_PASS`, and never log, screenshot or write them.

A name that is not set refuses `UAT_ENV_MISSING` before anything runs; `STARCI_UAT_*` names are the harness's own.

## 5. File the evidence

Name the evidence folder and each screenshot in your result output, with the verdict of every flow, and file it the
way your brief says. The contract's checks read that record and the files.

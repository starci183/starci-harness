// starci app upgrade: completes an existing FULL app. It adds the test world (scaffold/test-world.mjs) the app lacks, with the world's
// devDependencies at canon pins, and never rewrites a file the app already has. Editions are fixed at scaffold: a lite app is refused
// (HFS_UPGRADE_EDITION_FIXED), there is no lite to full migration.
//
// A dry run returns the exact ordered operations; apply performs those operations and resolves the lockfile once when it added
// dependencies. If that resolution fails, every file touched by this invocation is restored before the refusal is returned.
import fs from "node:fs";
import path from "node:path";
import { remember, ensureParent, writeFile, restore } from "./file-state.mjs";
import { parseYaml } from "../runtime/engine/yaml.mjs";
import { loadSlotManifest } from "../runtime/scripts/hfs/slots.mjs";
import { LOCK_STEP, npmLock } from "../scaffold/app.mjs";
import { WORLD_MARKER, testWorldFiles } from "../scaffold/test-world.mjs";
import { loadHfs } from "../sync/index.mjs";

const PACKAGE_ROOT = path.join(import.meta.dirname, "..");
const PINS_FILE = path.join(
  PACKAGE_ROOT,
  "runtime",
  "knowledge",
  "hfs",
  "canon-pins.yaml",
);
const FULL_DEV_DEPENDENCIES = Object.freeze([
  "@nestjs/testing",
  "@starci/jest-preset",
  "@starci/test-world",
  "@types/jest",
  "jest",
  "ts-jest",
]);
const FULL_DEPENDENCIES = Object.freeze(["nest-commander"]);

export class UpgradeError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fileText = (root, file) =>
  fs
    .readFileSync(path.join(root, ...file.split("/")), "utf8")
    .replace(/\r\n/g, "\n");
const sameText = (root, file, content) =>
  fs.existsSync(path.join(root, ...file.split("/"))) &&
    fileText(root, file) === content.replace(/\r\n/g, "\n");

function readJson(root, file) {
  try {
    return JSON.parse(fileText(root, file));
  } catch (error) {
    throw new UpgradeError(
      "HFS_UPGRADE_INPUT_INVALID",
      `${file} is not valid JSON: ${error.message}`,
    );
  }
}

function pinnedPackage(root, pins) {
  const current = readJson(root, "package.json");
  const section = (name, dependencies) => {
    const next = { ...current[name] };
    for (const dependency of dependencies) {
      const pin = pins[dependency]?.version;
      if (!pin)
        throw new UpgradeError(
          "HFS_UPGRADE_PIN_MISSING",
          `${dependency} has no canon pin in knowledge/hfs/canon-pins.yaml`,
        );
      next[dependency] = pin;
    }
    return Object.fromEntries(
      Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
    );
  };
  return {
    ...current,
    dependencies: section("dependencies", FULL_DEPENDENCIES),
    devDependencies: section("devDependencies", FULL_DEV_DEPENDENCIES),
  };
}

const publicStep = ({ op, path: file, why }) => ({ op, path: file, why });

function additionStep(root, file) {
  const target = path.join(root, ...file.path.split("/"));
  if (!fs.existsSync(target)) return { op: "add", path: file.path, why: "Open the full test layer without inventing a spec.", content: file.content, kind: "file" };
  if (!sameText(root, file.path, file.content)) throw new UpgradeError(
    "HFS_UPGRADE_FILE_CONFLICT",
    `${file.path} already exists and is not the upgrade scaffold; no file was overwritten`,
  );
  return null;
}

/**
 * The steps that complete an existing full app: every test world file it lacks when it has no world (an existing file that is not
 * the scaffold's refuses, nothing is overwritten) and the full test toolchain devDependencies it lacks, at canon pins.
 */
function fullCompletion(root, declaration) {
  const steps = [];
  if (!fs.existsSync(path.join(root, ...WORLD_MARKER.split("/")))) {
    for (const file of testWorldFiles(declaration)) {
      const step = additionStep(root, file);
      if (step) steps.push({ ...step, why: "Add the full test world and its baseline integration and e2e specs." });
    }
  }
  const current = readJson(root, "package.json");
  const missing = FULL_DEV_DEPENDENCIES.filter(
    (name) => current.devDependencies?.[name] === undefined && current.dependencies?.[name] === undefined,
  );
  if (missing.length) {
    const pins = parseYaml(fs.readFileSync(PINS_FILE, "utf8")).pins;
    const added = pinnedPackage(root, pins).devDependencies;
    const devDependencies = Object.fromEntries(
      Object.entries({ ...current.devDependencies, ...Object.fromEntries(missing.map((name) => [name, added[name]])) })
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    steps.push({
      op: "rewrite-managed",
      path: "package.json",
      why: `Add the test world toolchain the full app lacks (${missing.join(", ")}) at canon pins.`,
      content: jsonText({ ...current, devDependencies }),
      kind: "file",
    });
    steps.push({ op: "rewrite-managed", path: "package-lock.json", why: `Resolve the added pinned dependencies with ${LOCK_STEP}.`, kind: "lock" });
  }
  return { managed: [], steps, dependenciesChanged: missing.length > 0 };
}

function model({ root, manifest }) {
  const declaration = loadHfs(root, manifest);
  if (declaration?.edition === "lite")
    throw new UpgradeError(
      "HFS_UPGRADE_EDITION_FIXED",
      "editions are fixed at scaffold: a lite app stays lite and a full app stays full; there is no lite to full upgrade",
    );
  return fullCompletion(root, declaration);
}

/**
 * Plans or applies the completion of a full app. Returns the ordered public plan (`{op,path,why}[]`) in both modes.
 * `lock` is the test seam for the npm lock resolution.
 */
async function upgradeEdition({
  root,
  plan = false,
  manifest = loadSlotManifest(),
  lock = npmLock,
}) {
  const repoRoot = path.resolve(root);
  const built = model({ root: repoRoot, manifest });
  const result = built.steps.map(publicStep);
  if (plan) return result;
  const snapshot = new Map();
  const directories = [];
  try {
    for (const step of built.steps) {
      if (step.kind === "lock") continue;
      writeFile(repoRoot, step.path, step.content, snapshot, directories);
    }
    if (built.dependenciesChanged) {
      const lockFile = path.join(repoRoot, "package-lock.json");
      remember(snapshot, lockFile);
      const locked = lock(repoRoot);
      if (!locked.ok)
        throw new UpgradeError(
          "HFS_UPGRADE_LOCK_FAILED",
          `\`${LOCK_STEP}\` could not resolve the upgraded lockfile (${locked.detail}); the app was restored`,
        );
    }
  } catch (error) {
    restore(snapshot, directories);
    throw error;
  }
  return result;
}

function upgradeArguments(argv) {
  let plan = false;
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      if (argv[index + 1] === undefined)
        throw new UpgradeError("HFS_UPGRADE_USAGE", `${arg} needs a value`);
      root = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--plan") plan = true;
    else if (arg === "--edition")
      throw new UpgradeError("HFS_UPGRADE_USAGE", "upgrade takes no --edition: editions are fixed at scaffold");
    else throw new UpgradeError("HFS_UPGRADE_USAGE", `unknown argument ${arg}`);
  }
  return { root, plan };
}

/** CLI adapter kept outside the CLI entry so that verb wiring remains one line. */
export async function upgradeMain(argv, { stdout = (value) => process.stdout.write(value) } = {}) {
  const { root, plan } = upgradeArguments(argv);
  const steps = await upgradeEdition({ root, plan });
  for (const step of steps) stdout(`${step.op} ${step.path}: ${step.why}
`);
  stdout(
    `starci app upgrade${plan ? " --plan" : ""}: ${steps.length} step${steps.length === 1 ? "" : "s"} ${plan ? "planned; no file written" : "applied"}${steps.length === 0 ? " (the full app is complete)" : ""}
`,
  );
  return 0;
}

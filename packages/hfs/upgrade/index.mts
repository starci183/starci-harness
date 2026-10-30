// starci app upgrade: completes an existing FULL app. It adds the test world (scaffold/test-world.mjs) the app lacks, with the world's
// devDependencies at canon pins, and never rewrites a file the app already has. Editions are fixed at scaffold: a lite app is refused
// (HFS_UPGRADE_EDITION_FIXED), there is no lite to full migration.
//
// A dry run returns the exact ordered operations; apply performs those operations and resolves the lockfile once when it added
// dependencies. If that resolution fails, every file touched by this invocation is restored before the refusal is returned.
import fs from "node:fs";
import path from "node:path";
import { remember, writeFile, restore } from "./file-state.mjs";
import { bundledPins } from "../runtime/scripts/hfs/canon-pins.mjs";
import { loadSlotManifest } from "../runtime/scripts/hfs/slots.mjs";
import { LOCK_STEP, npmLock } from "../scaffold/app.mjs";
import { WORLD_MARKER, testWorldFiles } from "../scaffold/test-world.mjs";
import { loadHfs } from "../sync/index.mjs";
import type { SlotManifest } from "../sync/index.mjs";
import type { Snapshot } from "./file-state.mjs";

// reason: package.json and hfs.json are JSON parsed from disk; the upgrade reads only the fields it names
type Json = any;
/** One operation of the plan: what it does, to which file, and why (content is the file text of a file step). */
interface Step { op: string; path: string; why: string; content?: string; kind: "file" | "lock" }

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
  code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const fileText = (root: string, file: string): string =>
  fs
    .readFileSync(path.join(root, ...file.split("/")), "utf8")
    .replace(/\r\n/g, "\n");
const sameText = (root: string, file: string, content: string): boolean =>
  fs.existsSync(path.join(root, ...file.split("/"))) &&
    fileText(root, file) === content.replace(/\r\n/g, "\n");

function readJson(root: string, file: string): Json {
  try {
    return JSON.parse(fileText(root, file));
  } catch (error) {
    throw new UpgradeError(
      "HFS_UPGRADE_INPUT_INVALID",
      `${file} is not valid JSON: ${(error as Error).message}`,
    );
  }
}

function pinnedPackage(root: string, pins: Record<string, { version?: string } | undefined>): Json {
  const current = readJson(root, "package.json");
  const section = (name: string, dependencies: readonly string[]): Record<string, string> => {
    const next: Record<string, string> = { ...current[name] };
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

const publicStep = ({ op, path: file, why }: Step): { op: string; path: string; why: string } => ({ op, path: file, why });

function additionStep(root: string, file: { path: string; content: string }): Step | null {
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
function fullCompletion(root: string, declaration: Json): { managed: never[]; steps: Step[]; dependenciesChanged: boolean } {
  const steps: Step[] = [];
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
    const pins = bundledPins();
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

function model({ root, manifest }: { root: string; manifest: SlotManifest }): ReturnType<typeof fullCompletion> {
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
  manifest = loadSlotManifest() as SlotManifest,
  lock = npmLock as (root: string) => { ok: boolean; detail?: string },
}: { root: string; plan?: boolean; manifest?: SlotManifest; lock?: (root: string) => { ok: boolean; detail?: string } }): Promise<{ op: string; path: string; why: string }[]> {
  const repoRoot = path.resolve(root);
  const built = model({ root: repoRoot, manifest });
  const result = built.steps.map(publicStep);
  if (plan) return result;
  const snapshot: Snapshot = new Map();
  const directories: string[] = [];
  try {
    for (const step of built.steps) {
      if (step.kind === "lock") continue;
      writeFile(repoRoot, step.path, step.content as string, snapshot, directories);
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

/** The arguments of `starci app upgrade`: --plan, and --repo from the CLI entry; --edition is refused (editions are fixed at scaffold). */
export function upgradeArguments(argv: readonly string[]): { root: string; plan: boolean } {
  let plan = false;
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--repo") {
      if (argv[index + 1] === undefined || (argv[index + 1] as string).startsWith("--"))
        throw new UpgradeError("HFS_UPGRADE_USAGE", `${arg} needs a value`);
      root = path.resolve(argv[index + 1] as string);
      index += 1;
    } else if (arg === "--plan") plan = true;
    else if (arg === "--edition" || arg.startsWith("--edition="))
      throw new UpgradeError("HFS_UPGRADE_USAGE", "upgrade takes no --edition: editions are fixed at scaffold");
    else throw new UpgradeError("HFS_UPGRADE_USAGE", `unknown argument ${arg}`);
  }
  return { root, plan };
}

/** CLI adapter kept outside the CLI entry so that verb wiring remains one line. */
export async function upgradeMain(argv: string[], { stdout = (value: string): unknown => process.stdout.write(value) }: { stdout?: (text: string) => unknown } = {}): Promise<number> {
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

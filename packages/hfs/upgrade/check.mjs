// The edition selector of `starci app check --edition <edition>`. Editions are fixed at scaffold: the selector names the edition hfs.json
// declares or the check refuses. There is no preview of a lite app as a full one.
import { loadSlotManifest } from "../runtime/scripts/hfs/slots.mjs";
import { loadHfs } from "../sync/index.mjs";
import { UpgradeError } from "./index.mjs";

/** Runs the normal check when the requested edition is the declared one; any other edition is a usage refusal. `normal` is the CLI's ordinary check closure. */
export async function checkEdition({ repoRoot, edition, normal, manifest = loadSlotManifest() }) {
  if (edition === undefined) return normal();
  if (!["full", "lite"].includes(edition))
    throw new UpgradeError("HFS_EDITION_INVALID", `--edition is ${JSON.stringify(edition)}; expected full or lite`);
  const actual = loadHfs(repoRoot, manifest).edition ?? "full";
  if (edition !== actual)
    throw new UpgradeError("HFS_EDITION_INVALID", `hfs.json edition is ${actual}; editions are fixed at scaffold, so check judges only the declared edition`);
  return normal();
}

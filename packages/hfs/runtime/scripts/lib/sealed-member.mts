// sealed-member.mjs - the file names of an app's sealed members (ruling app-secrets-one-standard): a member is
// `.starcistacks/<env>/secrets/<member>.enc.yaml`, a sops YAML document of one provider's keys; a legacy member is
// `<member>.enc`, a sops dotenv document, read until `starci app secret migrate` moves it. Every reader of the secrets
// folder names, lists and resolves members through this module.
import fs from 'node:fs';
import path from 'node:path';

/** The suffix of a member, and of a legacy one. */
export const MEMBER_SUFFIX = '.enc.yaml';
export const LEGACY_SUFFIX = '.enc';

/** A sealed member's file name (either suffix), as a pattern for a name or the tail of a path. */
export const SEALED_NAME = /\.enc(?:\.yaml)?$/u;

/** True for the file name of a sealed member, current or legacy. */
export const isSealedName = (name: string): boolean => SEALED_NAME.test(name);

/** True for the file name of a legacy (dotenv `.enc`) member. */
export const isLegacyName = (name: string): boolean => name.endsWith(LEGACY_SUFFIX);

/** The member a sealed file name holds (`sepay.enc.yaml` and `sepay.enc` are both `sepay`). */
export const memberOfName = (name: string): string => name.replace(SEALED_NAME, '');

/**
 * The file of member `slug` in `directory`: the existing `.enc.yaml`, else the existing legacy `.enc`, else the `.enc.yaml` a new
 * member is created as. Both present is refused: one member has one file.
 */
export function memberFile(directory: string, slug: string): string {
  const current = path.join(directory, `${slug}${MEMBER_SUFFIX}`);
  const legacy = path.join(directory, `${slug}${LEGACY_SUFFIX}`);
  const hasCurrent = fs.existsSync(current);
  if (hasCurrent && fs.existsSync(legacy))
    throw new Error(`${slug} is sealed twice (${slug}${MEMBER_SUFFIX} and ${slug}${LEGACY_SUFFIX}); remove the one migrate replaced`);
  if (hasCurrent) return current;
  return fs.existsSync(legacy) ? legacy : current;
}

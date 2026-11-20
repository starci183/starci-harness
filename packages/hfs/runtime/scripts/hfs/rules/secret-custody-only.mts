// secret-custody-only.mts - R277: the only custody a tracked secret may take is a sops envelope at
// `.starcistacks/<env>/secrets/**.enc`. Everything else is refused:
//   - a tracked plaintext secret file by being (`secrets.env`, a non-dot `*.env` with secret keys, a member of
//     a `secrets/` directory, deploy-side dotenv) - HFS_SECRET_PLAINTEXT_FILE;
//   - an `.enc` outside the sealed home is HFS_LITE_SECRET_CUSTODY (R220), never a second code here.
// One more custody: a business package may commit its provider keys as `packages/<pkg>/secrets/<name>.sops.yaml`, but only as a valid sops
// document: every leaf `ENC[...]`, a `sops` block with age recipients, and those recipients equal to the ones the package's own `.sops.yaml` names for
// that path (HFS_PACKAGE_SECRET_NOT_SEALED, HFS_PACKAGE_SECRET_RECIPIENT). Plaintext, `.env` and `*.secrets.env` stay refused.
// Dotfile `.env*`, `.secrets/` and `.starcistacks/<env>/secrets/` plaintext are already refused by R06's
// FORBIDDEN_FILES; this rule refuses the names R06's path list does not name. A finding never carries a value.
import path from 'node:path';
import { parseYaml } from '../../../engine/yaml.mjs';
import { secretHits, secretNameLike } from '../../lib/secret-patterns.mjs';
import { isSopsEnvelope } from '../../lib/sops-envelope.mjs';
import { found, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const PLAINTEXT_FILE = 'HFS_SECRET_PLAINTEXT_FILE';
const PACKAGE_NOT_SEALED = 'HFS_PACKAGE_SECRET_NOT_SEALED';
const PACKAGE_RECIPIENT = 'HFS_PACKAGE_SECRET_RECIPIENT';

// `secrets.env` at any depth, plus `.secret.env`/`.secrets.env` - a dotenv file named for what it holds.
const SECRET_ENV = /(?:^|\/)\.?secrets?\.env$/i;
// A non-dot `<name>.env` or `<name>.env.<profile>` tracked file (deploy/prod.env, config.env.local); the
// documented example/template suffixes are shareable forms, not custody.
const ENV_FILE = /(?:^|\/)[^/.][^/]*\.env(?:\.(?!example|sample|template)[^/]*)?$/i;
// A plaintext secret store: `secrets/<name>.yaml` and friends - except under `.starcistacks/<env>/secrets/`,
// which R06 already judges, and the sealed `.enc` members, which are custody.
const SECRETS_DIR = /(?:^|\/)secrets\/[^/]+\.(?:ya?ml|env|json|conf|cfg|ini|toml|txt|properties)$/i;
// `packages/<pkg>/secrets/<name>.sops.yaml` (or .yml): the one sealed package-secret file shape.
const PACKAGE_SEALED = /^packages\/([^/]+)\/secrets\/[^/]+\.sops\.ya?ml$/i;
const SEALED_DIR = /^\.starcistacks\/[^/]+\/secrets\//;

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_$][\w$]*)\s*=/;
const hasSecretKeys = (file: string, text: string) =>
  text.split(/\r?\n/).some((line: string) => {
    const key = KEY_LINE.exec(line);
    return (key && secretNameLike(key[1] as string)) || secretHits(file, line).length > 0;
  });


const byText = (a: string, b: string) => a.localeCompare(b);
const asList = (value: unknown): string[] => {
  let items: unknown[] = [];
  if (typeof value === 'string') items = value.split(',');
  else if (Array.isArray(value)) items = value;
  return items.map((item) => String(item).trim()).filter(Boolean);
};

/** The age recipients a document's `sops` block names, sorted; [] when there is none. */
const envelopeRecipients = (text: string): string[] => {
  try {
    const age = (parseYaml(text) as { sops?: { age?: unknown } } | null)?.sops?.age;
    return Array.isArray(age) ? age.map((entry: { recipient?: unknown } | null) => entry?.recipient).filter((r): r is string => typeof r === 'string' && r !== '').sort(byText) : [];
  } catch {
    return [];
  }
};

type CreationRule = { path_regex?: string; age?: unknown; key_groups?: { age?: unknown }[] };

/** The age recipients the package's `.sops.yaml` assigns to `rel` (the path relative to the package), sorted; null when no rule matches or the file is absent. */
const configRecipients = (text: string, rel: string): string[] | null => {
  let rules: CreationRule[] | undefined;
  try { rules = (parseYaml(text) as { creation_rules?: CreationRule[] } | null)?.creation_rules; } catch { return null; }
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    try {
      if (rule?.path_regex && !new RegExp(rule.path_regex).test(rel)) continue;
    } catch { continue; }
    const groups = Array.isArray(rule?.key_groups) ? rule.key_groups.flatMap((group) => asList(group?.age)) : [];
    return [...new Set([...asList(rule?.age), ...groups])].sort(byText);
  }
  return null;
};

/** The findings for one sealed package secret: not sealed, no recipients, or recipients that differ from the package's `.sops.yaml`. */
const packageSealedFindings = (file: string, posix: string, pkg: string, repoRoot: string) => {
  const text = readText(repoRoot, file);
  if (text === null || !isSopsEnvelope(text))
    return [found(PACKAGE_NOT_SEALED, file, `${file} is a package secret that is not a valid sops document (every value must be ENC[...] with a sops block); seal it with sops, never commit the plaintext`)];
  const have = envelopeRecipients(text);
  if (have.length === 0)
    return [found(PACKAGE_RECIPIENT, file, `${file} has no age recipient in its sops block; seal it to the package's age recipient from packages/${pkg}/.sops.yaml`)];
  const configText = readText(repoRoot, `packages/${pkg}/.sops.yaml`);
  const want = configText === null ? null : configRecipients(configText, path.posix.relative(`packages/${pkg}`, posix));
  if (want === null || want.length === 0)
    return [found(PACKAGE_RECIPIENT, file, `${file} has no age recipient to match: packages/${pkg}/.sops.yaml is missing or has no creation rule with an age recipient for it`)];
  if (have.length !== want.length || have.some((recipient, index) => recipient !== want[index]))
    return [found(PACKAGE_RECIPIENT, file, `${file} is sealed to different age recipients than packages/${pkg}/.sops.yaml names; re-seal it (sops updatekeys) to the package's recipients`)];
  return [];
};

export function secretCustodyOnlyFindings({ repoRoot, files, inScope }: { repoRoot: string; files: string[]; repo: Repo; inScope: (file: string) => boolean }) {
  const findings = [];
  for (const file of files.filter((f: Parsed) => !inScope || inScope(f))) {
    const posix = file.replaceAll('\\', '/');
    // A sealed envelope outside its home is HFS_LITE_SECRET_CUSTODY (R220).
    if (/\.enc(?:\.yaml)?$/.test(file)) continue;
    if (SEALED_DIR.test(posix)) continue;
    const sealedPackage = PACKAGE_SEALED.exec(posix);
    if (sealedPackage) {
      findings.push(...packageSealedFindings(file, posix, sealedPackage[1] as string, repoRoot));
      continue;
    }
    if (SECRET_ENV.test(posix)) {
      findings.push(found(PLAINTEXT_FILE, file,
        `${file} is a tracked plaintext secrets dotenv; seal secrets with starci app secret set --env <env> into .starcistacks/<env>/secrets/<slug>.enc - never commit the plaintext`));
      continue;
    }
    if (SECRETS_DIR.test(posix)) {
      findings.push(found(PLAINTEXT_FILE, file,
        `${file} is a tracked plaintext file inside a secrets/ directory; seal secrets with sops into .starcistacks/<env>/secrets/<slug>.enc - never commit the plaintext`));
      continue;
    }
    if (!ENV_FILE.test(posix)) continue;
    const text = readText(repoRoot, file);
    if (text === null || !hasSecretKeys(file, text)) continue;
    findings.push(found(PLAINTEXT_FILE, file,
      `${file} is a tracked dotenv file holding secret keys; seal secrets with sops into .starcistacks/<env>/secrets/<slug>.enc - never commit the plaintext`));
  }
  return findings;
}

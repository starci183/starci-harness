// release-version.mjs - the one reading of a release version (owner ruling release-waves). A prerelease `<label>.N` opens the release
// line N and `<label>.N.M` is the M-th release after it, a wave or a fix alike, so alpha.31 < alpha.31.1 < alpha.31.2 < alpha.32 in
// SemVer order. The next release is derived from the highest one already released, never guessed. The legacy `<label>.N-fix.K` still
// reads as release K after `<label>.N` and is never produced again. Pure: the callers read the tags and the registry.

const NUMERIC = /^(?:0|[1-9]\d*)$/;
const POSITIVE = /^[1-9]\d*$/;
const IDENTIFIERS = /^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/;
const LEGACY_FIX = '-fix.';

/** {base, wave, legacy}: the release a version counts its waves from, and its wave M (0 for the release that opens the line). */
export function waveOf(version) {
  const text = String(version ?? '').split('+')[0];
  const fix = text.lastIndexOf(LEGACY_FIX);
  const legacyWave = fix > 0 ? text.slice(fix + LEGACY_FIX.length) : '';
  if (POSITIVE.test(legacyWave)) return { base: text.slice(0, fix), wave: Number(legacyWave), legacy: true };
  const ids = text.split('.');
  const counted = ids.length > 3 && POSITIVE.test(ids.at(-1)) && (text.includes('-') ? NUMERIC.test(ids.at(-2)) : ids.length === 4);
  return counted ? { base: ids.slice(0, -1).join('.'), wave: Number(ids.at(-1)), legacy: false } : { base: text, wave: 0, legacy: false };
}

/** Parsed SemVer identifiers {core, pre} of `version`; an unreadable version throws. */
export function versionParts(version) {
  const parts = typeof version === 'string' ? version.split('+') : [];
  if (!parts.length || parts.length > 2 || (parts.length === 2 && !IDENTIFIERS.test(parts[1]))) throw new Error(`unreadable release version ${version}`);
  const boundary = parts[0].indexOf('-');
  const core = (boundary < 0 ? parts[0] : parts[0].slice(0, boundary)).split('.');
  const prerelease = boundary < 0 ? null : parts[0].slice(boundary + 1);
  if (core.length !== 3 || core.some((part) => !NUMERIC.test(part)) || (prerelease !== null && !IDENTIFIERS.test(prerelease))) throw new Error(`unreadable release version ${version}`);
  const pre = prerelease?.split('.') ?? [];
  if (pre.some((part) => /^0\d+$/.test(part))) throw new Error(`invalid numeric prerelease identifier in ${version}`);
  return { core: core.map(BigInt), pre };
}

const readable = (version) => {
  try {
    versionParts(version);
    return true;
  } catch {
    return false;
  }
};

/** The SemVer spelling a version is ordered by: a legacy `-fix.K` orders as wave K of its line. */
const ordered = (version) => {
  const { base, wave, legacy } = waveOf(version);
  return legacy ? `${base}.${wave}` : version;
};

const compareIdentifier = (a, b) => {
  const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b);
  if (numericA && numericB) return BigInt(a) < BigInt(b) ? -1 : Number(BigInt(a) > BigInt(b));
  if (numericA !== numericB) return numericA ? -1 : 1;
  return a < b ? -1 : Number(a > b);
};

/** SemVer precedence, numeric prerelease identifiers included; build metadata has no precedence. */
export function compareVersions(a, b) {
  const left = versionParts(ordered(a)), right = versionParts(ordered(b));
  for (const i of left.core.keys()) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  if (!left.pre.length || !right.pre.length) return Number(!left.pre.length) - Number(!right.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const compared = compareIdentifier(left.pre[i], right.pre[i]);
    if (compared) return compared;
  }
  return 0;
}

/** The release line of `version`: a prerelease's core and the identifiers before its first number (every alpha.N and alpha.N.M share one), a stable release's major and minor. */
export function releaseLine(version) {
  const { core, pre } = versionParts(ordered(version));
  if (!pre.length) return `${core.slice(0, 2).join('.')}-stable`;
  const first = pre.findIndex((id) => /^\d+$/.test(id));
  return `${core.join('.')}-${(first < 0 ? pre : pre.slice(0, first)).join('.')}`;
}

/** {family, line} of a release that opens a line (`<x.y.z>-<label>.N`), or null for any other shape. */
function lineStart(base) {
  if (!readable(base)) return null;
  const { core, pre } = versionParts(base);
  return pre.length === 2 && !/^\d+$/.test(pre[0]) && NUMERIC.test(pre[1]) ? { family: `${core.join('.')}-${pre[0]}`, line: Number(pre[1]) } : null;
}

/** The next wave after `version`: its base with M one past the highest wave of that base among `version` and `known`. */
export function nextWave(version, known = []) {
  const { base } = waveOf(version);
  const waves = [version, ...known].map(waveOf).filter((entry) => entry.base === base).map((entry) => entry.wave);
  return `${base}.${Math.max(0, ...waves) + 1}`;
}

/** The family of a version: its core and label up to `-<label>` (`1.0.0-alpha`), or null for a stable or unlabelled version. */
export function familyOf(version) {
  if (!readable(version)) return null;
  const { core, pre } = versionParts(ordered(version));
  return pre.length && !/^\d+$/.test(pre[0]) ? `${core.join('.')}-${pre[0]}` : null;
}

/**
 * What may follow the highest line-shaped release of `versions`: {highest, family, wave, line}, or null when none has that shape.
 * With a `candidate`, a family that already has released tags is judged alone (another family's tags, such as legacy 2.0.1-alpha.N,
 * never outrank the candidate's own line); a family without a tag falls back to the highest release overall.
 */
export function nextReleases(versions, candidate = null) {
  const shaped = versions.filter((version) => readable(version) && lineStart(waveOf(version).base));
  const family = candidate === null ? null : familyOf(candidate);
  const own = family === null ? [] : shaped.filter((version) => lineStart(waveOf(version).base).family === family);
  const pool = own.length ? own : shaped;
  if (!pool.length) return null;
  const highest = pool.reduce((top, version) => (compareVersions(version, top) > 0 ? version : top));
  const start = lineStart(waveOf(highest).base);
  return { highest, family: start.family, wave: nextWave(highest, pool), line: `${start.family}.${start.line + 1}` };
}

/**
 * Why `version` cannot be released after `released` (the versions already tagged), or null when it can: the next wave of the highest
 * release of its own family, the first release of the next line, or (when its family has no tag) a later release of another label or
 * core than the highest. The legacy `-fix` form is always refused.
 */
export function releaseVersionRefusal(version, released) {
  const next = nextReleases(released.filter((entry) => entry !== version), version);
  const named = next ? `; the next release is ${next.wave} (the next wave or fix after ${next.highest}) or ${next.line} (the next line)` : '';
  if (waveOf(version).legacy) return `${version} is the legacy -fix form, which is read and never released again${named}`;
  if (!next || version === next.wave || version === next.line) return null;
  if (!readable(version)) return `${version} is not a SemVer version${named}`;
  if (lineStart(waveOf(version).base)?.family !== next.family && compareVersions(version, next.highest) > 0) return null;
  return `${version} does not follow ${next.highest}${named}`;
}

/** The versions of the release tags `v<version>` in the output of `git tag --list`. */
export const taggedVersions = (listing) => String(listing ?? '').split(/\r?\n/).map((name) => name.trim()).filter((name) => /^v\d/.test(name)).map((name) => name.slice(1));

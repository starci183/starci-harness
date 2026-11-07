// pin-range.mts - the one judge of whether a declared version meets a pin (decision grammar-patch-range). A pin is exact (`0.21.38`), or,
// for the Grammar family alone, a same-minor range (`~0.21.38`: at least 0.21.38 and below 0.22.0). A declared version meets an exact pin
// when it is that version, and a range when it is an exact version of the same major and minor at or above the floor. A pre-release
// (`0.21.39-beta.1`) never meets a range unless the range itself names a pre-release of that same version (`~0.21.39-beta.0`), the
// npm semantics of `~`, so a pre-release reaches an app only when a pin asks for it. A declared range or tag (`^0.21.0`, `latest`)
// meets nothing: an app pins exact versions.

/** A parsed version: major, minor, patch and the pre-release identifiers (empty for a release). */
interface Parsed { major: number; minor: number; patch: number; pre: string[] }

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

/** The parts of an exact version, or null when `text` is none. */
export function parseVersion(text: string): Parsed | null {
  const match = VERSION.exec(text.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] === undefined ? [] : match[4].split('.') };
}

/** True when `pin` is a same-minor range (`~x.y.z`), not an exact version. */
export const isRangePin = (pin: string): boolean => pin.trim().startsWith('~') && parseVersion(pin.trim().slice(1)) !== null;

/** The exact version a pin starts at: the version itself, or a range's floor (what a scaffold writes). */
export const pinFloor = (pin: string): string => (isRangePin(pin) ? pin.trim().slice(1) : pin.trim());

/** Compares two pre-release lists by the semver rule: numeric identifiers numerically, a release above any pre-release. */
function comparePre(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return (a.length === 0 ? 1 : 0) - (b.length === 0 ? 1 : 0);
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const x = a[at], y = b[at];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/u.test(x), ny = /^\d+$/u.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True when the declared version `declared` meets `pin` (exact or a same-minor range). */
export function meetsPin(pin: string, declared: string): boolean {
  if (!isRangePin(pin)) return declared.trim() === pin.trim();
  const floor = parseVersion(pinFloor(pin));
  const found = parseVersion(declared);
  if (floor === null || found === null || found.major !== floor.major || found.minor !== floor.minor) return false;
  if (found.pre.length > 0) {
    // A pre-release meets only a range whose floor is a pre-release of the same version.
    if (floor.pre.length === 0 || found.patch !== floor.patch) return false;
    return comparePre(found.pre, floor.pre) >= 0;
  }
  return found.patch >= floor.patch;
}

/** Why `declared` misses `pin`, in one phrase, or null when it meets it. */
export function pinMiss(pin: string, declared: string): string | null {
  if (meetsPin(pin, declared)) return null;
  if (!isRangePin(pin)) return `declared ${declared}, pinned ${pin}`;
  const found = parseVersion(declared);
  if (found === null) return `declared ${declared}, pinned the range ${pin}: an app pins an exact version inside it`;
  if (found.pre.length > 0) return `declared the pre-release ${declared}, pinned the range ${pin}: a pre-release meets a range only when the range names one`;
  return `declared ${declared}, pinned the range ${pin} (at least ${pinFloor(pin)}, below the next minor)`;
}

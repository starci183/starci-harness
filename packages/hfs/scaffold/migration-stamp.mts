import { ScaffoldError } from "./service.mjs";

/** How far ahead of the clock the latest migration may be before the clock counts as behind (a collision, not a wrong clock). */
const CLOCK_SKEW_SECONDS = 5;

const STAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u;

const secondsOf = (stamp: string): number | null => {
  const parts = STAMP.exec(stamp);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second) / 1000;
};

const stampOfSeconds = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().replace(/\D/gu, "").slice(0, 14);

/**
 * The UTC timestamp (YYYYMMDDHHMMSS) of the next migration: the clock's second, strictly later than the latest migration.
 * Two migrations written within one second (the scaffold of an app followed at once by `add table`) would collide, so the
 * stamp then moves to the second after the latest; a latest more than a few seconds ahead of the clock is a clock that is
 * really behind, and is refused (HFS_ADD_MIGRATION_ORDER).
 *
 * @param now - The clock, in milliseconds.
 * @param latest - The timestamp of the latest migration of the folder, if any.
 * @returns The 14-digit stamp for the new migration.
 */
export const nextMigrationStamp = (now: () => number, latest: string | undefined): string => {
  const stamp = stampOfSeconds(Math.floor(now() / 1000));
  if (!latest || stamp > latest) return stamp;
  const ahead = secondsOf(latest);
  const current = secondsOf(stamp);
  if (ahead === null || current === null || ahead - current > CLOCK_SKEW_SECONDS)
    throw new ScaffoldError(
      "HFS_ADD_MIGRATION_ORDER",
      `the current UTC timestamp ${stamp} is not later than the latest migration ${latest}; fix the clock or wait for the next second`,
    );
  return stampOfSeconds(ahead + 1);
};

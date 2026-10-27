/**
 * Sonar `sonar.exclusions`: specs, e2e specs, dist and coverage output are not analysed at all. A plain list with no require, so
 * @starci/hfs ships the built file (packages/hfs/runtime, scripts/hfs/sync-runtime.mjs) and `starci app scaffold` renders
 * the same exclusions before any app dependency is installed.
 */
const SONAR_EXCLUSIONS: readonly string[] = Object.freeze(["**/*.spec.ts", "**/*.e2e-spec.ts", "**/dist/**", "**/coverage/**"])

export = SONAR_EXCLUSIONS

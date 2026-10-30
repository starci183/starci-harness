/**
 * Sonar `sonar.exclusions`: specs, e2e specs, dist and coverage output are not analysed at all. A plain list with no require, so
 * @starci/hfs ships the built sonar-exclusions.cjs (packages/hfs/runtime) and `starci app scaffold` renders the same exclusions
 * before any app dependency is installed.
 */
module.exports = Object.freeze(["**/*.spec.ts", "**/*.e2e-spec.ts", "**/dist/**", "**/coverage/**"])

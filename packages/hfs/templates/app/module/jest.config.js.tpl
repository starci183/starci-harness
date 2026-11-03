/** Unit run of the {{pascal}} module package: the logic of its template and manifest is measured at 100 per file. */
module.exports = {
    testEnvironment: "node",
    transform: { "^.+\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json", isolatedModules: true }] },
    testMatch: ["<rootDir>/src/**/*.spec.ts"],
    collectCoverageFrom: ["src/manifest/**/*.ts", "src/template/**/*.ts", "!src/**/*.spec.ts", "!src/**/index.ts"],
    coverageThreshold: { "./src/manifest/**/*.ts": { lines: 100, branches: 100, functions: 100, statements: 100 }, "./src/template/**/*.ts": { lines: 100, branches: 100, functions: 100, statements: 100 } },
}

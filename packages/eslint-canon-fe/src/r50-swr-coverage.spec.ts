// proves: FE_SWR_KEY_IDENTITY@lite
// proves: FE_SWR_KEY_IDENTITY@full
// proves: FE_SWR_MUTATION_RESOURCE_IDENTITY@lite
// proves: FE_SWR_MUTATION_RESOURCE_IDENTITY@full
import test from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import { canonTester } from "../fixtures/typed/tester.ts"
import type { Rule } from "./lib/rule.ts"

/** The project rule published under `name`; a missing one fails the spec. */
const projectRule = (name: string): Rule => {
  const found = rules[name]
  if (!found) throw new Error(`project-graph publishes no rule ${name}`)
  return found
}

const VALID_QUERY = "src/features/project/use-valid-query.ts"
const INVALID_QUERY = "src/features/project/use-invalid-query.ts"
const VALID_MUTATION = "src/features/project/use-valid-mutation.ts"
const INVALID_MUTATION = "src/features/project/use-invalid-mutation.ts"
const PROJECT_IDENTITY = { id: "project", binding: "params.projectId", gatesRequest: true, resource: true }
const VIEWER_IDENTITY = { id: "viewer", binding: "viewer", gatesRequest: false, resource: false }
const lifecycle = {
  schema: "starci/next-data-lifecycle@1",
  swr: { package: "swr", major: 2 },
  hooks: [
    { id: "valid-query", path: VALID_QUERY, export: "useQueryProject", kind: "query", identities: [PROJECT_IDENTITY, VIEWER_IDENTITY] },
    { id: "invalid-query", path: INVALID_QUERY, export: "useQueryProject", kind: "query", identities: [PROJECT_IDENTITY, VIEWER_IDENTITY] },
    { id: "valid-mutation", path: VALID_MUTATION, export: "useMutateProject", kind: "mutation", identities: [PROJECT_IDENTITY] },
    { id: "invalid-mutation", path: INVALID_MUTATION, export: "useMutateProject", kind: "mutation", identities: [PROJECT_IDENTITY] },
  ],
}

const querySource = (key: string): string => `import useSWR from "swr";
export const useQueryProject = (params: { projectId?: string }, viewer: string) => {
  const query = useSWR(${key}, async () => null);
  return { query };
};
`
const mutationSource = (key: string): string => `import useSWRMutation from "swr/mutation";
export const useMutateProject = (params: { projectId?: string }) => {
  const { trigger: add } = useSWRMutation(${key}, async () => null);
  return { add };
};
`
const files = {
  "../package.json": JSON.stringify({
    private: true,
    dependencies: { swr: "^2.3.8" },
    starci: { codePatterns: { next: { schema: "starci/next-code-pattern-contract@1", owners: [], closedVocabularies: [], dataLifecycle: lifecycle } } },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true },
    include: ["src/**/*", "apps/**/*"],
  }),
  "../node_modules/swr/package.json": JSON.stringify({
    name: "swr", version: "2.3.8", types: "./index.d.ts",
    exports: {
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./mutation": { types: "./mutation.d.ts", default: "./mutation.js" },
      "./package.json": "./package.json",
    },
  }),
  "../node_modules/swr/index.d.ts": "export default function useSWR<T = unknown>(key: unknown, fetcher?: unknown): { data: T };\n",
  "../node_modules/swr/mutation.d.ts": "export default function useSWRMutation<T = unknown>(key: unknown, fetcher?: unknown): { data: T; trigger: (arg?: unknown) => Promise<T> };\n",
  "../node_modules/swr/index.js": "export default function useSWR() {}\n",
  "../node_modules/swr/mutation.js": "export default function useSWRMutation() {}\n",
  [VALID_QUERY]: querySource('params.projectId === undefined ? null : ["QUERY_PROJECT", params.projectId, viewer]'),
  [INVALID_QUERY]: querySource('params.projectId === undefined ? null : ["QUERY_PROJECT", params.projectId]'),
  [VALID_MUTATION]: mutationSource('params.projectId === undefined ? null : { operation: "MUTATE_PROJECT", projectId: params.projectId }'),
  [INVALID_MUTATION]: mutationSource('params.projectId === undefined ? null : { operation: "MUTATE_PROJECT" }'),
}

for (const edition of ["lite", "full"] as const) {
  test(`R50 swr-data-lifecycle valid and invalid query and mutation identities (${edition})`, (t) => {
    const fixture = projectFixture({ profile: "fe", edition, files })
    t.after(() => fixture.cleanup())
    canonTester(fixture.tester).run("swr-data-lifecycle", projectRule("swr-data-lifecycle"), {
      valid: [
        { filename: fixture.at(VALID_QUERY), code: files[VALID_QUERY] },
        { filename: fixture.at(VALID_MUTATION), code: files[VALID_MUTATION] },
      ],
      invalid: [
        {
          filename: fixture.at(INVALID_QUERY), code: files[INVALID_QUERY],
          errors: [{ message: /^\[FE_SWR_KEY_IDENTITY\] invalid-query key must include declared identity viewer/ }],
        },
        {
          filename: fixture.at(INVALID_MUTATION), code: files[INVALID_MUTATION],
          errors: [{ message: /^\[FE_SWR_MUTATION_RESOURCE_IDENTITY\]/ }],
        },
      ],
    })
  })
}

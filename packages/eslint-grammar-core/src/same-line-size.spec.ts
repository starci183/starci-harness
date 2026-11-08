/**
 * Twin tests for the same line size law (`FE_SAME_LINE_SIZE`).
 *
 *   node --test src/same-line-size.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, sameLineSize } from "./same-line-size.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Badge, Chip, Cluster, StatusDot, Text } from \"@starci/grammar\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["same-line-size"])
  assert.deepEqual(recommended, { "starci-grammar/same-line-size": "error" })
})

test("FE_SAME_LINE_SIZE: Texts of one Cluster with different sizes are red", () => {
  slotTester().run("same-line-size", sameLineSize, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text isStrong>A</Text><Text>B</Text></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text size=\"md\">A</Text><Text>B</Text></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text size=\"sm\">A</Text><Text size=\"sm\" tone=\"muted\">B</Text></Cluster>" },
      // a Badge, a StatusDot and a Chip are exempt
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text>A</Text><Badge>New</Badge><StatusDot>Live</StatusDot><Chip>x</Chip><Text>B</Text></Cluster>" },
      // a size that is not a literal is skipped
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text>A</Text><Text size={size}>B</Text></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text>A</Text><Text {...rest}>B</Text></Cluster>" },
      // separate lines are separate clusters
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Cluster><Text>A</Text></Cluster><Cluster><Text size=\"sm\">B</Text></Cluster></Cluster>" },
      // a Text with one run
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>Total <Text isStrong>12</Text></Text>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Cluster><Text>A</Text><Text size=\"sm\">B</Text></Cluster>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text>A</Text><Text size=\"sm\">B</Text></Cluster>", errors: [{ messageId: "mixed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text size=\"figure\">12</Text><Text size=\"sm\" tone=\"muted\">runs</Text></Cluster>", errors: [{ messageId: "mixed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text size=\"sm\">A</Text><Badge>New</Badge><Text size=\"xs\">B</Text><Text>C</Text></Cluster>", errors: [{ messageId: "mixed" }, { messageId: "mixed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Text>A</Text>{show && <Text size=\"sm\">B</Text>}</Cluster>", errors: [{ messageId: "mixed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>Total <Text size=\"figure\">12</Text></Text>", errors: [{ messageId: "mixed" }] },
    ],
  })
})

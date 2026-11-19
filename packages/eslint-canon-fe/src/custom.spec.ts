/**
 * The Custom region: no canon front-end law that judges markup, look or libraries reports anything in a Custom subtree, an import
 * whose every use is there, or a same-file helper only Custom renders; code outside it is judged as before.
 *
 *   node --test src/custom.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { rules } from "./index.ts"
import { customOnlyConcern } from "./custom-libraries.ts"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const GRAMMAR = "import { Custom, SurfaceCard } from \"@starci/grammar/core\"\n"
const rule = (name: string) => {
  const found = rules[name]
  assert.ok(found, `${name} is published`)
  return found
}

test("no-arbitrary-value: anything inside Custom, Grammar components included; outside it stays judged", () => {
  assert.doesNotThrow(() => tester.run("no-arbitrary-value", rule("no-arbitrary-value"), {
    valid: [
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <Custom reason=\"graph canvas\"><div className=\"w-[42rem]\"><SurfaceCard className=\"p-[3px]\" /></div></Custom>" },
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <Custom reason=\"art\" className=\"h-[30rem]\" />" },
      { filename: BLOCK, code: GRAMMAR + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.Custom reason=\"art\"><span className=\"p-[3px]\" /></G.Custom>" },
    ],
    invalid: [
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <div className=\"w-[42rem]\" />", errors: [{ messageId: "length" }] },
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <div><Custom reason=\"art\" /><div className=\"w-[42rem]\" /></div>", errors: [{ messageId: "length" }] },
      // a component of the same name that is not the Grammar's opens no region
      { filename: BLOCK, code: "const Custom = (props: { readonly children?: unknown }) => <>{props.children}</>\nexport const A = () => <Custom><div className=\"w-[42rem]\" /></Custom>", errors: [{ messageId: "length" }] },
    ],
  }))
})

test("no-native-img: a raw img inside Custom is allowed", () => {
  assert.doesNotThrow(() => tester.run("no-native-img", rule("no-native-img"), {
    valid: [{ filename: BLOCK, code: GRAMMAR + "export const A = () => <Custom reason=\"art\"><img src=\"/images/a.webp\" alt=\"\" /></Custom>" }],
    invalid: [{ filename: BLOCK, code: GRAMMAR + "export const A = () => <img src=\"/images/a.webp\" alt=\"\" />", errors: [{ messageId: "img" }] }],
  }))
})

test("custom-only-library: a motion or graph library is imported only for use inside Custom", () => {
  assert.doesNotThrow(() => tester.run("custom-only-library", rule("custom-only-library"), {
    valid: [
      // every use inside the region
      { filename: BLOCK, code: GRAMMAR + "import { motion } from \"motion/react\"\nexport const A = () => <Custom reason=\"entrance motion\"><motion.div animate={{ opacity: 1 }} /></Custom>" },
      // a same-file helper only the region renders
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow, useNodesState } from \"@xyflow/react\"\nconst Canvas = () => { const [nodes] = useNodesState([]); return <ReactFlow nodes={nodes} /> }\nexport const A = () => <Custom reason=\"workflow graph\"><Canvas /></Custom>" },
      // a type carries no behaviour
      { filename: BLOCK, code: "import type { Node } from \"@xyflow/react\"\nexport type Item = Node" },
    ],
    invalid: [
      { filename: BLOCK, code: "import { motion } from \"framer-motion\"\nexport const A = () => <motion.div />", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: GRAMMAR + "import { motion } from \"motion/react\"\nexport const A = () => <div><motion.div /><Custom reason=\"x\"><motion.div /></Custom></div>", errors: [{ messageId: "library" }] },
      // the helper is also rendered outside the region
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow } from \"@xyflow/react\"\nconst Canvas = () => <ReactFlow />\nexport const A = () => <><Canvas /><Custom reason=\"x\"><Canvas /></Custom></>", errors: [{ messageId: "library" }] },
      // an exported helper can be rendered by any file
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow } from \"@xyflow/react\"\nexport const Canvas = () => <ReactFlow />\nexport const A = () => <Custom reason=\"x\"><Canvas /></Custom>", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: "import \"motion\"\nexport const A = () => null", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: "export const load = () => import(\"@xyflow/react\")", errors: [{ messageId: "library" }] },
    ],
  }))
})

test("custom-only-library: the packages it names", () => {
  for (const name of ["motion", "motion/react", "motion/mini", "framer-motion", "framer-motion/dom"]) assert.equal(customOnlyConcern(name), "motion", name)
  for (const name of ["@xyflow/react", "@xyflow/react/dist/style.css", "reactflow", "@reactflow/core"]) assert.equal(customOnlyConcern(name), "graph", name)
  for (const name of ["react", "motion-utils-fake", "@heroui/react", "dayjs"]) assert.equal(customOnlyConcern(name), null, name)
})

test("fe-stack-import: a forbidden library used only inside Custom is not judged; used outside it is", () => {
  assert.doesNotThrow(() => tester.run("fe-stack-import", rule("fe-stack-import"), {
    valid: [{ filename: BLOCK, code: GRAMMAR + "import { useSpring } from \"@react-spring/web\"\nexport const A = () => <Custom reason=\"spring\"><div style={useSpring({ opacity: 1 })} /></Custom>" }],
    invalid: [{ filename: BLOCK, code: "import gsap from \"gsap\"\nexport const A = () => { gsap.to(\"a\", {}); return null }", errors: [{ messageId: "forbidden" }] }],
  }))
})

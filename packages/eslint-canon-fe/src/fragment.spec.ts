/**
 * The Fragment region: no canon front-end law that judges markup, look or libraries reports anything in a Fragment subtree, an import
 * whose every use is there, or a same-file helper only Fragment renders; code outside it is judged as before.
 *
 *   node --test src/fragment.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { rules } from "./index.ts"
import { fragmentOnlyConcern } from "./fragment-libraries.ts"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const GRAMMAR = "import { Fragment, SurfaceCard } from \"@starci/grammar/core\"\n"
const rule = (name: string) => {
  const found = rules[name]
  assert.ok(found, `${name} is published`)
  return found
}

test("no-arbitrary-value: anything inside Fragment, Grammar components included; outside it stays judged", () => {
  assert.doesNotThrow(() => tester.run("no-arbitrary-value", rule("no-arbitrary-value"), {
    valid: [
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <Fragment reason=\"graph canvas\"><div className=\"w-[42rem]\"><SurfaceCard className=\"p-[3px]\" /></div></Fragment>" },
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <Fragment reason=\"art\" />" },
      { filename: BLOCK, code: GRAMMAR + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.Fragment reason=\"art\"><span className=\"p-[3px]\" /></G.Fragment>" },
      // the Grammar's Fragment under an alias, as a file that also needs React's Fragment writes it
      { filename: BLOCK, code: ["import { Fragment } from \"react\"", "import { Fragment as GrammarFragment } from \"@starci/grammar/core\"", "export const A = () => <Fragment><GrammarFragment reason=\"art\"><div className=\"w-[42rem]\" /></GrammarFragment></Fragment>"].join("\n") },
    ],
    invalid: [
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <div className=\"w-[42rem]\" />", errors: [{ messageId: "length" }] },
      { filename: BLOCK, code: GRAMMAR + "export const A = () => <div><Fragment reason=\"art\" /><div className=\"w-[42rem]\" /></div>", errors: [{ messageId: "length" }] },
      // React's Fragment, imported under its own name or written <>, opens no region
      { filename: BLOCK, code: ["import { Fragment } from \"react\"", "export const A = () => <Fragment><div className=\"w-[42rem]\" /></Fragment>"].join("\n"), errors: [{ messageId: "length" }] },
      { filename: BLOCK, code: "export const A = () => <><div className=\"w-[42rem]\" /></>", errors: [{ messageId: "length" }] },
      // a component of the same name that is not the Grammar's opens no region
      { filename: BLOCK, code: "const Fragment = (props: { readonly children?: unknown }) => <>{props.children}</>\nexport const A = () => <Fragment><div className=\"w-[42rem]\" /></Fragment>", errors: [{ messageId: "length" }] },
    ],
  }))
})

test("fragment-only-library: a motion or graph library is imported only for use inside Fragment", () => {
  assert.doesNotThrow(() => tester.run("fragment-only-library", rule("fragment-only-library"), {
    valid: [
      // every use inside the region
      { filename: BLOCK, code: GRAMMAR + "import { motion } from \"motion/react\"\nexport const A = () => <Fragment reason=\"entrance motion\"><motion.div animate={{ opacity: 1 }} /></Fragment>" },
      // a same-file helper only the region renders
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow, useNodesState } from \"@xyflow/react\"\nconst Canvas = () => { const [nodes] = useNodesState([]); return <ReactFlow nodes={nodes} /> }\nexport const A = () => <Fragment reason=\"workflow graph\"><Canvas /></Fragment>" },
      // an exported node renderer is a thin wrapper over a private component (memo and forwardRef included), as an svg group or a div
      {
        filename: BLOCK,
        code: [
          GRAMMAR + "import { memo } from \"react\"",
          "import { Handle, useStore } from \"@xyflow/react\"",
          "const StepInner = memo(function StepInner() { const zoom = useStore((s) => s.transform[2]); return <Handle type=\"source\" position={zoom as never} /> })",
          "export const StepNode = () => <Fragment reason=\"workflow step node\"><g><StepInner /></g></Fragment>",
        ].join("\n"),
      },
      // a type carries no behaviour
      { filename: BLOCK, code: "import type { Node } from \"@xyflow/react\"\nexport type Item = Node" },
    ],
    invalid: [
      { filename: BLOCK, code: "import { motion } from \"framer-motion\"\nexport const A = () => <motion.div />", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: GRAMMAR + "import { motion } from \"motion/react\"\nexport const A = () => <div><motion.div /><Fragment reason=\"x\"><motion.div /></Fragment></div>", errors: [{ messageId: "library" }] },
      // the helper is also rendered outside the region
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow } from \"@xyflow/react\"\nconst Canvas = () => <ReactFlow />\nexport const A = () => <><Canvas /><Fragment reason=\"x\"><Canvas /></Fragment></>", errors: [{ messageId: "library" }] },
      // an exported helper can be rendered by any file
      { filename: BLOCK, code: GRAMMAR + "import { ReactFlow } from \"@xyflow/react\"\nexport const Canvas = () => <ReactFlow />\nexport const A = () => <Fragment reason=\"x\"><Canvas /></Fragment>", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: "import \"motion\"\nexport const A = () => null", errors: [{ messageId: "library" }] },
      { filename: BLOCK, code: "export const load = () => import(\"@xyflow/react\")", errors: [{ messageId: "library" }] },
    ],
  }))
})

test("fragment-only-library: the packages it names", () => {
  for (const name of ["motion", "motion/react", "motion/mini", "framer-motion", "framer-motion/dom"]) assert.equal(fragmentOnlyConcern(name), "motion", name)
  for (const name of ["@xyflow/react", "@xyflow/react/dist/style.css", "reactflow", "@reactflow/core"]) assert.equal(fragmentOnlyConcern(name), "graph", name)
  for (const name of ["react", "motion-utils-fake", "@heroui/react", "dayjs"]) assert.equal(fragmentOnlyConcern(name), null, name)
})

test("fe-stack-import: a forbidden library used only inside Fragment is not judged; used outside it is", () => {
  assert.doesNotThrow(() => tester.run("fe-stack-import", rule("fe-stack-import"), {
    valid: [{ filename: BLOCK, code: GRAMMAR + "import { useSpring } from \"@react-spring/web\"\nexport const A = () => <Fragment reason=\"spring\"><div style={useSpring({ opacity: 1 })} /></Fragment>" }],
    invalid: [{ filename: BLOCK, code: "import gsap from \"gsap\"\nexport const A = () => { gsap.to(\"a\", {}); return null }", errors: [{ messageId: "forbidden" }] }],
  }))
})

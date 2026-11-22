/**
 * Twin tests for the avatar-row law (DNA-COMMON-AVATAR-ROW-GROUP): avatars in a row or from a list are one AvatarGroup.
 *
 *   node --test src/avatar-row-uses-group.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { avatarRowUsesGroup, recommended, rules } from "./avatar-row-uses-group.ts"

const BLOCK = at("apps/web/src/components/blocks/Providers/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Avatar, AvatarButton, AvatarGroup, Stack } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = ({ items }: { items: { id: string; name: string }[] }) => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["avatar-row-uses-group"])
  assert.deepEqual(recommended, { "starci-grammar/avatar-row-uses-group": "error" })
})

test("DNA-COMMON-AVATAR-ROW-GROUP: siblings fail, a map without a group fails, inside AvatarGroup passes, a single Avatar passes", () => {
  slotTester().run("avatar-row-uses-group", avatarRowUsesGroup, {
    valid: [
      { filename: BLOCK, code: code("<Avatar name=\"Lan\" />") },
      { filename: BLOCK, code: code("<Stack><Avatar name=\"Lan\" /><span>Lan</span></Stack>") },
      { filename: BLOCK, code: code("<AvatarGroup label=\"Providers\" items={items} max={6} overflowLabel={(n) => `${n}`} />") },
      { filename: BLOCK, code: code("<AvatarGroup label=\"x\" items={[]} overflowLabel={() => \"\"}><Avatar name=\"A\" /><Avatar name=\"B\" /></AvatarGroup>") },
      { filename: BLOCK, code: code("<AvatarGroup label=\"x\" items={[]} overflowLabel={() => \"\"}>{items.map((item) => <Avatar key={item.id} name={item.name} />)}</AvatarGroup>") },
      { filename: BLOCK, code: code("<Stack><AvatarButton name=\"A\" /><AvatarButton name=\"B\" /></Stack>") },
      { filename: BLOCK, code: code("<Stack><Avatar name=\"A\" /><Stack><Avatar name=\"B\" /></Stack></Stack>") },
      { filename: BLOCK, code: "import { Avatar } from \"./local\"\nexport const A = () => <div><Avatar /><Avatar /></div>" },
      { filename: SCRIPT, code: code("<Stack><Avatar name=\"A\" /><Avatar name=\"B\" /></Stack>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Stack><Avatar name=\"A\" /><Avatar name=\"B\" /></Stack>"), errors: [{ messageId: "siblings" }] },
      { filename: BLOCK, code: code("<Stack><Avatar name=\"A\" /><Avatar name=\"B\" /><Avatar name=\"C\" /></Stack>"), errors: [{ messageId: "siblings" }, { messageId: "siblings" }] },
      { filename: BLOCK, code: code("<><Avatar name=\"A\" />{items.length > 1 ? <Avatar name=\"B\" /> : null}</>"), errors: [{ messageId: "siblings" }] },
      { filename: BLOCK, code: code("<Stack>{items.map((item) => <Avatar key={item.id} name={item.name} />)}</Stack>"), errors: [{ messageId: "mapped" }] },
      { filename: BLOCK, code: code("<Stack>{items.map((item) => { return <Avatar key={item.id} name={item.name} /> })}</Stack>"), errors: [{ messageId: "mapped" }] },
      { filename: BLOCK, code: code("<Stack>{items.map((item) => <Stack key={item.id}><Avatar name={item.name} /></Stack>)}</Stack>"), errors: [{ messageId: "mapped" }] },
      { filename: BLOCK, code: "import * as G from \"@starci/grammar/core\"\nexport const A = ({ items }: { items: { id: string }[] }) => <G.Stack>{items.map((item) => <G.Avatar key={item.id} name={item.id} />)}</G.Stack>", errors: [{ messageId: "mapped" }] },
    ],
  })
})

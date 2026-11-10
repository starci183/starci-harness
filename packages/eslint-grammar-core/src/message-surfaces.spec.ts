/**
 * Twin tests for the chat surfaces law (`FE_MESSAGE_SURFACES`).
 *
 *   node --test src/message-surfaces.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { messageSurfaces, recommended, rules } from "./message-surfaces.ts"

const BLOCK = at("apps/web/src/components/blocks/TeamChatRoom/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { MessageBubble, MessageCard, Pane, PaneSection, Stack } from \"@starci/grammar\"\nimport { cn } from \"./cn\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["message-surfaces"])
  assert.deepEqual(recommended, { "starci-grammar/message-surfaces": "error" })
})

test("FE_MESSAGE_SURFACES: no restyle of a bubble, a message card or the thread ground", () => {
  slotTester().run("message-surfaces", messageSurfaces, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <MessageBubble side=\"outgoing\" body=\"Hi\" />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <MessageCard title=\"Stop\" body={null} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <PaneSection scroll={{ label: \"Thread\", role: \"log\", align: \"end\" }}>x</PaneSection>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <PaneSection scroll={{ label: \"List\", role: \"region\", tone: \"surface\" }}>x</PaneSection>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <div className=\"flex gap-2\"><MessageBubble body=\"Hi\" /></div>" },
      // a tone held in a variable is not read; a script is not product source
      { filename: BLOCK, code: IMPORT + "export const A = (p) => <PaneSection scroll={{ label: \"Thread\", role: \"log\", tone: p.tone }}>x</PaneSection>" },
      // a chat frame with no tone; a white room list beside it; `surface={false}` states no tone
      { filename: BLOCK, code: IMPORT + "export const A = () => <Pane area=\"room\" content=\"chat\" label=\"Room\"><PaneSection scroll={{ label: \"Thread\", role: \"log\" }}>x</PaneSection></Pane>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Pane area=\"list\" surface label=\"Rooms\"><PaneSection>x</PaneSection></Pane>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Pane area=\"room\" surface={false}><PaneSection scroll={{ label: \"Thread\", role: \"log\" }}>x</PaneSection></Pane>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <MessageBubble className=\"x\" body=\"Hi\" />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <MessageBubble className=\"shadow-none\" body=\"Hi\" />", errors: [{ messageId: "attribute" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <MessageCard title=\"Stop\" style={{ background: \"white\" }} />", errors: [{ messageId: "attribute" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <div className=\"[&_.starci-core-message-bubble-body]:bg-white\"><MessageBubble body=\"Hi\" /></div>", errors: [{ messageId: "part" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Stack><div className={cn(\"p-2\", \"[&_.starci-core-message-card]:border\")} /></Stack>", errors: [{ messageId: "part" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <div style={{ \"--x\": 1, \".starci-core-message-bubble-body\": 2 }} />", errors: [{ messageId: "part" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <PaneSection scroll={{ label: \"Thread\", role: \"log\", tone: \"surface\" }}>x</PaneSection>", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Pane area=\"room\" surface content=\"chat\" label=\"Room\">x</Pane>", errors: [{ messageId: "frame" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Pane area=\"room\" surface label=\"Room\"><><PaneSection scroll={{ label: \"Thread\", role: \"log\" }}>x</PaneSection></></Pane>", errors: [{ messageId: "frame" }] },
    ],
  })
})

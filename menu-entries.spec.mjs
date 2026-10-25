/**
 * Twin tests for the menu-entry law: a destructive entry of Grammar's `DropdownMenu` carries `tone: "danger"`.
 *
 *   node --test menu-entries.spec.mjs
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "./fixtures/typed/tester.mjs"
import { destructiveMenuEntryNeedsDangerTone, isDestructiveText, normalizeText, recommended, rules } from "./menu-entries.mjs"

// Vietnamese labels written as unicode escapes (sources are English): sign out, delete, delete account, leave workspace, revoke, deactivate.
const VI_DESTRUCTIVE = ["\u0110\u0103ng xu\u1ea5t", "dang-xuat", "X\u00f3a", "Xo\u00e1 t\u00e0i kho\u1ea3n", "R\u1eddi kh\u1ecfi workspace", "Thu h\u1ed3i quy\u1ec1n", "V\u00f4 hi\u1ec7u h\u00f3a"]
// settings, profile, account
const VI_ORDINARY = ["C\u00e0i \u0111\u1eb7t", "H\u1ed3 s\u01a1", "T\u00e0i kho\u1ea3n"]

const BLOCK = at("apps/web/src/components/blocks/AccountMenu/component.tsx")
const SCRIPT = at("scripts/build.tsx")

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["destructive-menu-entry-needs-danger-tone"])
  assert.deepEqual(recommended, { "starci-fe/destructive-menu-entry-needs-danger-tone": "error" })
})

test("the terms are compared as whole words, English and Vietnamese, however the id or label is spelled", () => {
  for (const text of ["Sign out", "sign-out", "signOut", "logout", "Log out", "delete", "delete_account", "Remove member", "Leave workspace", "Revoke access", ...VI_DESTRUCTIVE]) {
    assert.equal(isDestructiveText(text), true, text)
  }
  for (const text of ["Settings", "Profile", "Account", "Switch workspace", "Leave feedback", "Removed items", "Undelete", ...VI_ORDINARY]) {
    assert.equal(isDestructiveText(text), false, text)
  }
  assert.equal(normalizeText("\u0110\u0103ng Xu\u1ea5t"), "dang xuat")
})

test("MENU-1: a destructive entry without tone danger is red, wherever the entries are written", () => {
  slotTester().run("destructive-menu-entry-needs-danger-tone", destructiveMenuEntryNeedsDangerTone, {
    valid: [
      // the danger tone marks it
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'sign-out', label: 'Sign out', tone: 'danger' }]} />" },
      // an ordinary command needs no tone
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'settings', label: 'Settings' }]} />" },
      // constants, aliases and every conditional branch still prove danger
      { filename: BLOCK, code: "const dangerTone = 'danger' as const; const tone = dangerTone; export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'delete', label: 'Delete', tone }]} />" },
      { filename: BLOCK, code: "const dangerTone = 'danger'; export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'sign-out', tone: cond ? dangerTone : 'danger' }]} />" },
      { filename: BLOCK, code: "const tone = cond ? 'danger' : (other ? 'danger' : 'danger'); const item: DropdownMenuItem = { id: 'logout', tone }" },
      // entries the rule cannot see through are left alone
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={build(items)} />" },
      // another component's `entries` is not a menu
      { filename: BLOCK, code: "export const A = () => <Table entries={[{ id: 'delete', label: 'Delete' }]} />" },
      // a script is not product source
      { filename: SCRIPT, code: "export const A = () => <DropdownMenu entries={[{ id: 'delete', label: 'Delete' }]} />" },
      // a typed list of ordinary entries
      { filename: BLOCK, code: "const entries: readonly DropdownMenuEntry[] = [{ id: 'profile', label: 'Profile' }]" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'sign-out', label: 'Sign out' }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'out', label: '\u0110\u0103ng xu\u1ea5t' }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'delete', label: t('x'), tone: 'neutral' }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "const neutralTone = 'neutral'; export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'sign-out', tone: neutralTone }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'sign-out', tone: cond ? 'danger' : 'neutral' }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "const tone = cond ? 'danger' : unknownTone; const item: DropdownMenuItem = { id: 'logout', tone }", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'delete', label: 'Delete', tone: pick() }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "let tone = 'danger'; const item: DropdownMenuItem = { id: 'logout', tone }", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "const tone = cond ? 'danger' : tone; const item: DropdownMenuItem = { id: 'logout', tone }", errors: [{ messageId: "tone" }] },
      // inside a section and a submenu
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ kind: 'section', id: 's', items: [{ id: 'leave-workspace', label: 'Leave' }] }]} />", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "export const A = () => <DropdownMenu trigger={t} entries={[{ id: 'more', label: 'More', submenu: [{ id: 'revoke', label: 'Revoke' }] }]} />", errors: [{ messageId: "tone" }] },
      // a declaration typed as the Grammar entry type, array or single
      { filename: BLOCK, code: "const entries: readonly DropdownMenuEntry[] = [{ id: 'remove', label: 'Remove' }]", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "const entries: ReadonlyArray<DropdownMenuItem> = [{ id: 'x', label: 'X\u00f3a' }]", errors: [{ messageId: "tone" }] },
      { filename: BLOCK, code: "const item: DropdownMenuItem = { id: 'logout', label: 'Out' }", errors: [{ messageId: "tone" }] },
    ],
  })
})

/**
 * Before/after fixtures of v0540 (Grammar 0.54.0, the type roles).
 *
 *   node --test codemods/v0540/v0540.spec.mts
 */
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"
import { SITE_TEXT_ROLES, TEXT_ROLES, typeRoleClassName } from "../../src/common/typeRoles.ts"
import { CODEMODS, codemodId, codemodsBetween } from "../index.mts"
import { MARK, ROLES, mapClassList, roleClass, runV0540, sourceRoots, transformSource, v0540Markdown } from "./index.mts"

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url))
const read = (side: "before" | "after", name: string): string => readFileSync(join(FIXTURES, side, name), "utf8")

test("the roles and their classes are Grammar 0.54.0's (the site group of 0.55.0 is v0550's)", () => {
    assert.deepEqual([...ROLES], TEXT_ROLES.filter((role) => !SITE_TEXT_ROLES.includes(role)))
    for (const role of ROLES) assert.equal(roleClass(role), typeRoleClassName(role))
})

for (const name of readdirSync(join(FIXTURES, "before"))) {
    test(`${name}: the before fixture becomes the after fixture`, () => {
        assert.equal(transformSource(ts, name, read("before", name)).text, read("after", name))
    })
}

test("Text size, tone and isStrong map onto the roles", () => {
    const { findings } = transformSource(ts, "Text.tsx", read("before", "Text.tsx"))
    assert.deepEqual(findings.filter((f) => f.role).map((f) => f.role), ["label.item", "caption", "label.group", "body", "figure", "code"])
})

test("raw size classes map onto the roles; an ambiguous one is left and marked", () => {
    assert.deepEqual(mapClassList("text-sm font-medium", "span"), { role: "label.item", out: "starci-type-label-item" })
    assert.deepEqual(mapClassList("text-sm text-muted", "p"), { role: "body", out: "starci-type-body text-muted" })
    assert.deepEqual(mapClassList("text-sm font-medium text-muted", "label"), { role: "label.field", out: "starci-type-label-field" })
    assert.deepEqual(mapClassList("text-xs font-medium text-muted", "span"), { role: "label.group", out: "starci-type-label-group" })
    assert.deepEqual(mapClassList("flex gap-2", "div"), null)
    assert.ok("ambiguous" in (mapClassList("text-xs rounded-full bg-accent", "span") ?? {}))
    const { text, findings } = transformSource(ts, "classes.tsx", read("before", "classes.tsx"))
    assert.deepEqual(findings.filter((f) => !f.role).map((f) => f.reason), ["responsive or state size variant", "xs without muted: caption or badge"])
    assert.equal(text.split(MARK).length - 1, 2)
})

/** An app checkout holding the before fixtures in apps/web/src. */
const app = (): string => {
    const root = mkdtempSync(join(tmpdir(), "v0540-"))
    mkdirSync(join(root, "apps", "web", "src"), { recursive: true })
    cpSync(join(FIXTURES, "before"), join(root, "apps", "web", "src"), { recursive: true })
    return root
}

test("dry mode writes nothing and reports every file; --execute writes the after fixtures", () => {
    const root = app()
    try {
        const dry = runV0540({ root, write: false, ts })
        assert.equal(dry.mode, "dry")
        assert.equal(readFileSync(join(root, "apps/web/src/Text.tsx"), "utf8"), read("before", "Text.tsx"))
        assert.deepEqual(dry.files.map((f) => [f.file, f.changed]), [["apps/web/src/Text.tsx", true], ["apps/web/src/classes.tsx", true]])
        assert.equal(dry.findings.length, 4)
        assert.match(v0540Markdown(dry), /would change/)
        const done = runV0540({ root, write: true, ts })
        assert.equal(done.mode, "execute")
        for (const name of ["Text.tsx", "classes.tsx"]) assert.equal(readFileSync(join(root, "apps/web/src", name), "utf8"), read("after", name))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("codemods are named after their Grammar version and run in version order between two versions", () => {
    assert.equal(codemodId("0.54.0"), "v0540")
    for (const codemod of CODEMODS) assert.equal(codemod.id, codemodId(codemod.version))
    assert.deepEqual(codemodsBetween("0.52.3", "0.54.0").map((c) => c.id), ["v0540"])
    assert.deepEqual(codemodsBetween("0.54.0", "0.54.1").map((c) => c.id), [])
    assert.deepEqual(codemodsBetween("0.53.0", "0.53.9").map((c) => c.id), [])
})

test("the source folders are every app and package src on either layout, the app's gallery workspace and a package's own src", (t) => {
    const root = mkdtempSync(join(tmpdir(), "v0540-roots-"))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    for (const dir of ["src", "gallery/src", "fe/apps/web/src", "packages/ui/src", "fe/apps/docs"]) mkdirSync(join(root, dir), { recursive: true })
    assert.deepEqual(sourceRoots(root).map((dir) => dir.slice(root.length + 1).replaceAll("\\", "/")).sort(), ["fe/apps/web/src", "gallery/src", "packages/ui/src", "src"])
})

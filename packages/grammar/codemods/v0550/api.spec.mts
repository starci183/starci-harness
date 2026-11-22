/**
 * The API pass of v0550: every API deleted in Grammar 0.55.0.
 *
 *   node --test codemods/v0550/api.spec.mts
 */
import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { API_MARK, API_STEPS, transformApiSource } from "./api.mts"

const run = (code: string, site = false) => transformApiSource(ts, "apps/web/src/components/blocks/Foo/index.tsx", code, { site })

test("a dropped prop goes with its leading space, on a bare or member element", () => {
    const cases: readonly [string, string][] = [
        ['<IconTile size="sm" icon={I} />', "<IconTile icon={I} />"],
        ['<G.IconTile icon={I} size={32} />', "<G.IconTile icon={I} />"],
        ['<Timeline items={x} marker="dot" />', "<Timeline items={x} />"],
        ['<Stepper steps={s} completeMarker="check" />', "<Stepper steps={s} />"],
        ['<Avatar name="An" fallbackMark="initials" />', '<Avatar name="An" />'],
        ['<AvatarButton name="An" fallbackMark="initials" onPress={p} />', '<AvatarButton name="An" onPress={p} />'],
        ['<Alert tone="negative" appearance="surface" title="t" />', '<Alert tone="negative" title="t" />'],
        ['<GrammarRoot theme="dark">x</GrammarRoot>', "<GrammarRoot>x</GrammarRoot>"],
    ]
    for (const [before, after] of cases) {
        const out = run(`export const A = () => ${before}\n`)
        assert.equal(out.text, `export const A = () => ${after}\n`, before)
        assert.equal(out.findings.length, 1, before)
        assert.equal(out.findings[0]?.reason, undefined, before)
    }
})

test("an element of another name keeps its props", () => {
    const code = 'export const A = () => <Tile size="sm" marker="x" />\n'
    assert.equal(run(code).text, code)
})

test("<Text size> outside the site becomes its role, as v0540 maps it", () => {
    assert.equal(run('const A = () => <Text size="xs" tone="muted">a</Text>\n').text, 'const A = () => <Text role="caption">a</Text>\n')
    assert.equal(run('const A = () => <Text size="sm" isStrong>a</Text>\n').text, 'const A = () => <Text role="label.item">a</Text>\n')
    assert.equal(run('const A = () => <Text size="figure" isStrong>1</Text>\n').text, 'const A = () => <Text role="figure" isStrong>1</Text>\n')
    const dynamic = run("const A = () => <Text size={s}>a</Text>\n")
    assert.ok(dynamic.text.startsWith(`// ${API_MARK}: non-literal size`), dynamic.text)
    assert.equal(dynamic.findings[0]?.step, "text-size")
    // The site's Text is the site pass's.
    const site = 'const A = () => <Text size="sm">a</Text>\n'
    assert.equal(run(site, true).text, site)
})

test("a deleted component is marked, never rewritten, and the mark is not doubled", () => {
    const once = run('const A = () => (\n    <div>\n        <ButtonGroup label="x" actions={a} />\n    </div>\n)\n')
    assert.match(once.text, /\{\/\* TODO\(grammar-0\.55\): ButtonGroup is deleted in 0\.55\.0; use separate Buttons/)
    assert.equal(once.findings[0]?.reason !== undefined, true)
    assert.equal(run(once.text).text, once.text)
    assert.match(run('const A = () => <><G.FilterButtonGroup label="x" options={o} /></>\n').text, /Tabs kind="filter"/)
})

test("an import of a deleted export is marked", () => {
    const out = run('import { Text, type TextSize } from "@starci/grammar/core"\n')
    assert.match(out.text, /^\/\/ TODO\(grammar-0\.55\): TextSize is deleted in 0\.55\.0; use TextRole\n/)
    for (const name of ["STARCI_CORE_TOKEN_NAMES", "STARCI_CORE_TOKEN_DEFAULTS", "OFFSET_POP_DARK_TOKEN_DEFAULTS", "AlertAppearance"]) {
        assert.ok(run(`import { ${name} } from "@starci/grammar/core"\n`).text.startsWith(`// TODO(grammar-0.55): ${name} is deleted`), name)
    }
})

test("<ExpandableText size> becomes its role", () => {
    assert.equal(run('const A = () => <ExpandableText text={t} moreLabel="m" lessLabel="l" size="sm" />\n').text, 'const A = () => <ExpandableText text={t} moreLabel="m" lessLabel="l" role="body" />\n')
})

test("every step has a summary and names its elements", () => {
    const ids = new Set<string>()
    for (const step of API_STEPS) {
        assert.ok(step.summary.length > 10, step.id)
        assert.ok(step.elements.length > 0, step.id)
        assert.ok(!ids.has(step.id), step.id)
        ids.add(step.id)
    }
})

test("avatar-size: lg and control become md; the old sm becomes sm inline, md standalone, and is marked when unclear", () => {
    assert.equal(run('const A = () => <Avatar name="An" size="lg" />\n').text, 'const A = () => <Avatar name="An" size="md" />\n')
    assert.equal(run('const A = () => <AvatarButton name="An" size="control" />\n').text, 'const A = () => <AvatarButton name="An" size="md" />\n')
    assert.equal(run('const A = () => <AvatarButton name="An" size="floating" />\n').text, 'const A = () => <AvatarButton name="An" size="floating" />\n')
    // Inline: beside text, in a Chip, in a table cell: sm (24) stays sm.
    const inline = 'const A = () => <span>Owner <Avatar name="An" size="sm" /></span>\n'
    assert.equal(run(inline).text, inline)
    const chip = 'const A = () => <Chip><AvatarGroup label="x" items={i} size="sm" overflowLabel={o} /></Chip>\n'
    assert.equal(run(chip).text, chip)
    // Standalone: a list lead, a bubble's avatar, a header mark: md (40).
    assert.equal(run('const A = () => <ListRow row={{ id: "a", leading: <Avatar name="An" size="sm" /> }} />\n').text, 'const A = () => <ListRow row={{ id: "a", leading: <Avatar name="An" size="md" /> }} />\n')
    assert.equal(run('const A = () => <MessageBubble avatar={<G.Avatar name="An" size="sm" />} body="x" />\n').text, 'const A = () => <MessageBubble avatar={<G.Avatar name="An" size="md" />} body="x" />\n')
    assert.equal(run('const A = () => <PaneHeader title="t" mark={<AvatarGroup label="x" items={i} size="lg" overflowLabel={o} />} />\n').text, 'const A = () => <PaneHeader title="t" mark={<AvatarGroup label="x" items={i} size="md" overflowLabel={o} />} />\n')
    // Unclear: marked TODO(avatar-size), never guessed; a dynamic size too.
    const unclear = run('const A = () => (\n    <Stack>\n        <Avatar name="An" size="sm" />\n    </Stack>\n)\n')
    assert.match(unclear.text, /\{\/\* TODO\(avatar-size\): the old sm 32/)
    assert.equal(unclear.findings[0]?.step, "avatar-size")
    assert.match(run("const A = () => <Avatar name=\"An\" size={s} />\n").text, /^\/\/ TODO\(avatar-size\): size is not a literal/)
    // md is left alone.
    const md = 'const A = () => <Avatar name="An" size="md" />\n'
    assert.equal(run(md).text, md)
})

test("avatar-group-member-names: memberNames is dropped", () => {
    assert.equal(run('const A = () => <AvatarGroup label="x" items={i} overflowLabel={o} memberNames={m} />\n').text, 'const A = () => <AvatarGroup label="x" items={i} overflowLabel={o} />\n')
})

test("core BarChart and Sparkline: the import moves to the ext, the props map, the rest is marked TODO(chart)", () => {
    const whole = run('import { BarChart } from "@starci/grammar/core"\n')
    assert.equal(whole.text, 'import { BarChart } from "@starci/grammar/core/ext/recharts"\n')
    const split = run('import { Text, Sparkline, type SparklineProps } from "@starci/grammar/core";\n')
    assert.equal(split.text, 'import { Text } from "@starci/grammar/core";\nimport { Sparkline, type SparklineProps } from "@starci/grammar/core/ext/recharts";\n')
    const ext = 'import { BarChart } from "@starci/grammar/core/ext/recharts"\n'
    assert.equal(run(ext).text, ext)

    const bar = run('const A = () => (\n    <div>\n        <BarChart label="Per day" bars={perDay} empty={<Empty />} highlightLast />\n    </div>\n)\n')
    assert.match(bar.text, /<BarChart ariaLabel="Per day" data=\{perDay\} xKey="label" yKey="value" empty=\{<Empty \/>\} highlightLast \/>/)
    assert.match(bar.text, /\{\/\* TODO\(chart\): BarChart is the ext chart now; set empty, highlightLast, emptyLabel \(required, a string\) \*\/\}/)
    const spark = run('const A = () => <Sparkline label="Revenue" values={weekly} emptyLabel="None" />\n')
    assert.equal(spark.text, 'const A = () => <Sparkline ariaLabel="Revenue" data={(weekly).map((value, index) => ({ index, value }))} xKey="index" yKey="value" emptyLabel="None" />\n')
    assert.equal(spark.findings.every((f) => f.reason === undefined), true)
    // Already on the ext's props: untouched.
    const done = 'const A = () => <Sparkline ariaLabel="R" data={d} xKey="w" yKey="v" emptyLabel="None" />\n'
    assert.equal(run(done).text, done)
    // A namespace member: the namespace no longer has it.
    assert.match(run('const A = () => <G.Sparkline label="R" values={v} emptyLabel="x" />\n').text, /TODO\(chart\): Sparkline is the ext chart now; set import Sparkline from @starci\/grammar\/core\/ext\/recharts/)
})

test("Figure.trendLine is marked TODO(chart) in a file that uses the Grammar", () => {
    const code = 'import * as G from "@starci/grammar/core"\nconst f: G.Figure = { id: "r", term: "Revenue", value: 1, trendLine: [1, 2] }\n'
    const out = run(code)
    assert.match(out.text, /\/\* TODO\(chart\): trendLine is deleted in 0\.55\.0; use trendChart=/)
    assert.equal(run(out.text).text, out.text)
    const plain = 'const f = { trendLine: [1, 2] }\n'
    assert.equal(run(plain).text, plain)
})

test("avatar-mark-logo: a mark's icon is its logo, on an Avatar and in an AvatarGroup's items, inline or a const of the file", () => {
    assert.equal(run("const A = () => <Avatar name=\"Zalo\" mark={{ icon: <Z />, color: c }} />\n").text, "const A = () => <Avatar name=\"Zalo\" mark={{ logo: <Z />, color: c }} />\n")
    assert.equal(run("const A = () => <AvatarGroup label=\"K\" items={[{ id: \"z\", name: \"Zalo\", mark: { icon } }]} />\n").text, "const A = () => <AvatarGroup label=\"K\" items={[{ id: \"z\", name: \"Zalo\", mark: { logo: icon } }]} />\n")
    const viaConst = run("const items = [{ id: \"z\", name: \"Zalo\", mark: { icon: <Z /> } }] as const\nconst A = () => <><AvatarGroup label=\"K\" items={items} /><G.AvatarGroup label=\"L\" items={items} /></>\n")
    assert.match(viaConst.text, /mark: \{ logo: <Z \/> \}/)
    assert.doesNotMatch(viaConst.text, /icon/)
    // a SurfaceCard tile's mark keeps its icon: it is not a round mark
    const tile = "const A = () => <SurfaceCard kind=\"tile\" name=\"Drive\" mark={{ icon: Book }} />\n"
    assert.equal(run(tile).text, tile)
})

/**
 * The API pass of v0550: every API deleted in Grammar 0.55.0.
 *
 *   node --test codemods/v0550/api.spec.mts
 */
import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { API_MARK, API_STEPS, transformApiSource } from "./api.mts"

/** The Grammar imports the snippets read their elements from (the codemod touches only a Grammar element), at the end so the lines of a snippet stay its own. */
const GRAMMAR = `
import * as G from "@starci/grammar"
import { Alert, Avatar, AvatarButton, AvatarGroup, Button, ButtonGroup, EmptyNotice, ExpandableText, FilterButtonGroup, GrammarRoot, IconButton, IconTile, ListRow, Stepper, Text, Timeline } from "@starci/grammar/core"
import { BarChart, Sparkline } from "@starci/grammar/core/ext/recharts"
`
const withGrammar = (out: ReturnType<typeof transformApiSource>) => ({ ...out, text: out.text.endsWith(GRAMMAR) ? out.text.slice(0, -GRAMMAR.length) : out.text })
const bare = (code: string) => transformApiSource(ts, "apps/web/src/components/blocks/Foo/index.tsx", code)
const run = (code: string, site = false) => withGrammar(transformApiSource(ts, "apps/web/src/components/blocks/Foo/index.tsx", code + GRAMMAR, { site }))

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
    // highlightLast stays (the ext BarChart has it); an element `empty` has no words to carry, so emptyLabel is asked for by its real name.
    assert.match(bar.text, /\{\/\* TODO\(chart\): BarChart is the ext chart now; set emptyLabel \(a string: the words of the empty chart; empty was an element\) \*\/\}/)
    const spark = run('const A = () => <Sparkline label="Revenue" values={weekly} emptyLabel="None" />\n')
    assert.equal(spark.text, 'const A = () => <Sparkline ariaLabel="Revenue" data={(weekly).map((value, index) => ({ index, value }))} xKey="index" yKey="value" emptyLabel="None" />\n')
    assert.equal(spark.findings.every((f) => f.reason === undefined), true)
    // Already on the ext's props: untouched.
    const done = 'const A = () => <Sparkline ariaLabel="R" data={d} xKey="w" yKey="v" emptyLabel="None" />\n'
    assert.equal(run(done).text, done)
    // A namespace member: the namespace no longer has it.
    assert.match(run('const A = () => <G.Sparkline label="R" values={v} emptyLabel="x" />\n').text, /TODO\(chart\): Sparkline is the ext chart now; set import Sparkline from @starci\/grammar\/core\/ext\/recharts/)
})

test("core-chart maps what it can: empty is emptyLabel, valueAxis format is formatY, highlightLast stays; the TODO names the ext's real props", () => {
    const one = (code: string): string => run(`const A = () => ${code}\n`).text.replace(/^const A = \(\) => /u, "").replace(/\n$/u, "")
    assert.equal(one('<BarChart label="Per day" bars={b} empty="No data yet" highlightLast valueAxis={{ format: (value) => `${value} k` }} />'), '<BarChart ariaLabel="Per day" data={b} xKey="label" yKey="value" emptyLabel="No data yet" highlightLast formatY={(value) => `${value} k`} />')
    assert.equal(one("<BarChart ariaLabel=\"x\" data={b} xKey=\"label\" yKey=\"value\" empty={t(\"empty\")} valueAxis={{ format: String }} />"), "<BarChart ariaLabel=\"x\" data={b} xKey=\"label\" yKey=\"value\" emptyLabel={t(\"empty\")} formatY={String} />")
    assert.equal(one("<BarChart ariaLabel=\"x\" data={b} xKey=\"l\" yKey=\"v\" emptyLabel=\"e\" valueAxis={{ format }} />"), "<BarChart ariaLabel=\"x\" data={b} xKey=\"l\" yKey=\"v\" emptyLabel=\"e\" formatY={format} />")
    // A valueAxis const of the file is followed.
    assert.match(run("const axis = { format: compact }\nconst A = () => <BarChart ariaLabel=\"x\" data={b} xKey=\"l\" yKey=\"v\" emptyLabel=\"e\" valueAxis={axis} />\n").text, /formatY=\{compact\}/)
    // What it cannot map is marked with the real names: error, a valueAxis with no function, a Sparkline's highlightLast.
    const left = run('const A = () => <BarChart ariaLabel="x" data={b} xKey="l" yKey="v" emptyLabel="e" valueAxis={axis} error={err} />\n').text
    assert.match(left, /TODO\(chart\): BarChart is the ext chart now; set formatY \(a function of the value; valueAxis had no format function\), nothing for error \(the ext BarChart has no error prop: draw the failed read in its place; it takes isLoading and emptyLabel\)/)
    assert.doesNotMatch(left, /set [^*]*\b(empty|valueAxis|highlightLast),/)
    assert.match(run('const A = () => <Sparkline ariaLabel="x" data={d} xKey="i" yKey="v" emptyLabel="e" highlightLast />\n').text, /set nothing for highlightLast \(a Sparkline has none: drop it\)/)
})

test("core-chart runs again cleanly: an earlier TODO(chart) note is rewritten to what is still open, and dropped when nothing is", () => {
    const first = run('const A = () => (\n    <div>\n        <BarChart label="Per day" bars={b} empty={<Empty />} highlightLast valueAxis={{ format: f }} />\n    </div>\n)\n').text
    assert.match(first, /TODO\(chart\): BarChart is the ext chart now; set emptyLabel/)
    assert.equal(run(first).text, first)
    // A person writes the words: the next run drops the note.
    const fixed = first.replace("empty={<Empty />}", 'emptyLabel="No data"')
    assert.equal(run(fixed).text, 'const A = () => (\n    <div>\n        <BarChart ariaLabel="Per day" data={b} xKey="label" yKey="value" emptyLabel="No data" highlightLast formatY={f} />\n    </div>\n)\n')
    // An old 0.55.0 note naming empty, valueAxis and highlightLast is rewritten.
    const old = 'const A = () => (\n    <div>\n        {/* TODO(chart): BarChart is the ext chart now; set empty, valueAxis, highlightLast, emptyLabel (required, a string) */}\n        <BarChart ariaLabel="x" data={b} xKey="label" yKey="value" empty="None" valueAxis={{ format: f }} highlightLast />\n    </div>\n)\n'
    assert.equal(run(old).text, 'const A = () => (\n    <div>\n        <BarChart ariaLabel="x" data={b} xKey="label" yKey="value" emptyLabel="None" formatY={f} highlightLast />\n    </div>\n)\n')
})

test("only a Grammar element is touched: another library's Button, a local component and an unimported tag are left; an alias and a namespace are read", () => {
    const both = 'import { Button as HeroButton } from "@heroui/react"\nimport { Button } from "@starci/grammar/core"\nexport const A = () => (\n    <>\n        <HeroButton variant="ghost">Hero</HeroButton>\n        <Button variant="ghost">Grammar</Button>\n    </>\n)\n'
    assert.equal(bare(both).text, both.replace('<Button variant="ghost">', '<Button variant="border">'))
    const hero = 'import { Button } from "@heroui/react"\nexport const A = () => <Button variant="ghost" size="sm">x</Button>\n'
    assert.equal(bare(hero).text, hero)
    const heroNs = 'import * as Hero from "@heroui/react"\nimport * as G from "@starci/grammar"\nexport const A = () => <><Hero.Button variant="ghost">a</Hero.Button><G.Button variant="ghost">b</G.Button></>\n'
    assert.equal(bare(heroNs).text, heroNs.replace('<G.Button variant="ghost">', '<G.Button variant="border">'))
    const local = 'const Button = (props: { variant: string }) => null\nexport const A = () => <Button variant="ghost" />\n'
    assert.equal(bare(local).text, local)
    const alias = 'import { Button as GButton, IconButton as GIcon } from "@starci/grammar/core"\nexport const A = () => <><GButton intent="commit">a</GButton><GIcon variant="ghost" /></>\n'
    assert.equal(bare(alias).text, 'import { Button as GButton, IconButton as GIcon } from "@starci/grammar/core"\nexport const A = () => <><GButton variant="primary">a</GButton><GIcon variant="border" /></>\n')
    // The chart and avatar steps read the import the same way.
    const otherChart = 'import { BarChart } from "recharts"\nexport const A = () => <BarChart label="x" data={d} />\n'
    assert.equal(bare(otherChart).text, otherChart)
    const otherAvatar = 'import { Avatar } from "@heroui/react"\nexport const A = () => <Avatar size="lg" name="An" />\n'
    assert.equal(bare(otherAvatar).text, otherAvatar)
    const grammarAvatar = 'import { Avatar } from "@starci/grammar"\nexport const A = () => <Avatar size="lg" name="An" />\n'
    assert.equal(bare(grammarAvatar).text, grammarAvatar.replace('size="lg"', 'size="md"'))
})

test("Figure.trendLine is marked TODO(chart) in a file that uses the Grammar", () => {
    const code = 'import * as G from "@starci/grammar/core"\nconst f: G.Figure = { id: "r", term: "Revenue", value: 1, trendLine: [1, 2] }\n'
    const out = run(code)
    assert.match(out.text, /\/\* TODO\(chart\): trendLine is deleted in 0\.55\.0; use trendChart=/)
    assert.equal(run(out.text).text, out.text)
    const plain = 'const f = { trendLine: [1, 2] }\n'
    assert.equal(bare(plain).text, plain)
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

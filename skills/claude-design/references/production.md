# Producing the board: one lead, ten lanes

## Folder

Work in a folder outside every repository (the session's scratch or `D:/starci-tmp/<day>/<app>/mockup/`):

```
mockup/
  kit.css            the one stylesheet: board, frame, label, note, and the app's Grammar look as custom properties
  briefs/<page>.md   one brief per page, written by the lead
  pages/<page>.html  one fragment per page, written by its lane
  assemble.mjs       the node assembler
  index.html         the assembled board (published as the Artifact)
```

## kit.css (the lead)

- Board classes: `.board`, `.row`, `.frame` (with `data-w="1440"` or `data-w="390"`), `.frame-label`, `.note`.
- The Grammar look as custom properties taken from the app's brand.css and the Grammar's theme hooks: page
  ground, surface, hairline, text tones, the one accent, radius, control height, the type scale.
- Component classes that mirror Grammar roles (`.btn-primary`, `.btn-secondary`, `.field`, `.list-row`,
  `.badge[data-tone]`, `.table`, `.tabs`, `.sidebar`, `.empty`, `.skeleton`...), named after the role in
  `contexts/ui/components/`, so a lane draws roles, never styles.

## A brief (the lead)

```
# <Trang>
Mục tiêu: <business job, owner's words>
Dữ liệu: <the fields and 5-8 sample rows>
Trạng thái: <which of the eight apply; the ones left out and why>
Hành động chính: <one>
Lọc: <search, chips, sort>
Khác bản hiện tại: <from the gallery shot of the current screen>
Xung đột: <source A says, source B says, follow which and why>
```

## The lane prompt (Sonnet, one page each)

"Read mockup/kit.css and mockup/briefs/<page>.md. Write mockup/pages/<page>.html: one `.row` with the concept note
first, then for each state of the brief in the board's order a 1440 frame and its 390 frame, each with its label
`<Trang>, <trạng thái> · <w>`. Use only kit.css classes and custom properties: no `style` attribute with a colour or
a px length, no `<style>`, no `<script>`. One primary button per frame. Vietnamese sample data from the brief.
Redesign for the page's job; do not copy the current screen."

## assemble.mjs

Reads `kit.css` and `pages/*.html` in the page order of `briefs/`, refuses a fragment that holds `<style>`,
`<script>`, a hex or rgb colour, or a px length in a `style` attribute (exit 1 naming the file and line), and writes
`index.html` with the kit inlined and the rows in order.

## The lead's review

At full size, every row: the label format, all states present, both widths, one primary per frame, no card used as
a section frame, badges with meaning, the 390 frames really reflowed (not shrunk), the note's six clauses in order.
Fix by editing the fragment or the kit, reassemble, then publish the Artifact and report its link.

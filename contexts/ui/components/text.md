# Text

The type scale is [../presentation.md](../presentation.md); the contract holds no role for `Text`, a leaf of that scale.

## Job
Say words: a run of text at one of the type scale's steps, with `isStrong` for emphasis inside it. It is the leaf every
sentence is made of, and it is never a layout and never a heading.

## Choose

Choice `text.choose.role`: what a run of words is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| title of a group | the words name a group of blocks (a list, a table, a set of cards) | the group's own title: `Section` `title`, a card `label`, or `Heading` for a page outline level; never a strong `Text` | R358 |
| emphasis | one word or phrase in a sentence matters more than the rest | `Text isStrong` inside the sentence | judgement |
| copy | everything else | `Text` at the step the scale gives the place | judgement |

Choice `text.choose.content`: what may stand inside a `Text`. Words, `Badge`, `Icon`, a link or a strong span. A block (a `Stack`,
a card, a table, a list row, a plain `div` or `ul`) is a layout, and a layout is closed before the next one opens (R357).

## Size
One role, one size ([../presentation.md](../presentation.md#type) FONT-7): `md` 14 for all UI text (body, table cells, buttons, links, inputs, captions, hints), `sm` is
kept as a name and equals `md` (there is no 13), `xs` 12 muted only for small names (meta, badges, counts, timestamps), and
`isStrong` is weight 500 (a row's or a table's primary text is `<Text isStrong>`); hierarchy comes from weight and tone, not
size. `size="figure"` is the display size 20 of a big figure value. Measure: `check:type`
(`packages/grammar/scripts/check-type-roles.mts`). Words that stand on one line share one size step, and `sm` next to `md` is the same step (FONT-8, lint `starci-grammar/same-line-size`), and a table cell
or a list row takes the row type, never a size above 14 (FONT-9, lint `starci-grammar/table-cell-type`). A `Link` inside the
words inherits their size.

## States
Loading draws the words as a skeleton bar of the same step.

## Owner split
- **Grammar owns:** the step, the weight of `isStrong`, the colour pair of a tone.
- **Knowledge decides:** whether the words are a title or a sentence.
- **App author decides:** the words.

## Link and Sublabel
`Link` is HeroUI v3's own link: the primary colour, the underline on hover only, the anchor icon at the end of the label. It has no size: it inherits the type
size and leading of the line it stands in (14 in a body, 12 inside meta or caption text). Lint `starci-grammar/link-look` refuses a `size` prop and a size,
underline or decoration class on a Link.

`Sublabel` is the group label that sits above a card inside a section ("Được tự làm" above its card): 12, weight 500, muted, one short line. It is not a
heading. An app never builds it from a `Text` size and a weight.

## Rules
FONT-7..9. Lint: `starci-grammar/same-line-size`, `starci-grammar/table-cell-type`. R357 (`starci-grammar/text-inline-only`: a block inside `Text`), R358 (`starci-grammar/no-text-heading`: a strong `Text` that
only titles the blocks after it). A heading is the group's own title, so the outline, the level and the spacing come from the
component that owns them.

## Article headings are 14 (ARTICLE-HEADINGS-14, 0.37.14)
`MarkdownArticle` headings h2 to h4 follow the type law (14 for text, 12 for small names): all three are 14, ranked by weight and tone (h2 bold, h3 semibold, h4 semibold muted) and by the space above them; the heading elements and the outline stay. h1 is the article's own title.

## A one-line command has no language label (CODE-BLOCK-LANGUAGE, 0.37.15)
`FencedCodeBlock` draws its language label in the header only when it says something: a ONE-line `code` (a command to copy) hides it automatically and `showLanguage={false}` hides it for any block; the copy `action` stays either way. A multi-line block keeps its label.

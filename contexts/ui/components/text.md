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

## States
Loading draws the words as a skeleton bar of the same step.

## Owner split
- **Grammar owns:** the step, the weight of `isStrong`, the colour pair of a tone.
- **Knowledge decides:** whether the words are a title or a sentence.
- **App author decides:** the words.

## Rules
R357 (`starci-grammar/text-inline-only`: a block inside `Text`), R358 (`starci-grammar/no-text-heading`: a strong `Text` that
only titles the blocks after it). A heading is the group's own title, so the outline, the level and the spacing come from the
component that owns them.

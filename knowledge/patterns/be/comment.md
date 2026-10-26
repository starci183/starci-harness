---
slots: []
---
# Comment

Decides whether a back-end declaration or statement carries a comment, where it sits and what it says: responsibility and
consequence, never the name, and never a switch that turns a rule off.

## BE-COMMENT-1 Every export has a docblock, placed after the decorators
Every export carries an English docblock. On a decorated class the block sits between the class decorators and `export class`.

Why: the docblock is what an editor shows at every call site.

Enforced by: R89 BE_SOURCE_FORM.

## BE-COMMENT-2 The docblock states responsibility and invariant, not the name
A docblock explains why the declaration exists, what must not happen, who throws it or why a field is nullable; it never restates
the name.

Why: a restated name adds noise and hides the missing reason.

- "Thrown by `QuotaService.consume` when no allowance remains in any sliding window."
- "`order` is null when the credit check refuses, because the result carries the refusal in `reason` instead of throwing."

Enforced by: R89 BE_SOURCE_FORM (restated-name check); whether it says something the name does not is review.

## BE-COMMENT-3 Methods and fields
Methods and declared class, interface and type fields carry non-empty responsibility docblocks; generic parameters have named
`@template` docs. Parameter, return and cross-reference notes are added where useful.

Why: public surface without a stated responsibility cannot be reviewed.

Enforced by: R109 BE_MEMBER_DOC_MISSING, R89 BE_SOURCE_FORM.

## BE-COMMENT-4 Enum members are each documented
Every enum member has a docblock.

Why: a serialized value needs its meaning stated where it is defined.

Enforced by: R89 BE_SOURCE_FORM.

## BE-COMMENT-5 Line comments are prose about why
Prose line comments sit above the code and start with a lowercase ASCII letter; they state the reason or consequence
(`// idempotent add, because a second row would violate UQ_order_lines_order_sku`). Triple-slash compiler references are
metadata.

Why: a comment that says what the next line does adds nothing; the reason is what the code cannot say.

Enforced by: R89 BE_SOURCE_FORM.

## BE-COMMENT-6 Block comments carry multi-paragraph reasoning
Reasoning inside a body that needs more than a line is a block comment starting with a capital ASCII letter: the claim, its
evidence and, where it helps, the corrected earlier reading.

Why: a claim with its evidence lets the next reader trust or replace the code.

Enforced by: R89 BE_SOURCE_FORM.

## BE-COMMENT-7 What a comment never contains
Comments are ASCII English with no emoji or AI symbols; text in another language lives only in `messages/` catalogs and the
i18n fixtures slot. No inline suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, escape annotations): a
wrong rule is changed in the harness, never switched off in a file.

Why: an inline switch turns a rule into a convention; with no exception mechanism, the only fix is the code or the rule.

Enforced by: R18 HFS_INLINE_SUPPRESSION, R89 BE_SOURCE_FORM, R96 HFS_DOC_NOT_ENGLISH, R303 HFS_BYPASS_MARKER.

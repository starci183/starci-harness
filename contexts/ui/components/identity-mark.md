# Identity mark: Avatar and IconTile

Contract: [Avatar and IconTile](../../grammars/contract.md#avatar). Vendor: [Avatar](../../vendor/heroui.md#avatar).

## Job
A compact anchor that helps the reader scan peers, always beside the visible name it belongs to.

## Choose

Choice `identity-mark.choose.role`: which mark anchors the name.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| outcome | the mark would report an outcome | a toned `Badge` (`chip.choose.role:state`), not a tile (ACCENT-5) | judgement |
| group | a group or conversation | the grammar's group composite of member identities (COLLECTION-3) | `DNA-COMMON-AVATAR-GROUP-ONE-SIZE` |
| connections | the provider connections an agent or a workspace uses | `LogoStack`: round 20px logos with no plate, at most 3 then "+N", an optional muted xs `caption`; static, or one plain pressable (`onPress`, or `isTrigger` as a `DropdownMenu` trigger); an app's own content as a trigger is the exported `PlainPressable` | judgement |
| person | a person or an agent | `Avatar`: uploaded image, else the grammar's generated initials; an agent adds the bot badge | `DNA-COMMON-AVATAR-INITIALS`, `DNA-COMMON-AGENT-NAMED` |
| floating | the reader's own identity as a floating entry point (an account or assistant launcher over the page) | `AvatarButton size="floating"` (56px, overlay shadow) with `status={{ tone, label }}`: a StatusDot at the top end on a surface ring, its `label` the button's accessible description | story `Navigation & Data/Spotlight/AvatarButtonFloating` |
| kind | a feature, product area or entity kind | `IconTile` with a reviewed semantic glyph | candidate: an `IconTile` is painted neutral |

## Variants
Tiles are neutral; a tile takes a status tone only when it reports a real outcome, never accent for identity
(ACCENT-2). The mark never replaces the name.

## Size
Avatars sit on the ramp (`sm`, `md`, `lg`, `control` in bars). A tile matches the line box of the copy it anchors:
`sm` beside one line, `md` beside a title with a description ([../scale.md](../scale.md)).

## States
Skeleton keeps the mark's footprint.

## Owner split
- **Grammar owns:** initials generation, colour seeding (identity art: a stable palette chosen by seed, which the app's
  tokens never recolour), group cells, bot badge, shapes and sizes.
- **Knowledge decides:** avatar vs tile vs badge; tile tone; step by copy.
- **App author decides:** the identity data (name, id, image) and the glyph's meaning.

## Initials fit the circle
An avatar's generated initials are set at 40% of the mark, so two wide capitals stay inside the circle.

## Rules
ACCENT-2, COLLECTION-3, FE-APP-SHELL-3. Proof: TASTE-5, A11Y-2.

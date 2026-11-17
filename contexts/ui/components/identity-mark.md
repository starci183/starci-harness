# Identity mark: Avatar and IconTile

Contract: [Avatar and IconTile](../../grammars/contract.md#avatar). Vendor: [Avatar](../../vendor/heroui.md#avatar).

## Job
A compact anchor that helps the reader scan peers, always beside the visible name it belongs to.

## Choose

Choice `identity-mark.choose.role`: which mark anchors the name (an avatar or initials for a user, a logo stack, an icon tile).

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

## Plates of an initials mark (0.46.0)
An `Avatar` with no image draws a generated mark (default) or the name's initials on a plate: `tone="accent"` (the accent soft pair), `tone="solid"` (the solid accent plate, `--accent` with `--accent-foreground`: the brand mark) and `tone="strong"` (the neutral strong plate, `--foreground` with
`--background`: the signed-in person among the others). `AvatarButton` forwards `fallbackMark` (`"initials"`) and `tone` to its avatar, so the account control of a bar is a strong lettered circle. `IdentityLockup markTone="solid"` draws the brand mark as the solid plate beside the name
(`accent` stays the soft one). A tone is a fact of the mark (whose it is), never a decoration: one solid plate per screen, the brand's.
Evidence (Rule 1): NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/pages/01-shell-app.html``:9` (`.logo`: the accent plate with a white letter), `:20` and `:24` (the lettered avatar and `.av.me`, the viewer's dark plate), `:216` (the bar's logo and account avatar). Story `Navigation/Shell gaps (0.46.0)` `AvatarPlates`.

**The workspace switcher** (a lettered tile, the name and a caret, `:12`, `:216`) is composed, not a Button feature: `DropdownMenu` or `Popover` with an `IdentityLockup` (a lettered mark, the name, a muted line) as its `trigger`, in the bar's `brand` slot. `Button` is not extended: its start slot is the primary's alone and a switcher is not a command.
A caret on the lockup is not provided (the lockup is drawn with no caret or button chrome); an app that wants one asks for it.

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
An avatar with no image draws a DiceBear Sprouts image seeded by its `seed` (else its name), for a person, an agent, a product or a shop alike: drawn locally, cached per seed, the same seed always the same image, clipped by the avatar's own shape (circle or rounded square). `fallbackMark="initials"` is the explicit opt-in for the name's letters, set at 40% of the mark so two wide capitals stay inside the circle. Only Grammar imports `@dicebear`.

## Rules
ACCENT-2, COLLECTION-3, FE-APP-SHELL-3. Proof: TASTE-5, A11Y-2.

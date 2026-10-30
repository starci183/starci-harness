# Backdrop

Contract: [Backdrop](../../grammars/contract.md#backdrop). Vendor: none (a Common region).

## Job
Give the brand its own ground in a split screen: the brand's light tint, full-bleed in its host, carrying the brand copy
and the character art, with no card around it.

## Choose

Choice `backdrop.choose.ground`: what carries a brand moment.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| split | a split screen gives the brand its own half or column (a sign-in or sign-up split) | `Backdrop` filling that half, the copy as children, the hero `Mascot` as `artwork` | judgement |
| card | the brand moment holds a task's copy or controls among other content (a first-run welcome) | a `SurfaceCard` `treatment="soft"` with `artwork` ([card](card.md)) | judgement |

Choice `backdrop.choose.corner`: whether one corner stands out.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| accent | the brand record draws the backdrop with one rounded corner (the corner toward the task half) | `accentCorner` naming that logical corner | judgement |
| square | otherwise | no `accentCorner` | judgement |

## Variants
The ground is always the brand's light tint; the app chooses only the accent corner, the copy and the art.

## Size
It fills its host (block size 100%); the copy sits at the top at the page inset and the artwork takes the height left,
so a hero `Mascot` fills it.

## States
None of its own; the art keeps the Mascot's states.

## Owner split
- **Grammar owns:** the tint, the inset, the copy and artwork zones, the accent radius `--grammar-accent-corner`.
- **Knowledge decides:** backdrop vs soft card (the table above); the mascot's place within DISCIPLINE-3.
- **App author decides:** the host region, the corner, the brand copy, the art's asset slot.

## Rules
BRAND-2, DISCIPLINE-3; ruling backdrop, ruling accent-corner; lint R338 and R339 on its art.

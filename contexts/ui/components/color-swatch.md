# Color swatch

Contract: [ColorSwatch](../../grammars/contract.md#colorswatch). Vendor: [ColorSwatch](https://heroui.com/en/docs/react/components/color-swatch).

## Job
Preview one actual color value as content, with an accessible name.

## Choose

Choice `color-swatch.choose.role`: what the color means.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| value | a palette, material sample or color specification reports an actual value | `ColorSwatch` with the data `color` and an accessible `label`, beside visible name and value copy | the preview reports the actual value; the words remain available without color perception |
| state | color communicates an operational outcome or category | the existing `Badge`, `StatusDot` or state carrier with its semantic tone | status keeps words and a non-color cue |

## Anatomy and states

The vendor owns the swatch and its transparency checkerboard. Grammar uses one small square preview; the app supplies
no size, shape, style, class or children. `isLoading` retains that preview's geometry under the existing inert skeleton.
The swatch selects nothing and starts no drag. An existing `Cluster` groups the preview with its visible copy.

## Owner split

- **Grammar owns:** the vendor preview, its fixed role size and shape, and loading geometry.
- **App owns:** the literal color data, its accessible name and accompanying visible value.

The value is content, so it does not become a theme token or a status tone.

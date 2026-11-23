# Charts: BarChart, LineChart, AreaChart, DonutChart, Sparkline (`@starci/grammar/core/ext/recharts`)

Contract: [Charts](../../grammars/contract.md#charts). Vendor: [small members](../../vendor/heroui.md#small-members) (Skeleton). Library: recharts, pinned in `contexts/stack/pins.yaml`.

## Job
Draw a measure over a category or a date as a chart or a sparkline, in the grammar's tokens. Use for charts only.
Apps use this extension for EVERY chart and sparkline: never hand-drawn SVG, never `recharts` imported directly
(`DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`, lint `starci-grammar/ext-boundary` and `starci-grammar/no-graph-or-animation-library`).

## Where it lives
An ext of the core grammar: `import { AreaChart, BarChart, DonutChart, LineChart, Sparkline } from "@starci/grammar/core/ext/recharts"`. It imports
core's components and tokens; core never imports it. `recharts` is an OPTIONAL peer dependency of `@starci/grammar`
(`peerDependenciesMeta.optional`): an app that draws charts installs it at the pinned version.

## Choose

| Row | When | Choose |
| --- | --- | --- |
| trend beside a number | a few to a few dozen points, no axes needed | `Sparkline` (fixed 32px high, width of its box, neutral line; nothing for no data or all zeros) |
| amounts to compare | one value per category or period | `BarChart` |
| a measure over time | one value per date | `LineChart` |
| activity over time | one or a few counts per date, read as volume (lessons done, messages sent); stacked when the series add up to a total | `AreaChart` (`series`, `stacked`) |
| parts of one whole | two to six shares of a total (topics, progress, done and left) | `DonutChart` (centre figure, legend of value and share); past six parts the rest fold into Other |

## API
- `data` (rows), `xKey`, `yKey`: the keys read from each row.
- `tone`: `default | accent | info | success | warning | danger`, painted by that tone's token. Default `accent`.
- `ariaLabel` (required): the chart is one image named by it. `emptyLabel` (required): the words shown when `data` is empty.
- `xAxisLabel`, `yAxisLabel`, `seriesLabel` (tooltip), `formatX`, `formatY`: words and number/date formatting come from the app, never from the chart.
- `height` (px, default 240; width is the container's). `Sparkline` has no axes, grid or tooltip, no `tone` and no `emptyLabel`, and a fixed height; it takes the full width of its box, in a figure cell too (`Figure.trendChart`), so it needs no fixed-width wrapper. Its line is always the neutral muted ink, never a status colour: the words beside it carry the direction, and the status colour stands on those words only (`Figure.trend`). No data, or a series of zeros only, draws no line and no box (a flat line on the floor reads as "dropping"): the figure is words only ("Same as yesterday").
- `BarChart highlightLast`: the latest period apart, the last bar in the full tone and the others in its soft pair (`chartToneSoftColor`); the chart's name ends with the latest value (`ariaLabel`, then `formatX` and `formatY` of the last row). Use it for a weekly or daily series whose question is the latest period.
- `isLoading` draws a Grammar `Skeleton` of the chart's box; inside a loading region it follows the region.
- `AreaChart`: the `LineChart` props (`data`, `xKey`, `yKey`, `tone`, the axis words) plus `series` (further `{ key, label, tone? }`
  of the same rows, an untoned one taking the next tone of the categorical order `accent, success, warning, danger, info`) and
  `stacked`. With more than one series a legend names each under the image, and the tooltip lists each series.
- `DonutChart`: `data` of `{ label, value, tone? }` (a part that is not positive is left out), `ariaLabel`, `emptyLabel`, `isLoading`,
  `centerFigure` (the `figure` role, e.g. a total or "68%") and `centerCaption` (`caption`), `otherLabel` (the app's copy, e.g.
  "Khác"; default "Other"), `maxSegments` (2 to 6, default 6), `formatValue`, `formatShare` (given whole percents that add up to 100)
  and `size` (the ring's diameter, default 160). Past `maxSegments` the largest parts stay in the app's order and the rest fold into
  Other, last and muted. `donutSlices` returns the parts the ring draws.

## Look
Series are tone tokens; grid and axis lines are `--separator`; ticks and axis titles are muted text at the `caption` role;
the tooltip is a Grammar surface with a separator hairline and NO shadow. An area's fill is its own series token through a top-down
gradient from `--grammar-opacity-faded` to none (to `--grammar-opacity-dimmed` when stacked). A donut's parts are tone tokens split
by a 2px `--surface` stroke; Other is the muted tone. The drawing is the one named image; a legend (names `body`, values `body`
strong, shares `caption`) and a donut's centre are real text beside it, so every value the image draws is read as text too. The box keeps its height in every state. At 390 the chart
is the same drawing, narrower.

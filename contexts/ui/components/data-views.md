# Data views

Contract: [data-views](../../grammars/contract.md#data-views).

## Meter reading voice (0.46.0)
`Meter labelTone="muted"` is the quiet reading of a secondary gauge (a usage line at the foot of a rail, under a footer): the label and the value muted, 12 regular; the default stays the foreground label at 14 medium. It colours words only (`tone` colours the fill). Not made the default: a headline gauge keeps its
label. Evidence (Rule 1): NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/pages/01-shell-app.html``:208` ("Credit tháng này 7.200 / 10.000": a muted 12 label and value over a 4px bar). Story `Navigation/Shell gaps (0.46.0)` `QuietMeter`.

## Job
Draw a set of items as stages, as entries on two axes, or as a few amounts to compare, in the four states of a region.

## Choose

Choice `data-views.choose.view`: which view a set of items takes. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| board | the items move through named stages and the reader scans each stage | `Board`: one column per stage with its count, each item an object card; an empty stage says so in place | `DNA-COMMON-BOARD-ONE-WIDTH` |
| schedule | each item belongs to a time or a place on two axes (a week by hour, a month, people by day) | `ScheduleGrid`: columns and rows named, items placed by both; a phone reads it as an agenda | `DNA-COMMON-SCHEDULE-HEADINGS` |
| bars | a handful of amounts is compared on one scale (per day, per channel) | `BarChart`: the value is real text over each bar, no legend; `valueAxis={{ format }}` adds three ticks (the largest, its half, 0) with light grid lines, decorative, and `highlightLast` paints the last bar in the accent and the others in the soft accent | `DNA-COMMON-BAR-CHART-ONE-SCALE` |
| trend | the shape of one measure over time, small enough to sit beside a number or in a row | `Sparkline` (96 x 32, one accent stroke, soft fill, no axis; `label` required, `values` oldest first, fewer than two draw a flat baseline); under a figure it is `Figure.trendLine` | story `Navigation & Data/Data views/SparklineStates` |
| proportion | the parts of one whole are told at a glance (receivables by age, a share by channel) | `ProportionBar`: one track split by share, a legend with the dot, the label and the amount as real text; no axis, no percentage | candidate |
| ranges | a few rows each carry a measured range and its best reading, read against one reference row (variants against the control, plans against the current one) | `IntervalChart`: a row per label with its range as a bar in the row's soft tone, the point as a mark in the tone itself, one dashed line through every row at the reference row's point (`isReference`; its label says so in words), the value as real text at the row's end and the two scale ends under the plots; `tone` per row is the app's reading, never the chart's verdict; below 33rem of chart width each row stacks, the label and value over the plot | `DNA-COMMON-INTERVAL-CHART-ONE-SCALE`, `DNA-COMMON-INTERVAL-CHART-REFERENCE-ONE-LINE`, `DNA-COMMON-INTERVAL-CHART-STACKS-NARROW` |
| list | the items have no stage, place or comparison | `Section kind="list"` ([list-table](list-table.md)) | judgement |
| figures | one to five numbers each stand alone | `Section kind="figures"`, the ribbon ([composition](../composition.md) COLLECTION-4); a figure may carry `trend` (`up`, `down`, `flat`, with `trendSense`, `trendLabel`) and `trendLine` (a Sparkline); the value is the display size 20, its label and meta 14 | judgement |

Choice `data-views.choose.state`: how a view answers while it is not ready. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| loading | the first read has no data | `isLoading` on the view (or its band): the columns, headings and labels given stay real and the entries draw as geometry | story `navigation-data-data-views--*` |
| error | the read failed | the `error` slot: the view's place shows the failure with its retry | story `navigation-data-data-views--*` |
| empty | the read finished with nothing | the `empty` slot, one action at most ([empty-state](empty-state.md)) | `DNA-COMMON-EMPTY-ACTIONS` |

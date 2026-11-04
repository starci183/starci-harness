# Data views

Contract: [data-views](../../grammars/contract.md#data-views).

## Job
Draw a set of items as stages, as entries on two axes, or as a few amounts to compare, in the four states of a region.

## Choose

Choice `data-views.choose.view`: which view a set of items takes. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| board | the items move through named stages and the reader scans each stage | `Board`: one column per stage, each a card of rows with its count; an empty stage says so in place | `DNA-COMMON-BOARD-ONE-WIDTH` |
| schedule | each item belongs to a time or a place on two axes (a week by hour, a month, people by day) | `ScheduleGrid`: columns and rows named, items placed by both; a phone reads it as an agenda | `DNA-COMMON-SCHEDULE-HEADINGS` |
| bars | a handful of amounts is compared on one scale (per day, per channel) | `BarChart`: the value is real text over each bar, no axis or legend | `DNA-COMMON-BAR-CHART-ONE-SCALE` |
| list | the items have no stage, place or comparison | `Section kind="list"` or `SurfaceCard kind="list"` ([list-table](list-table.md)) | judgement |
| figures | one to five numbers each stand alone | `SurfaceCard kind="figures"` ([card](card.md)) | judgement |

Choice `data-views.choose.state`: how a view answers while it is not ready. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| loading | the first read has no data | `isLoading` on the view (or its band): the columns, headings and labels given stay real and the entries draw as geometry | story `navigation-data-data-views--*` |
| error | the read failed | the `error` slot: the view's place shows the failure with its retry | story `navigation-data-data-views--*` |
| empty | the read finished with nothing | the `empty` slot, one action at most ([empty-state](empty-state.md)) | `DNA-COMMON-EMPTY-ONE-ACTION` |

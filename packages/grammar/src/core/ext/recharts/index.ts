"use client"

/**
 * `@starci/grammar/core/ext/recharts`: the charts extension of the core grammar (BarChart, LineChart, AreaChart, DonutChart, Sparkline). An app draws EVERY chart and sparkline with it, never
 * with hand-drawn SVG and never with `recharts` imported directly (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY). It imports core's components
 * and tokens; core never imports it. `recharts` is an optional peer dependency: install it only in an app that draws charts.
 */
export { AreaChart, type AreaChartProps, type AreaChartSeries } from "./AreaChart.js"
export { BarChart, DEFAULT_CHART_HEIGHT, barFills, type BarChartProps } from "./BarChart.js"
export { DEFAULT_DONUT_SIZE, DEFAULT_OTHER_LABEL, DONUT_MAX_SEGMENTS, DONUT_RING_WIDTH, DonutChart, donutSlices, type DonutChartProps, type DonutSegment, type DonutSlice } from "./DonutChart.js"
export { LineChart, type LineChartProps } from "./LineChart.js"
export { Sparkline, SPARKLINE_HEIGHT, type SparklineProps } from "./Sparkline.js"
export { CHART_CATEGORY_TONES, CHART_TONES, CHART_TONE_TOKEN, chartCategoryTone, chartToneColor, chartToneSoftColor, type ChartTone } from "./tokens.js"
export type { ChartAxisProps } from "./Axes.js"
export type { ChartBaseProps, ChartFormatters, ChartLegendItem, ChartRow } from "./shared.js"

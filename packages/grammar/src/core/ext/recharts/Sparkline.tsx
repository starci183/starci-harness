"use client"

import { Line, LineChart as RechartsLineChart, ResponsiveContainer, YAxis } from "recharts"
import { INITIAL_WIDTH } from "./BarChart.js"
import { ChartFrame, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { chartToneColor } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

export type SparklineProps<Row extends ChartRow> = NoChildren & Pick<ChartBaseProps<Row>, "data" | "xKey" | "yKey" | "ariaLabel" | "isLoading">

/** A sparkline is a fixed small height (px); its width is the container's. */
export const SPARKLINE_HEIGHT = 32

/**
 * Whether the series is a trend worth a line: at least one point and at least one number that is not zero. No data and a flat-zero
 * series read as "dropping" when drawn (the line lies on the floor), so they are drawn as nothing and the words beside the line
 * say "no change".
 */
const hasTrend = <Row extends ChartRow>(data: readonly Row[], yKey: keyof Row & string): boolean => data.some((row) => readY(row, yKey) !== 0)

/**
 * EXT - `Sparkline`: a bare trend line with no axes, grid or tooltip, a fixed small height, always the neutral muted ink (a line is
 * never a status colour: the words beside it carry the direction and the status). No data, or a series of zeros only, draws nothing at
 * all, not even its box; loading draws a Skeleton of the box.
 */
export const Sparkline = <Row extends ChartRow>({ data, xKey, yKey, ariaLabel, isLoading }: SparklineProps<Row>) =>
    isLoading !== true && !hasTrend(data, yKey) ? null : (
        <ChartFrame component="Sparkline" ariaLabel={ariaLabel} emptyLabel="" isLoading={isLoading} isEmpty={false} height={SPARKLINE_HEIGHT}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height: SPARKLINE_HEIGHT }}>
                <RechartsLineChart data={[...data]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <YAxis hide domain={["dataMin", "dataMax"]} />
                    <Line dataKey={(row: Row) => readY(row, yKey)} name={xKey} stroke={chartToneColor("default")} strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
                </RechartsLineChart>
            </ResponsiveContainer>
        </ChartFrame>
    )

"use client"

import { Line, LineChart as RechartsLineChart, ResponsiveContainer, YAxis } from "recharts"
import { INITIAL_WIDTH } from "./BarChart.js"
import { ChartFrame, readY, type ChartBaseProps, type ChartRow } from "./shared.js"
import { chartToneColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

export type SparklineProps<Row extends ChartRow> = NoChildren & Pick<ChartBaseProps<Row>, "data" | "xKey" | "yKey" | "ariaLabel" | "emptyLabel" | "isLoading"> & {
    /** The line colour, one of Grammar's tones. Default `accent`. */
    readonly tone?: ChartTone
}

/** A sparkline is a fixed small height (px); its width is the container's. */
export const SPARKLINE_HEIGHT = 32

/** EXT - `Sparkline`: a bare trend line with no axes, grid or tooltip, a fixed small height and the series tone. */
export const Sparkline = <Row extends ChartRow>({ data, xKey, yKey, tone = "accent", ariaLabel, emptyLabel, isLoading }: SparklineProps<Row>) => (
    <ChartFrame component="Sparkline" ariaLabel={ariaLabel} emptyLabel={emptyLabel} isLoading={isLoading} isEmpty={data.length === 0} height={SPARKLINE_HEIGHT}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: INITIAL_WIDTH, height: SPARKLINE_HEIGHT }}>
            <RechartsLineChart data={[...data]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Line dataKey={(row: Row) => readY(row, yKey)} name={xKey} stroke={chartToneColor(tone)} strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
            </RechartsLineChart>
        </ResponsiveContainer>
    </ChartFrame>
)

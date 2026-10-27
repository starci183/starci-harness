import type { StorybookConfig } from "@storybook/react-vite"

/**
 * Stories draw each block's pure half (`XBase`) from fixture props: one story per drawn shape and one loading story per
 * block, paired by `parameters.dna` for the skeleton-parity gate. The app's own `vite.config.ts` (Tailwind, the `@contract`
 * alias) is picked up as is.
 */
const config: StorybookConfig = {
    stories: ["../stories/**/*.stories.tsx"],
    framework: "@storybook/react-vite",
}

export default config

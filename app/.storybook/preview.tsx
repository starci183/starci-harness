import type { Decorator, Preview } from "@storybook/react-vite"
import { CoreGrammarRoot, PageContainer } from "@starci/grammar/core"
import "../src/app/styles.css"

/** Every story renders inside the app's own Grammar root and page inset, as the routed pages do. */
const withAppRoot: Decorator = (Story) => (
    <CoreGrammarRoot theme="light" className="app-root">
        <PageContainer measure="full" className="app-page">
            <Story />
        </PageContainer>
    </CoreGrammarRoot>
)

const preview: Preview = {
    decorators: [withAppRoot],
    parameters: { layout: "fullscreen" },
}

export default preview

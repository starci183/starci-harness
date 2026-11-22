/** The specs render on the server with `react-dom/server`; the package carries no `@types/react-dom`, so the one call they make is typed here. */
declare module "react-dom/server" {
    export function renderToStaticMarkup(node: unknown): string
}

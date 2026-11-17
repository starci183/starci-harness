import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import "./app.css"

const mount = document.querySelector("#root")
if (mount !== null) {
    createRoot(mount).render(
        <StrictMode>
            <App />
        </StrictMode>,
    )
}

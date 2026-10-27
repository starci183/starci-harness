import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app/router"
import "./app/styles.css"

const root = document.getElementById("root")
if (root === null) throw new Error("index.html has no #root")
createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
)

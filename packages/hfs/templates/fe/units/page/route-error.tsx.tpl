"use client"

import { {{ErrorName}} } from "@/features/pages/{{ErrorName}}"

type ErrorProps = { readonly reset: () => void }

/** The {{route}} route's error boundary slot: it mounts the route's error page and hands it the segment's retry. */
const ErrorBoundary = (props: ErrorProps) => <{{ErrorName}} onRetry={props.reset} />

export default ErrorBoundary

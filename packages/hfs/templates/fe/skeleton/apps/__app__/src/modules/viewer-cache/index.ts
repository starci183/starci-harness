import { createViewerCache, type ViewerCache } from "@starci/next-data"

/** The writes to the cache of the viewer on screen: the one instance of the app, bound by the client providers. */
export const viewerCache: ViewerCache = createViewerCache()

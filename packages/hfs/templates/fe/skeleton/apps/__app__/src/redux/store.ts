import { configureStore, type EnhancedStore } from "@reduxjs/toolkit"
import { sessionReducer, type SessionState } from "./slices/session"

/** The state of the store, for useAppSelector: one slice per key of the root reducer. */
export interface RootState {
    readonly session: SessionState
}

/** The one store of the app: app-wide shared state only (feature-local state lives in hooks/zustand). */
export const store: EnhancedStore<RootState> = configureStore({
    reducer: {
        session: sessionReducer,
    },
})

/** The dispatch of the store, for useAppDispatch. */
export type AppDispatch = typeof store.dispatch

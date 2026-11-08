"use client"

import { create, type StoreApi, type UseBoundStore } from "zustand"

/** The home guide's local UI state; it carries no session or server data. */
type AppGuideState = {
    readonly isOpen: boolean
    readonly setOpen: (isOpen: boolean) => void
}

/** One feature-local store, shared by the guide trigger and its controlled dialog. */
export const useAppGuideStore: UseBoundStore<StoreApi<AppGuideState>> = create<AppGuideState>()((set) => ({
    isOpen: false,
    setOpen: (isOpen) => set({ isOpen }),
}))

import { useDispatch, useSelector } from "react-redux"
import type { UseDispatch, UseSelector } from "react-redux"
import type { AppDispatch, RootState } from "./store"

/** The typed dispatch of the app's store. */
export const useAppDispatch: UseDispatch<AppDispatch> = useDispatch.withTypes<AppDispatch>()

/** The typed selector of the app's store. */
export const useAppSelector: UseSelector<RootState> = useSelector.withTypes<RootState>()

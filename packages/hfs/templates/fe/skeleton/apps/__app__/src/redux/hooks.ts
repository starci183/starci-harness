import { useDispatch, useSelector, type UseDispatch, type UseSelector } from "react-redux"
import type { AppDispatch, RootState } from "./store"

/** The typed dispatch of the app's store. */
export const useAppDispatch: UseDispatch<AppDispatch> = useDispatch.withTypes<AppDispatch>()

/** The typed selector of the app's store. */
export const useAppSelector: UseSelector<RootState> = useSelector.withTypes<RootState>()

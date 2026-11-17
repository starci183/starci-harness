import { capitalize } from "../labels.ts"
import { data } from "./data.ts"

/** A label derived from a folder name, a state name or a title, capitalized for display in the app's locale. */
export const cap = (text: string): string => capitalize(text, data.locale)

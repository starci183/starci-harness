/**
 * The mode is the app's, not the Grammar's: HeroUI and the Grammar read `.dark` on `html`. This follows the reader's
 * system scheme and returns the function that stops following it.
 */
export const followSystemMode = (): (() => void) => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", scheme.matches)
    apply()
    scheme.addEventListener("change", apply)
    return () => scheme.removeEventListener("change", apply)
}

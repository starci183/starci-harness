/** Every internal destination the web app links to, named once. */
export const APP_ROUTES = {
    home: "/",
    signup: "/auth/signup",
    resend: "/auth/resend",
    forgot: "/auth/forgot",
    confirm: "/auth/confirm",
    reset: "/auth/reset",
} as const

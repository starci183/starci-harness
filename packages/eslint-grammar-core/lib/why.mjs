/** Failure-code guidance for the selected Grammar family contract. */
export const why = {
  "app-shell-frame": {
    code: "FE_APP_SHELL_FRAME",
    en: "The app frame must use Grammar WorkspaceShell with its fixed viewport.",
    fix: "Compose WorkspaceShell viewport=\"fixed\" and supply its header, navigation and primary slots.",
  },
  "navbar-cluster": {
    code: "FE_NAVBAR_CLUSTER",
    en: "Navbar action component kinds or order differ from the app-shell canon.",
    fix: "Compose Language IconButton, theme Switch, notification IconButton and account AvatarButton in that order.",
  },
  "navbar-control-size": {
    code: "FE_NAVBAR_CONTROL_SIZE",
    en: "A navbar control does not use Grammar's shared control height.",
    fix: "Set size=\"control\" on every visible bar control.",
  },
  "no-navbar-create": {
    code: "FE_NAVBAR_CREATE",
    en: "A create action is composed into the global navbar.",
    fix: "Move the create action to the page that owns it.",
  },
  "no-raw-structural-element": {
    code: "FE_NATIVE_FORM_CONTROL",
    en: "Raw `<tag>` in `<file>`. Page structure and text are composed from grammar components, not hand-written HTML.",
    fix: "Replace it with the matching grammar component (`Heading`, `Text`, `SurfaceCard`, ...); if grammar lacks it, add it to grammar or the ui package instead of drawing it in place.",
  },
  "no-shell-bottom-tabs": {
    code: "FE_APP_SHELL_BOTTOM_TABS",
    en: "Bottom tab navigation replaces the required mobile sidebar drawer.",
    fix: "Use WorkspaceShell navigationDrawer and Sidebar presentation=\"drawer\".",
  },
  "status-text-uses-soft-foreground": {
    code: "FE_STYLE_TOKEN_ONLY",
    en: "`<file>` paints text or an icon with a solid status tone (`<what>`, e.g. `text-success`). A solid tone is a background colour; used as a text colour it reads below 4.5:1 on the page background.",
    fix: "Switch to the soft pair: `text-<tone>-soft-foreground` (with `bg-<tone>-soft` when it sits on a light surface); a solid tone is used only with `bg-<tone>` and `text-<tone>-foreground`.",
  },
}

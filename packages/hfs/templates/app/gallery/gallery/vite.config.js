import { defineGallery } from "@starci/gallery/vite"

// The whole gallery of {{project}} is this config over @starci/gallery: it reads gallery/pages, flows.json and the design canvas (../.starcistacks/canvas by default).
// The server binds the IPv4 loopback: the dev tunnel routes to http://127.0.0.1:<port>, which an IPv6-only bind (::1) refuses with a 502. `allowedHosts` is
// the tunnel hosts the stack declares for the gallery (`local.tunnel.routes[]` named `gallery`); Vite answers 403 to any other Host.
export default defineGallery({
    app: "{{project}}",
    locale: "{{galleryLang}}",
    allowedHosts: {{galleryAllowedHosts}},
})

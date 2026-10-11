import type { MetadataRoute } from "next";

/**
 * Lets a merchant add the portal to their phone's home screen. It opens on
 * Today, full screen, in the portal's background color. Icons are in public/icons
 * (icon.svg is the source).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Last Call for stores",
    short_name: "Last Call",
    description: "Sell what's left of today's batch before close, to nearby students, with one message.",
    id: "/today",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

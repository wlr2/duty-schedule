import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Full PWA icons are added in Step 6.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DutyRoster",
    short_name: "DutyRoster",
    description: "Smart duty scheduling, leave management, and instant coverage.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
  };
}

"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";

export function ExportImageButton({
  targetId,
  filename,
}: {
  targetId: string;
  filename: string;
}) {
  const [busy, setBusy] = useState<"theme" | "light" | null>(null);

  async function handleExport(forceLight: boolean) {
    const node = document.getElementById(targetId);
    if (!node || busy) return;
    setBusy(forceLight ? "light" : "theme");

    const html = document.documentElement;
    const wasLight = html.classList.contains("light");
    try {
      const { toPng } = await import("html-to-image");

      // Print copy: flip the whole page to the light theme for the capture.
      if (forceLight && !wasLight) {
        html.classList.add("light");
        await new Promise((r) => setTimeout(r, 250)); // let styles settle
      }

      // Force the clone wide enough that the (normally scrollable) table isn't
      // clipped, so the exported image shows the whole roster.
      let width = node.clientWidth;
      node.querySelectorAll("table").forEach((t) => {
        width = Math.max(width, (t as HTMLElement).scrollWidth);
      });
      width += 32; // padding breathing room

      const themeBg = getComputedStyle(document.body).backgroundColor || "#0a0a0c";
      const dataUrl = await toPng(node, {
        backgroundColor: themeBg,
        pixelRatio: 2,
        cacheBust: true,
        width,
        style: { width: `${width}px` },
        // Skip UI-only bits (e.g. the day-jump strip) in the image.
        filter: (n) =>
          !(n instanceof HTMLElement && n.hasAttribute("data-html2image-ignore")),
      });

      const link = document.createElement("a");
      link.download = forceLight ? filename.replace(/\.png$/, "-print.png") : filename;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Roster image export failed:", err);
      alert("Sorry, the image export failed. Please try again.");
    } finally {
      if (forceLight && !wasLight) html.classList.remove("light");
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex gap-2">
      <button
        onClick={() => handleExport(false)}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
      >
        <Download size={16} aria-hidden />
        {busy === "theme" ? "Exporting…" : "Download image"}
      </button>
      <button
        onClick={() => handleExport(true)}
        disabled={busy !== null}
        title="White-background copy for printing or messaging apps"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
      >
        <Printer size={16} aria-hidden />
        {busy === "light" ? "Exporting…" : "Print copy"}
      </button>
    </span>
  );
}

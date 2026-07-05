"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export function ExportImageButton({
  targetId,
  filename,
}: {
  targetId: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    const node = document.getElementById(targetId);
    if (!node) return;
    setBusy(true);
    try {
      const { toPng } = await import("html-to-image");

      // Force the clone wide enough that the (normally scrollable) table isn't
      // clipped, so the exported image shows the whole roster.
      let width = node.clientWidth;
      node.querySelectorAll("table").forEach((t) => {
        width = Math.max(width, (t as HTMLElement).scrollWidth);
      });
      width += 32; // padding breathing room

      const dataUrl = await toPng(node, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        cacheBust: true,
        width,
        style: { width: `${width}px` },
      });

      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Roster image export failed:", err);
      alert("Sorry, the image export failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
    >
      <Download size={16} aria-hidden />
      {busy ? "Exporting…" : "Download image"}
    </button>
  );
}

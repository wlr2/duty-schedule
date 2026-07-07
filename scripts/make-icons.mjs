// Rasterize the DutyRoster logo SVG to PWA icon PNGs.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const svg = `<svg width="512" height="512" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="#0f172a" />
  <rect x="7" y="8.5" width="13" height="3.4" rx="1.7" fill="#3b82f6" />
  <rect x="7" y="14.3" width="18" height="3.4" rx="1.7" fill="#2dd4bf" />
  <rect x="7" y="20.1" width="9" height="3.4" rx="1.7" fill="#f59e0b" />
</svg>`;

for (const size of [192, 512]) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(`C:/Users/legen/duty-scheduler/public/icon-${size}.png`, png);
  console.log(`icon-${size}.png written (${png.length} bytes)`);
}

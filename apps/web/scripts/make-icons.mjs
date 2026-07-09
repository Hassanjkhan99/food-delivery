// Generate PWA PNG icons from an inline SVG using sharp (transitive Next dependency —
// resolved out of the pnpm store since it isn't a direct dep of this package).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require(
  resolve(import.meta.dirname, "../../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp"),
);

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#e11d48"/>
  <text x="50" y="66" font-size="52" text-anchor="middle" font-family="Segoe UI Emoji, sans-serif">🍜</text>
</svg>`;

const outDir = resolve(import.meta.dirname, "../public/icons");
mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(size)))
    .png()
    .toFile(resolve(outDir, `icon-${size}.png`));
  console.log(`icon-${size}.png`);
}

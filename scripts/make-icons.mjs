import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

/**
 * Renders the PWA icon sizes from the SVG source.
 *
 *   node scripts/make-icons.mjs
 *
 * sharp needs a plain filesystem path, not a file:// URL, so the URL is
 * converted before it is handed over.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'));

for (const size of [192, 512]) {
  const out = join(root, `public/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`✓ public/icon-${size}.png`);
}